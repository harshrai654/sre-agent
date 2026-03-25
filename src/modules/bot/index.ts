import type { App, SayFn } from "@slack/bolt";
import type { Logger } from "pino";
import { type InvocationContext, SlackMentionPayloadSchema } from "../../types/session.js";
import { createBotApp } from "./app.js";
import { fetchLinkedMessage, parseSlackMessageLink } from "./parser.js";

/**
 * Extracts the Grafana generatorURL from a Slack message text.
 *
 * Grafana Alertmanager templates embed the URL as:
 *   *<https://grafana-host/alerting/RULEUID/view?...|:arrow_right: Go to alert>*
 *
 * The regex captures the URL inside `<URL|...>` following the arrow-right emoji label.
 *
 * @param messageText - The raw Slack message text to parse
 * @returns The generatorURL string or null if not found
 *
 * @example
 * Input:  "*<https://grafana.example.com/alerting/abc123/view?orgId=1|:arrow_right: Go to alert>*"
 * Output: "https://grafana.example.com/alerting/abc123/view?orgId=1"
 */
export function extractGeneratorURL(messageText: string): string | null {
  // Match the pattern: *<URL|:arrow_right: Go to alert>*
  // The URL is captured in group 1
  const regex = /\*<([^|]+)\|:arrow_right: Go to alert>\*/;
  const match = regex.exec(messageText);

  if (!match) {
    return null;
  }

  return match[1];
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
          "Invalid app_mention event payload"
        );
        return; // Silent return - don't reply to invalid events
      }

      const validEvent = parseResult.data;
      const { text, ts: triggerMessageTS, channel: triggerChannelID, user: requestedByUserID } = validEvent;

      // Step 2: Parse the Slack message link from the event text
      const messageLink = parseSlackMessageLink(text);
      if (!messageLink) {
        logger.warn({ text }, "Could not parse Slack message link from @mention text");
        await postThreadReply(say, triggerMessageTS,
          "❌ Could not find a Slack message link in your message. Please include a link to the Grafana alert message."
        );
        return;
      }

      const { channelID: linkedChannelID, messageTS: linkedMessageTS } = messageLink;

      // Step 3: Fetch the linked message using conversations.history
      const linkedMessage = await fetchLinkedMessage(app.client, linkedChannelID, linkedMessageTS);
      if (!linkedMessage) {
        logger.warn(
          { linkedChannelID, linkedMessageTS },
          "Could not fetch linked message - bot may not be in channel or message deleted"
        );
        await postThreadReply(say, triggerMessageTS,
          "❌ Could not fetch the linked message. Make sure the bot is a member of that channel."
        );
        return;
      }

      // Step 4: Extract generatorURL from the linked message text
      const messageText = linkedMessage.text || "";
      const generatorURL = extractGeneratorURL(messageText);
      if (!generatorURL) {
        logger.warn(
          { linkedMessageTS, linkedChannelID, messageText: messageText.slice(0, 200) },
          "Could not extract generatorURL from linked message"
        );
        await postThreadReply(say, triggerMessageTS,
          "❌ Could not find a Grafana alert URL in the linked message. Expected a \"Go to alert\" link."
        );
        return;
      }

      // Step 5: Post acknowledgement reply in thread on the @mention message
      logger.info(
        { triggerMessageTS, linkedMessageTS, generatorURL },
        "Posting acknowledgement and invoking onAlert"
      );
      await postThreadReply(say, triggerMessageTS,
        "🔍 Investigating... I'll post the analysis here when done."
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { event, error: errorMessage },
        "Unhandled error in app_mention handler"
      );
      // Attempt to notify user of unexpected error
      try {
        await postThreadReply(say, event.ts,
          "❌ An unexpected error occurred while processing your request. Please try again later."
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
async function postThreadReply(say: SayFn, threadTs: string, text: string): Promise<void> {
  await say({ text, thread_ts: threadTs });
}
