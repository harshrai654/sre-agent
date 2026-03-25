import type { App, SayFn } from "@slack/bolt";
import type { Logger } from "pino";
import {
  type InvocationContext,
  SlackMentionPayloadSchema,
} from "../../types/session.js";
import { createBotApp } from "./app.js";
import { fetchLinkedMessage, parseSlackMessageLink } from "./parser.js";
import { MessageElement } from "@slack/web-api/dist/types/response/ConversationsHistoryResponse.js";

/**
 * Extracts the Grafana generatorURL from a Slack MessageElement.
 *
 * Grafana Alertmanager populates attachments[0].title_link with the alert rule's
 * generatorURL. This is more reliable than scanning message text because Grafana
 * uses legacy Slack attachments where MessageElement.text is always empty.
 *
 * Falls back to scanning MessageElement.text for a raw /alerting/ URL to handle
 * any future Grafana template changes that stop using legacy attachments.
 */
export function extractGeneratorURL(message: MessageElement): string | null {
  // Primary: attachments[0].title_link — set by Grafana to the generatorURL
  const titleLink = message.attachments?.[0]?.title_link;
  if (titleLink?.includes("/alerting/")) {
    return titleLink;
  }

  // Fallback: raw URL scan of top-level text
  if (message.text) {
    const match = /https?:\/\/\S+\/alerting\/\S+\/view\S*/.exec(message.text);
    if (match) return match[0];
  }

  return null;
}

/**
 * Dependencies for the bot module factory.
 */
export interface BotModuleDeps {
  /** Pino logger instance */
  logger: Logger;
  /** Callback invoked when an alert is detected and ready for processing */
  onAlert: (ctx: InvocationContext, generatorURL: string) => Promise<void>;
}

/**
 * Result of the bot module factory.
 */
export interface BotModule {
  /** The Bolt app instance */
  app: App;
  /** Start the bot (Socket Mode) */
  start: () => Promise<void>;
  /** Stop the bot gracefully */
  stop: () => Promise<void>;
}

/**
 * Factory function for Module 1 (Slack bot).
 *
 * Creates a complete Slack bot module that:
 * 1. Listens for @mention events
 * 2. Validates and parses the mention payload
 * 3. Extracts Grafana alert links from the message chain
 * 4. Posts acknowledgement and error replies in thread
 * 5. Invokes the onAlert callback with extracted context
 *
 * All errors are caught and logged; no unhandled rejections reach the Bolt error handler.
 *
 * @param deps - Dependencies (logger, onAlert callback)
 * @returns Bot module with app, start, and stop functions
 */
export function createBotModule(deps: BotModuleDeps): BotModule {
  const { logger, onAlert } = deps;

  // Create the underlying Bolt app
  const botApp = createBotApp({ logger });
  const { app, start, stop } = botApp;

  // Register the app_mention event handler
  app.event("app_mention", async ({ event, say }) => {
    try {
      // Step 1: Validate the event payload
      const parseResult = SlackMentionPayloadSchema.safeParse(event);
      if (!parseResult.success) {
        logger.warn(
          { event, error: parseResult.error.message },
          "Invalid app_mention event payload",
        );
        return; // Silent return - don't reply to invalid events
      }

      const validEvent = parseResult.data;
      const {
        text,
        ts: triggerMessageTS,
        channel: triggerChannelID,
        user: requestedByUserID,
      } = validEvent;

      // Step 2: Parse the Slack message link from the event text
      const messageLink = parseSlackMessageLink(text);
      if (!messageLink) {
        logger.warn(
          { text },
          "Could not parse Slack message link from @mention text",
        );
        await postThreadReply(
          say,
          triggerMessageTS,
          "❌ Could not find a Slack message link in your message. Please include a link to the Grafana alert message.",
        );
        return;
      }

      const { channelID: linkedChannelID, messageTS: linkedMessageTS } =
        messageLink;

      // Step 3: Fetch the linked message using conversations.history
      const linkedMessage = await fetchLinkedMessage(
        app.client,
        linkedChannelID,
        linkedMessageTS,
      );
      if (!linkedMessage) {
        logger.warn(
          { linkedChannelID, linkedMessageTS },
          "Could not fetch linked message - bot may not be in channel or message deleted",
        );
        await postThreadReply(
          say,
          triggerMessageTS,
          "❌ Could not fetch the linked message. Make sure the bot is a member of that channel.",
        );
        return;
      }

      // Step 4: Extract generatorURL from the linked message text
      const generatorURL = extractGeneratorURL(linkedMessage);
      if (!generatorURL) {
        logger.warn(
          {
            linkedMessageTS,
            linkedChannelID,
            hasAttachments: (linkedMessage.attachments?.length ?? 0) > 0,
            titleLink: linkedMessage.attachments?.[0]?.title_link ?? "(none)",
          },
          "Could not extract generatorURL from linked message",
        );
      }

      // Step 5: Post acknowledgement reply in thread on the @mention message
      logger.info(
        { triggerMessageTS, linkedMessageTS, generatorURL },
        "Posting acknowledgement and invoking onAlert",
      );
      await postThreadReply(
        say,
        triggerMessageTS,
        "🔍 Investigating... I'll post the analysis here when done.",
      );

      // Step 6: Build InvocationContext and call onAlert
      const invocationContext: InvocationContext = {
        triggerMessageTS,
        triggerChannelID,
        linkedMessageTS,
        linkedChannelID,
        requestedByUserID,
      };

      // Call onAlert - any errors from this should be caught by the outer try-catch
      await onAlert(invocationContext, generatorURL);
    } catch (error) {
      // Catch-all for any unexpected errors during processing
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { event, error: errorMessage },
        "Unhandled error in app_mention handler",
      );
      // Attempt to notify user of unexpected error
      try {
        await postThreadReply(
          say,
          event.ts,
          "❌ An unexpected error occurred while processing your request. Please try again later.",
        );
      } catch (replyError) {
        logger.error({ replyError }, "Failed to post error reply to thread");
      }
    }
  });

  return {
    app,
    start,
    stop,
  };
}

/**
 * Helper function to post a reply in a thread.
 *
 * @param say - Slack say function from Bolt
 * @param threadTs - The timestamp of the parent message to reply to
 * @param text - The text to post
 */
async function postThreadReply(
  say: SayFn,
  threadTs: string,
  text: string,
): Promise<void> {
  await say({ text, thread_ts: threadTs });
}
