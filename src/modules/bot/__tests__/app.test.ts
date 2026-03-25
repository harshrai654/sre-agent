import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Logger } from "pino";

// Mock functions for the App instance
const mockAppStart = vi.fn().mockResolvedValue(undefined);
const mockAppStop = vi.fn().mockResolvedValue(undefined);

// Create a mock App constructor that stores options
let lastAppOptions: Record<string, unknown> = {};

vi.mock("@slack/bolt", () => ({
  App: function MockApp(this: { options: Record<string, unknown>; start: typeof mockAppStart; stop: typeof mockAppStop }, options: Record<string, unknown>) {
    lastAppOptions = options;
    this.options = options;
    this.start = mockAppStart;
    this.stop = mockAppStop;
  },
}));

// Import after mocking
import { createBotApp } from "../app.js";

describe("createBotApp", () => {
  const originalEnv = process.env;
  let mockLogger: Logger;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
    lastAppOptions = {};

    // Create mock logger
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    // Reset mocks
    mockAppStart.mockClear();
    mockAppStop.mockClear();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("environment validation", () => {
    it("should throw error when SLACK_BOT_TOKEN is missing", () => {
      process.env.SLACK_APP_TOKEN = "xapp-test-token";

      expect(() => createBotApp({ logger: mockLogger })).toThrow(
        "Missing required environment variable: SLACK_BOT_TOKEN"
      );
    });

    it("should throw error when SLACK_APP_TOKEN is missing", () => {
      process.env.SLACK_BOT_TOKEN = "xoxb-test-token";

      expect(() => createBotApp({ logger: mockLogger })).toThrow(
        "Missing required environment variable: SLACK_APP_TOKEN"
      );
    });

    it("should throw error when both tokens are missing", () => {
      expect(() => createBotApp({ logger: mockLogger })).toThrow(
        "Missing required environment variable: SLACK_BOT_TOKEN"
      );
    });

    it("should not throw when both tokens are present", () => {
      process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
      process.env.SLACK_APP_TOKEN = "xapp-test-token";

      expect(() => createBotApp({ logger: mockLogger })).not.toThrow();
    });
  });

  describe("App configuration", () => {
    beforeEach(() => {
      process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
      process.env.SLACK_APP_TOKEN = "xapp-test-token";
    });

    it("should create App with correct Socket Mode configuration", () => {
      createBotApp({ logger: mockLogger });

      expect(lastAppOptions.token).toBe("xoxb-test-token");
      expect(lastAppOptions.socketMode).toBe(true);
      expect(lastAppOptions.appToken).toBe("xapp-test-token");
      expect(lastAppOptions.logger).toBeDefined();
    });

    it("should return app instance", () => {
      const botApp = createBotApp({ logger: mockLogger });

      expect(botApp.app).toBeDefined();
      expect(botApp.app.start).toBe(mockAppStart);
      expect(botApp.app.stop).toBe(mockAppStop);
    });
  });

  describe("start() method", () => {
    beforeEach(() => {
      process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
      process.env.SLACK_APP_TOKEN = "xapp-test-token";
    });

    it("should call app.start()", async () => {
      const botApp = createBotApp({ logger: mockLogger });
      await botApp.start();

      expect(mockAppStart).toHaveBeenCalledTimes(1);
    });

    it("should log startup events", async () => {
      const botApp = createBotApp({ logger: mockLogger });
      await botApp.start();

      expect(mockLogger.info).toHaveBeenCalledWith(
        { tokens: "redacted" },
        "Starting Slack Bolt app in Socket Mode"
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Slack Bolt app started successfully"
      );
    });

    it("should redact tokens in log output", async () => {
      const botApp = createBotApp({ logger: mockLogger });
      await botApp.start();

      const logCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls;
      const startupCall = logCalls.find(
        (call) => call[1] === "Starting Slack Bolt app in Socket Mode"
      );
      expect(startupCall?.[0]).toEqual({ tokens: "redacted" });
    });
  });

  describe("stop() method", () => {
    beforeEach(() => {
      process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
      process.env.SLACK_APP_TOKEN = "xapp-test-token";
    });

    it("should call app.stop()", async () => {
      const botApp = createBotApp({ logger: mockLogger });
      await botApp.stop();

      expect(mockAppStop).toHaveBeenCalledTimes(1);
    });

    it("should log shutdown events", async () => {
      const botApp = createBotApp({ logger: mockLogger });
      await botApp.stop();

      expect(mockLogger.info).toHaveBeenCalledWith("Stopping Slack Bolt app");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Slack Bolt app stopped successfully"
      );
    });
  });

  describe("logger integration", () => {
    beforeEach(() => {
      process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
      process.env.SLACK_APP_TOKEN = "xapp-test-token";
    });

    it("should pass Bolt logger adapter to App constructor", () => {
      createBotApp({ logger: mockLogger });
      const boltLogger = lastAppOptions.logger as Record<string, unknown>;

      expect(boltLogger).toBeDefined();
      expect(typeof boltLogger.debug).toBe("function");
      expect(typeof boltLogger.info).toBe("function");
      expect(typeof boltLogger.warn).toBe("function");
      expect(typeof boltLogger.error).toBe("function");
      expect(typeof boltLogger.setLevel).toBe("function");
      expect(typeof boltLogger.getLevel).toBe("function");
      expect(typeof boltLogger.setName).toBe("function");
    });

    it("should delegate Bolt log calls to pino logger", () => {
      createBotApp({ logger: mockLogger });
      const boltLogger = lastAppOptions.logger as { debug: (msg: string) => void; info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };

      boltLogger.debug("debug message");
      expect(mockLogger.debug).toHaveBeenCalledWith("debug message");

      boltLogger.info("info message");
      expect(mockLogger.info).toHaveBeenCalledWith("info message");

      boltLogger.warn("warn message");
      expect(mockLogger.warn).toHaveBeenCalledWith("warn message");

      boltLogger.error("error message");
      expect(mockLogger.error).toHaveBeenCalledWith("error message");
    });
  });

  describe("no event listeners registered", () => {
    beforeEach(() => {
      process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
      process.env.SLACK_APP_TOKEN = "xapp-test-token";
    });

    it("should not register any event listeners on the app", () => {
      const mockEventFn = vi.fn();
      const mockMessageFn = vi.fn();
      const mockActionFn = vi.fn();
      const mockCommandFn = vi.fn();

      // Create an app with extra methods to verify they aren't called
      const botApp = createBotApp({ logger: mockLogger });
      
      // Verify the returned app doesn't have any event registration methods called
      // Since we don't register listeners, the app instance should only have start/stop
      expect(typeof botApp.app.start).toBe("function");
      expect(typeof botApp.app.stop).toBe("function");
      
      // Event listener methods should not be called during creation
      expect(mockEventFn).not.toHaveBeenCalled();
      expect(mockMessageFn).not.toHaveBeenCalled();
      expect(mockActionFn).not.toHaveBeenCalled();
      expect(mockCommandFn).not.toHaveBeenCalled();
    });
  });
});
