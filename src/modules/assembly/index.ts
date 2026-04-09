import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { Logger } from "pino";
import type { LiveAlertState } from "../../types/grafana.js";
import type { InvocationContext, SessionContext } from "../../types/session.js";
import type { AgentsMdLoader } from "./agents-md.js";
import {
  createGrafanaMcpClient,
  extractRuleUID,
  fetchLiveAlertState,
} from "./grafana-mcp.js";
import { buildAlertContextFile } from "./context-builder.js";

/**
 * Gets the directory of the current module (works with ESM)
 */
function getCurrentDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  return dirname(__filename);
}

/**
 * Loads the hardcoded system instructions from the template file.
 * The file is loaded at runtime so it can be edited without recompiling.
 *
 * @returns The system instructions as a string
 */
function loadSystemInstructions(): string {
  const instructionsPath = join(
    getCurrentDir(),
    "..",
    "..",
    "templates",
    "system-instructions.md",
  );
  return readFileSync(instructionsPath, "utf-8").trim();
}

/**
 * Dependencies required by the assembly module.
 */
export interface AssemblyModuleDeps {
  logger: Logger;
  agentsMdLoader: AgentsMdLoader;
}

/**
 * Creates the assembly module (Module 2) which is responsible for building
 * the complete session context that the DeepAgent needs for investigation.
 *
 * This module:
 * 1. Extracts rule UID from generator URLs
 * 2. Fetches live alert state from Grafana MCP
 * 3. Builds ALERT_CONTEXT.md from alert state
 * 4. Assembles the system prompt (hardcoded + AGENTS.md)
 * 5. Returns a complete SessionContext
 *
 * @param deps - Dependencies: logger and agentsMdLoader
 * @returns Object containing buildSessionContext function
 */
export function createAssemblyModule(deps: AssemblyModuleDeps): {
  buildSessionContext: (
    invocation: InvocationContext,
    generatorURL: string,
  ) => Promise<SessionContext>;
} {
  const { logger, agentsMdLoader } = deps;

  /**
   * Assembles the complete system prompt for the DeepAgent.
   *
   * Order matters: hardcoded instructions come FIRST to establish non-negotiable
   * constraints and behavioral guardrails before any domain-specific instructions
   * from AGENTS.md. This ensures the agent's core behavior is defined by the
   * system, with AGENTS.md providing supplementary context.
   *
   * @param agentsMdContent - Content from AGENTS.md (may be empty)
   * @returns Assembled system prompt
   */
  const assembleSystemPrompt = (agentsMdContent: string): string => {
    const hardcodedInstructions = loadSystemInstructions();

    // If AGENTS.md is empty, return only hardcoded instructions (no trailing newlines)
    if (!agentsMdContent || agentsMdContent.trim() === "") {
      return hardcodedInstructions;
    }

    // Combine: hardcoded instructions first, then AGENTS.md content
    return `${hardcodedInstructions}\n\n${agentsMdContent.trim()}`;
  };

  /**
   * Builds the complete session context for a DeepAgent investigation.
   *
   * This is the main entry point for Module 2. It:
   * 1. Extracts the rule UID from the generator URL
   * 2. Creates a Grafana MCP client and fetches live alert state
   * 3. Builds ALERT_CONTEXT.md from the alert state
   * 4. Assembles the system prompt
   * 5. Returns the complete SessionContext
   *
   *
   * MEMORY_ENABLED placeholder: When Module 5 lands, add logic here to:
   *   - Check if past incidents exist for this alert fingerprint
   *   - If yes: set includesPastIncidents=true in buildAlertContextFile call
   *   - If yes: fetch and include PAST_INCIDENTS.md in files
   *
   * @param invocation - The Slack invocation context
   * @param generatorURL - The Grafana alert generator URL
   * @returns Promise resolving to the complete session context
   * @throws Error if any step fails (caller handles error replies to Slack)
   */
  const buildSessionContext = async (
    invocation: InvocationContext,
    generatorURL: string,
  ): Promise<SessionContext> => {
    logger.info(
      { generatorURL, requestedBy: invocation.requestedByUserID },
      "Building session context",
    );

    // Step 1: Extract rule UID from generator URL
    const ruleUID = extractRuleUID(generatorURL);
    logger.debug({ ruleUID }, "Extracted rule UID");

    // Step 2: Create Grafana MCP client and fetch live alert state
    // We create/close per-call to avoid holding connections open
    let liveAlertState: LiveAlertState;
    const client = createGrafanaMcpClient();
    try {
      liveAlertState = await fetchLiveAlertState(client, ruleUID, generatorURL);
      logger.info(
        {
          ruleUID: liveAlertState.ruleUID,
          ruleName: liveAlertState.ruleName,
          state: liveAlertState.state,
        },
        "Fetched live alert state",
      );
    } finally {
      // Ensure client is closed even if fetch fails
      try {
        await client.close();
        logger.debug("Grafana MCP client closed");
      } catch (closeError) {
        // Log but don't fail the whole operation if close fails
        logger.warn(
          {
            error:
              closeError instanceof Error
                ? closeError.message
                : String(closeError),
          },
          "Error closing Grafana MCP client",
        );
      }
    }

    // Step 3: Build ALERT_CONTEXT.md
    // MEMORY_ENABLED placeholder: When Module 5 lands, check for past incidents
    // and pass true/false to includesPastIncidents parameter
    const includesPastIncidents = false; // Placeholder for Module 5
    const alertContextFile = buildAlertContextFile(
      liveAlertState,
      includesPastIncidents,
    );
    logger.debug(
      { includesPastIncidents, contentLength: alertContextFile.length },
      "Built ALERT_CONTEXT.md",
    );

    // Step 4: Assemble system prompt
    const agentsMdContent = agentsMdLoader.getContent();
    const systemPrompt = assembleSystemPrompt(agentsMdContent);
    logger.debug(
      {
        hasAgentsMd: agentsMdContent.length > 0,
        totalLength: systemPrompt.length,
      },
      "Assembled system prompt",
    );

    // Step 5: Build and return the complete session context
    const sessionContext: SessionContext = {
      invocation,
      liveAlertState,
      systemPrompt,
      files: {
        // Absolute path — Deep Agents filesystem tools index files under `/` (see deepagents StateBackend)
        "/ALERT_CONTEXT.md": alertContextFile,
      },
    };

    logger.info(
      {
        ruleUID: liveAlertState.ruleUID,
        ruleName: liveAlertState.ruleName,
        alertState: liveAlertState.state,
        filesCount: Object.keys(sessionContext.files).length,
      },
      "Session context built successfully",
    );

    return sessionContext;
  };

  return {
    buildSessionContext,
  };
}
