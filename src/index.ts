import pino from "pino";
import { createBotModule } from "./modules/bot/index.js";
import { createGrafanaMcpClient, extractRuleUID, fetchLiveAlertState } from "./modules/assembly/grafana-mcp.js";
import { buildAlertContextFile } from "./modules/assembly/context-builder.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// Test onAlert handler - fetches alert data and renders ALERT_CONTEXT.md
const bot = createBotModule({
  logger,
  onAlert: async (invocation, generatorURL) => {
    logger.info(
      { invocation, generatorURL },
      "Alert received - fetching data from Grafana MCP"
    );

    try {
      // Step 1: Create Grafana MCP client
      const mcpClient = createGrafanaMcpClient();
      
      // Step 2: Extract rule UID from generatorURL
      const ruleUID = extractRuleUID(generatorURL);
      logger.info({ ruleUID }, "Extracted rule UID from generatorURL");

      // Step 3: Fetch live alert state from Grafana
      logger.info({ ruleUID }, "Fetching live alert state from Grafana MCP...");
      const liveAlertState = await fetchLiveAlertState(mcpClient, ruleUID, generatorURL);
      
      logger.info(
        { 
          ruleUID: liveAlertState.ruleUID,
          ruleName: liveAlertState.ruleName,
          state: liveAlertState.state,
          health: liveAlertState.health,
          alertCount: liveAlertState.alerts?.length ?? 0,
        },
        "Successfully fetched live alert state"
      );

      // Step 4: Build ALERT_CONTEXT.md (M2.2)
      logger.info("Building ALERT_CONTEXT.md from template...");
      const alertContext = buildAlertContextFile(liveAlertState, false);

      // Step 5: TEMPORARY - Log the rendered template for testing
      // In production, this would be passed to the DeepAgent harness
      logger.info(
        { 
          alertContextPreview: alertContext.substring(0, 500) + "...",
          alertContextLength: alertContext.length,
          alertContextFull: alertContext, // Full content for inspection
        },
        "=== ALERT_CONTEXT.md RENDERED ==="
      );

      // Also write to stdout for easy visibility during development
      console.log("\n" + "=".repeat(80));
      console.log("ALERT_CONTEXT.md (FULL RENDERED OUTPUT)");
      console.log("=".repeat(80));
      console.log(alertContext);
      console.log("=".repeat(80) + "\n");

      logger.info(
        { invocation, generatorURL },
        "Alert context built successfully - ready for DeepAgent harness (M3)"
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: errorMessage, generatorURL, invocation },
        "Failed to fetch/build alert context"
      );
      
      // Re-throw so bot handler can post error reply
      throw error;
    }
  },
});

// Startup
await bot.start();
logger.info("sre-agent ready - M1 (bot) + M2.1 (grafana-mcp) + M2.2 (context-builder)");
logger.info(
  { 
    mode: "test-alert-context",
    note: "Renders ALERT_CONTEXT.md to logs on each @mention with Grafana alert link",
    grafanaMcpUrl: process.env.GRAFANA_MCP_URL ?? "(not set - required)",
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
