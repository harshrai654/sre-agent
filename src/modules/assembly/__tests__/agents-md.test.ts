import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAgentsMdLoader, type AgentsMdLoader } from "../agents-md.js";
import type { Logger } from "pino";

// Mock chokidar
const mockWatcher = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("chokidar", () => ({
  watch: vi.fn(() => mockWatcher),
}));

// Mock fs
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "fs";
import { watch } from "chokidar";

const createMockLogger = (): Logger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as Logger;

describe("createAgentsMdLoader", () => {
  const originalEnv = process.env;
  let mockLogger: Logger;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("when AGENTS_MD_PATH is not set", () => {
    beforeEach(() => {
      delete process.env.AGENTS_MD_PATH;
    });

    it("should return empty string from getContent()", () => {
      const loader = createAgentsMdLoader(mockLogger);
      expect(loader.getContent()).toBe("");
    });

    it("should log warning once when start() is called", () => {
      const loader = createAgentsMdLoader(mockLogger);
      loader.start();

      expect(mockLogger.warn).toHaveBeenCalledWith("AGENTS_MD_PATH not set, AGENTS.md loading disabled");
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it("should not log warning on subsequent start() calls", () => {
      const loader = createAgentsMdLoader(mockLogger);
      loader.start();
      loader.start();
      loader.start();

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it("should not create file watcher when start() is called", () => {
      const loader = createAgentsMdLoader(mockLogger);
      loader.start();

      expect(watch).not.toHaveBeenCalled();
    });

    it("should be safe to call stop() without start()", () => {
      const loader = createAgentsMdLoader(mockLogger);
      expect(() => loader.stop()).not.toThrow();
    });
  });

  describe("when AGENTS_MD_PATH is set", () => {
    const testFilePath = "/etc/sre-agent/AGENTS.md";

    beforeEach(() => {
      process.env.AGENTS_MD_PATH = testFilePath;
    });

    describe("start() behavior", () => {
      it("should read file immediately on start()", () => {
        const content = "# Agent Instructions\n\nYou are an SRE assistant.";
        vi.mocked(readFileSync).mockReturnValue(content);

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        expect(readFileSync).toHaveBeenCalledWith(testFilePath, "utf-8");
        expect(loader.getContent()).toBe(content);
      });

      it("should log info when file is loaded successfully", () => {
        vi.mocked(readFileSync).mockReturnValue("Some content");

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        expect(mockLogger.info).toHaveBeenCalledWith(
          { filePath: testFilePath },
          "AGENTS.md loaded"
        );
      });

      it("should create chokidar watcher on start()", () => {
        vi.mocked(readFileSync).mockReturnValue("content");

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        expect(watch).toHaveBeenCalledWith(testFilePath, {
          persistent: true,
          ignoreInitial: true,
        });
      });

      it("should log info when watcher is started", () => {
        vi.mocked(readFileSync).mockReturnValue("content");

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        expect(mockLogger.info).toHaveBeenCalledWith(
          { filePath: testFilePath },
          "AGENTS.md watcher started"
        );
      });

      it("should handle file read error at startup with empty content", () => {
        vi.mocked(readFileSync).mockImplementation(() => {
          throw new Error("ENOENT: file not found");
        });

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        expect(loader.getContent()).toBe("");
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { filePath: testFilePath, error: "ENOENT: file not found" },
          "AGENTS.md unreadable at startup, using empty content"
        );
      });

      it("should handle file read error with Error object", () => {
        const fileError = new Error("Permission denied");
        vi.mocked(readFileSync).mockImplementation(() => {
          throw fileError;
        });

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ error: "Permission denied" }),
          "AGENTS.md unreadable at startup, using empty content"
        );
      });

      it("should handle file read error with non-Error throw", () => {
        vi.mocked(readFileSync).mockImplementation(() => {
          throw "string error";
        });

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ error: "string error" }),
          "AGENTS.md unreadable at startup, using empty content"
        );
      });
    });

    describe("hot-reload behavior", () => {
      it("should reload content on file change event", () => {
        const initialContent = "Initial instructions";
        const updatedContent = "Updated instructions";

        vi.mocked(readFileSync)
          .mockReturnValueOnce(initialContent)
          .mockReturnValueOnce(updatedContent);

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        expect(loader.getContent()).toBe(initialContent);

        // Simulate file change
        const changeCall = mockWatcher.on.mock.calls.find(
          (call) => call[0] === "change"
        );
        expect(changeCall).toBeDefined();
        const changeHandler = changeCall![1] as () => void;
        changeHandler();

        expect(readFileSync).toHaveBeenCalledTimes(2);
        expect(loader.getContent()).toBe(updatedContent);
      });

      it("should log info on file change", () => {
        vi.mocked(readFileSync).mockReturnValue("content");

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        const changeCall = mockWatcher.on.mock.calls.find(
          (call) => call[0] === "change"
        );
        expect(changeCall).toBeDefined();
        const changeHandler = changeCall![1] as () => void;
        changeHandler();

        expect(mockLogger.info).toHaveBeenCalledWith(
          { filePath: testFilePath },
          "AGENTS.md changed, reloading"
        );
      });

      it("should keep previous content on reload failure", () => {
        const initialContent = "Initial content";

        vi.mocked(readFileSync)
          .mockReturnValueOnce(initialContent)
          .mockImplementationOnce(() => {
            throw new Error("Read failed");
          });

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        // Simulate file change that fails
        const changeCall = mockWatcher.on.mock.calls.find(
          (call) => call[0] === "change"
        );
        expect(changeCall).toBeDefined();
        const changeHandler = changeCall![1] as () => void;
        changeHandler();

        expect(loader.getContent()).toBe(initialContent);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { filePath: testFilePath, error: "Read failed" },
          "AGENTS.md reload failed, keeping previous content"
        );
      });

      it("should handle watcher errors", () => {
        vi.mocked(readFileSync).mockReturnValue("content");

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        const errorCall = mockWatcher.on.mock.calls.find(
          (call) => call[0] === "error"
        );
        expect(errorCall).toBeDefined();
        const errorHandler = errorCall![1] as (err: unknown) => void;
        errorHandler(new Error("Watcher error"));

        expect(mockLogger.error).toHaveBeenCalledWith(
          { filePath: testFilePath, error: "Watcher error" },
          "AGENTS.md watcher error"
        );
      });

      it("should handle watcher errors with non-Error values", () => {
        vi.mocked(readFileSync).mockReturnValue("content");

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        const errorCall = mockWatcher.on.mock.calls.find(
          (call) => call[0] === "error"
        );
        expect(errorCall).toBeDefined();
        const errorHandler = errorCall![1] as (err: unknown) => void;
        errorHandler("string error");

        expect(mockLogger.error).toHaveBeenCalledWith(
          { filePath: testFilePath, error: "string error" },
          "AGENTS.md watcher error"
        );
      });
    });

    describe("stop() behavior", () => {
      it("should close watcher on stop()", async () => {
        vi.mocked(readFileSync).mockReturnValue("content");

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();
        loader.stop();

        expect(mockWatcher.close).toHaveBeenCalled();
      });

      it("should log info when watcher is stopped", async () => {
        vi.mocked(readFileSync).mockReturnValue("content");
        mockWatcher.close.mockResolvedValue(undefined);

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();
        loader.stop();

        // Wait for the async close to complete
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockLogger.info).toHaveBeenCalledWith("AGENTS.md watcher stopped");
      });

      it("should handle errors when stopping watcher", async () => {
        vi.mocked(readFileSync).mockReturnValue("content");
        mockWatcher.close.mockRejectedValue(new Error("Close failed"));

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();
        loader.stop();

        // Wait for the async close to complete
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ error: "Close failed" }),
          "Error stopping AGENTS.md watcher"
        );
      });

      it("should be safe to call stop() multiple times", () => {
        vi.mocked(readFileSync).mockReturnValue("content");

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();
        loader.stop();
        loader.stop();
        loader.stop();

        // Should only call close once (when watcher was set)
        expect(mockWatcher.close).toHaveBeenCalledTimes(1);
      });

      it("should be safe to call stop() without start()", () => {
        const loader = createAgentsMdLoader(mockLogger);
        expect(() => loader.stop()).not.toThrow();
        expect(mockWatcher.close).not.toHaveBeenCalled();
      });
    });

    describe("trimming of environment variable", () => {
      it("should trim whitespace from AGENTS_MD_PATH", () => {
        process.env.AGENTS_MD_PATH = "  /path/to/agents.md  ";
        vi.mocked(readFileSync).mockReturnValue("content");

        const loader = createAgentsMdLoader(mockLogger);
        loader.start();

        expect(watch).toHaveBeenCalledWith("/path/to/agents.md", expect.any(Object));
        expect(readFileSync).toHaveBeenCalledWith("/path/to/agents.md", "utf-8");
      });
    });
  });

  describe("multiple loader instances", () => {
    it("should create independent instances with separate content", () => {
      process.env.AGENTS_MD_PATH = "/path/to/agents.md";

      vi.mocked(readFileSync)
        .mockReturnValueOnce("Content A")
        .mockReturnValueOnce("Content B");

      const loader1 = createAgentsMdLoader(mockLogger);
      const loader2 = createAgentsMdLoader(mockLogger);

      loader1.start();
      loader2.start();

      expect(loader1.getContent()).toBe("Content A");
      expect(loader2.getContent()).toBe("Content B");
    });

    it("should have independent watchers", () => {
      process.env.AGENTS_MD_PATH = "/path/to/agents.md";
      vi.mocked(readFileSync).mockReturnValue("content");

      const loader1 = createAgentsMdLoader(mockLogger);
      const loader2 = createAgentsMdLoader(mockLogger);

      loader1.start();
      loader2.start();

      expect(watch).toHaveBeenCalledTimes(2);
    });

    it("stopping one instance should not affect another", () => {
      process.env.AGENTS_MD_PATH = "/path/to/agents.md";
      vi.mocked(readFileSync).mockReturnValue("content");

      const loader1 = createAgentsMdLoader(mockLogger);
      const loader2 = createAgentsMdLoader(mockLogger);

      loader1.start();
      loader2.start();

      loader1.stop();

      expect(mockWatcher.close).toHaveBeenCalledTimes(1);
      // loader2's watcher should still be active
    });
  });

  describe("getContent() behavior", () => {
    it("should return current content after reloads", () => {
      process.env.AGENTS_MD_PATH = "/path/to/agents.md";

      vi.mocked(readFileSync)
        .mockReturnValueOnce("Version 1")
        .mockReturnValueOnce("Version 2")
        .mockReturnValueOnce("Version 3");

      const loader = createAgentsMdLoader(mockLogger);
      loader.start();

      expect(loader.getContent()).toBe("Version 1");

      const changeCall = mockWatcher.on.mock.calls.find(
        (call) => call[0] === "change"
      );
      expect(changeCall).toBeDefined();
      const changeHandler = changeCall![1] as () => void;

      changeHandler();
      expect(loader.getContent()).toBe("Version 2");

      changeHandler();
      expect(loader.getContent()).toBe("Version 3");
    });

    it("should return empty string if file was never readable", () => {
      process.env.AGENTS_MD_PATH = "/path/to/agents.md";
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("Not found");
      });

      const loader = createAgentsMdLoader(mockLogger);
      loader.start();

      expect(loader.getContent()).toBe("");
    });
  });
});
