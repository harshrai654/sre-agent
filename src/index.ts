import pino from "pino";
import { createBotModule } from "./modules/bot/index.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// Dummy onAlert handler for testing - just logs and posts a mock response
// This will be replaced with real implementation when other modules are ready
const bot = createBotModule({
  logger,
  onAlert: async (invocation, generatorURL) => {
    logger.info(
      { invocation, generatorURL },
      "Alert received (dummy handler)"
    );

    // Simulate some async work (replace with real analysis later)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    logger.info(
      { invocation, generatorURL },
      "Dummy analysis complete - in real implementation this would call assembly + harness + publisher"
    );

    // Note: The bot already posted "Investigating..." in the handler
    // In the full implementation, publisher.postAnalysis() would post the actual result
    // For now, the acknowledgement message serves as a test that the flow works
  },
});

// Startup
await bot.start();
logger.info("sre-agent ready (partial WIRE implementation - bot only)");
logger.info(
  { 
    mode: "dummy-onAlert",
    note: "Full implementation pending: assembly, harness, publisher modules",
  },
  "Bot is listening for @mentions"
);

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutting down");
  await bot.stop();
  logger.info("Goodbye!");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
  // Do not exit — log and continue; in-flight sessions must not be killed
});

process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught exception");
  // Exit on uncaught exceptions as the process may be in an undefined state
  process.exit(1);
});
