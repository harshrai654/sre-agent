import { readFileSync } from "fs";
import { watch, type FSWatcher } from "chokidar";
import type { Logger } from "pino";

/**
 * Interface for the AGENTS.md loader instance.
 */
export interface AgentsMdLoader {
  /** Returns current file content, or "" if unavailable */
  getContent: () => string;
  /** Begins watching for file changes */
  start: () => void;
  /** Stops the file watcher */
  stop: () => void;
}

/**
 * Creates a loader for the AGENTS.md file with hot-reload capability.
 *
 * This loader reads the AGENTS.md file (which contains system prompt instructions
 * for the DeepAgent) and watches for changes. The content is used to populate
 * SessionContext.systemPrompt and can be updated at runtime without restarting
 * the service.
 *
 * If AGENTS_MD_PATH is not set, the loader returns empty content and becomes
 * a no-op. This allows the service to run without custom agent instructions,
 * falling back to default behavior.
 *
 * @param logger - Pino logger instance for operational logging
 * @returns AgentsMdLoader instance with getContent, start, and stop methods
 */
export function createAgentsMdLoader(logger: Logger): AgentsMdLoader {
  const filePath = process.env.AGENTS_MD_PATH?.trim();
  let content = "";
  let watcher: FSWatcher | null = null;
  let hasLoggedMissingPath = false;

  /**
   * Reads the file and updates the stored content.
   * Logs appropriate warnings on failure.
   */
  const loadFile = (): void => {
    if (!filePath) {
      return;
    }

    try {
      content = readFileSync(filePath, "utf-8");
      logger.info({ filePath }, "AGENTS.md loaded");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // If this is the first read (content is empty), warn and proceed with ""
      if (content === "") {
        logger.warn({ filePath, error: errorMessage }, "AGENTS.md unreadable at startup, using empty content");
      } else {
        // If this is a reload and it fails, keep the previous content
        logger.warn({ filePath, error: errorMessage }, "AGENTS.md reload failed, keeping previous content");
      }
    }
  };

  /**
   * Returns the current AGENTS.md content.
   * Returns "" if file is not configured or unreadable.
   */
  const getContent = (): string => content;

  /**
   * Starts watching the AGENTS.md file for changes.
   * If AGENTS_MD_PATH is not set, logs a warning once and returns immediately.
   */
  const start = (): void => {
    if (!filePath) {
      if (!hasLoggedMissingPath) {
        logger.warn("AGENTS_MD_PATH not set, AGENTS.md loading disabled");
        hasLoggedMissingPath = true;
      }
      return;
    }

    // Load initial content
    loadFile();

    // Set up file watcher
    watcher = watch(filePath, {
      persistent: true,
      ignoreInitial: true, // We already loaded above
    });

    watcher.on("change", () => {
      logger.info({ filePath }, "AGENTS.md changed, reloading");
      loadFile();
    });

    watcher.on("error", (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ filePath, error: errorMessage }, "AGENTS.md watcher error");
    });

    logger.info({ filePath }, "AGENTS.md watcher started");
  };

  /**
   * Stops the file watcher.
   * Safe to call even if start() was never called or if path was not set.
   */
  const stop = (): void => {
    if (watcher) {
      watcher.close().then(() => {
        logger.info("AGENTS.md watcher stopped");
      }).catch((error) => {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, "Error stopping AGENTS.md watcher");
      });
      watcher = null;
    }
  };

  return {
    getContent,
    start,
    stop,
  };
}
