import pino from "pino";
import { createBotModule } from "./modules/bot/index.js";
import { createGrafanaMcpClient, extractRuleUID, fetchLiveAlertState } from "./modules/assembly/grafana-mcp.js";
import { buildAlertContextFile } from "./modules/assembly/context-builder.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// Alert handler - assembles context for DeepAgent (M2 complete)
const bot = createBotModule({
  logger,
  onAlert: async (invocation, generatorURL) => {
    logger.info(
      { invocation, generatorURL },
      "Alert received - assembling context"
    );

    try {
      // M2.1: Fetch live alert state from Grafana MCP
      const mcpClient = createGrafanaMcpClient();
      const ruleUID = extractRuleUID(generatorURL);
      const liveAlertState = await fetchLiveAlertState(mcpClient, ruleUID, generatorURL);

      // M2.2: Build ALERT_CONTEXT.md from template
      const alertContext = buildAlertContextFile(liveAlertState, false);

      // M2.3: Load AGENTS.md (if configured) - placeholder for M2.4 integration
      // const systemPrompt = agentsLoader.getContent();

      // TODO: M2.4 - Assemble SessionContext
      // TODO: M3 - Invoke DeepAgent harness
      // TODO: M4 - Post analysis to Slack

      logger.info(
        { 
          ruleUID: liveAlertState.ruleUID,
          ruleName: liveAlertState.ruleName,
          state: liveAlertState.state,
          alertCount: liveAlertState.alerts?.length ?? 0,
        },
        "Context assembled successfully - DeepAgent integration pending (M3)"
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: errorMessage, generatorURL, invocation },
        "Failed to assemble alert context"
      );
      
      // Re-throw so bot handler can post error reply
      throw error;
    }
  },
});

// Startup
await bot.start();
logger.info("sre-agent ready - M1 (bot) + M2 (context assembly) complete");
logger.info("Bot listening for @mentions");

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
