import type { Logger } from "pino";
import { WebClient } from "@slack/web-api";
import type { AnalysisResult } from "../../types/session.js";
import { buildAnalysisBlocks } from "./blocks.js";

export interface PublisherModuleDeps {
  logger: Logger;
}

export interface PublisherModule {
  postAnalysis: (result: AnalysisResult) => Promise<void>;
}

/**
 * Slack publisher: posts Block Kit analysis as a thread reply on the @mention message.
 *
 * `WebClient` is created once at factory time (requires `SLACK_BOT_TOKEN`).
 */
export function createPublisherModule(deps: PublisherModuleDeps): PublisherModule {
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  if (!slackBotToken) {
    throw new Error(
      "Missing required environment variable: SLACK_BOT_TOKEN. " +
        "Please set it to your Slack Bot User OAuth Token (xoxb-...).",
    );
  }

  const client = new WebClient(slackBotToken);
  const { logger } = deps;

  return {
    postAnalysis: async (result: AnalysisResult): Promise<void> => {
      const blocks = buildAnalysisBlocks(result);
      const channel = result.invocation.triggerChannelID;
      const thread_ts = result.invocation.triggerMessageTS;

      try {
        await client.chat.postMessage({
          channel,
          thread_ts,
          text: "🤖 SRE Agent Analysis",
          blocks,
        });
        logger.info({ channel, thread_ts }, "Posted SRE analysis to Slack thread");
      } catch (err) {
        logger.error(
          {
            err,
            analysis: result.analysis,
            channel,
            thread_ts,
          },
          "Failed to post analysis to Slack; analysis text preserved in log",
        );
      }
    },
  };
}
