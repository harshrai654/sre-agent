import { App } from "@slack/bolt";
import type { LogLevel } from "@slack/bolt";
import type { Logger } from "pino";

export interface BotApp {
  app: App;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createBotApp(deps: { logger: Logger }): BotApp {
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackAppToken = process.env.SLACK_APP_TOKEN;

  if (!slackBotToken) {
    throw new Error(
      "Missing required environment variable: SLACK_BOT_TOKEN. " +
        "Please set it to your Slack Bot User OAuth Token (xoxb-...)."
    );
  }

  if (!slackAppToken) {
    throw new Error(
      "Missing required environment variable: SLACK_APP_TOKEN. " +
        "Please set it to your Slack App-Level Token (xapp-...). " +
        "This token is required for Socket Mode."
    );
  }

  const logger = deps.logger;

  const app = new App({
    token: slackBotToken,
    socketMode: true,
    appToken: slackAppToken,
    logger: {
      debug: (msg: string) => logger.debug(msg),
      info: (msg: string) => logger.info(msg),
      warn: (msg: string) => logger.warn(msg),
      error: (msg: string) => logger.error(msg),
      setLevel: () => {},
      getLevel: () => "info" as LogLevel,
      setName: () => {},
    },
  });

  return {
    app,
    start: async () => {
      logger.info({ tokens: "redacted" }, "Starting Slack Bolt app in Socket Mode");
      await app.start();
      logger.info("Slack Bolt app started successfully");
    },
    stop: async () => {
      logger.info("Stopping Slack Bolt app");
      await app.stop();
      logger.info("Slack Bolt app stopped successfully");
    },
  };
}
