import pino from "pino";
import { createAgentsMdLoader } from "./modules/assembly/agents-md.js";
import { createAssemblyModule } from "./modules/assembly/index.js";
import { runAgentSession } from "./modules/harness/index.js";
import { createPublisherModule } from "./modules/publisher/index.js";
import { createBotModule } from "./modules/bot/index.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const agentsMdLoader = createAgentsMdLoader(logger);
const assembly = createAssemblyModule({ logger, agentsMdLoader });
const publisher = createPublisherModule({ logger });

const bot = createBotModule({
  logger,
  onAlert: async (invocation, generatorURL) => {
    try {
      const sessionContext = await assembly.buildSessionContext(
        invocation,
        generatorURL,
      );
      const result = await runAgentSession(sessionContext);
      await publisher.postAnalysis(result);
    } catch (err) {
      logger.error({ err, invocation }, "Alert investigation failed");
      // Rethrow so createBotModule's app_mention handler can post the ❌ thread reply
      throw err;
    }
  },
});

// Startup — load/watch AGENTS.md before Socket Mode so content is ready for the first @mention
agentsMdLoader.start();
await bot.start();
logger.info("sre-agent ready");

// Graceful shutdown
let shuttingDown = false;
const shutdown = async (signal: string, opts?: { exitCode?: number }) => {
  if (shuttingDown) return;
  shuttingDown = true;

  const exitCode = opts?.exitCode ?? 0;
  logger.info({ signal, exitCode }, "Shutting down");

  try {
    await bot.stop();
  } catch (err) {
    logger.warn({ err }, "Error stopping Slack bot during shutdown");
  }

  try {
    agentsMdLoader.stop();
  } catch (err) {
    logger.warn({ err }, "Error stopping AGENTS.md watcher during shutdown");
  }

  process.exit(exitCode);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
// Commonly used by nodemon for restarts (best-effort graceful shutdown)
process.on("SIGUSR2", () => {
  void shutdown("SIGUSR2");
});

process.on("unhandledRejection", (reason) => {
  logger.error(
    { reason },
    "Unhandled promise rejection — in-flight sessions preserved",
  );
});

process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught exception");
  void shutdown("uncaughtException", { exitCode: 1 });
});
