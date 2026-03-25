import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Logger } from "pino";
import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { InvocationContext } from "../../../types/session.js";

// Shared mock state for app.js
const appMockState = {
  mockEventFn: vi.fn(),
  mockAppStart: vi.fn().mockResolvedValue(undefined),
  mockAppStop: vi.fn().mockResolvedValue(undefined),
};

// Mock the parser module
vi.mock("../parser.js", () => ({
  parseSlackMessageLink: vi.fn(),
  fetchLinkedMessage: vi.fn(),
}));

// Mock the app module with hoisting-safe factory
vi.mock("../app.js", () => ({
  createBotApp: vi.fn().mockImplementation(() => ({
    app: {
      start: appMockState.mockAppStart,
      stop: appMockState.mockAppStop,
      event: appMockState.mockEventFn,
      client: {} as WebClient,
    } as unknown as App,
    start: appMockState.mockAppStart,
    stop: appMockState.mockAppStop,
  })),
}));

// Import after mocking
import { parseSlackMessageLink, fetchLinkedMessage } from "../parser.js";
import { extractGeneratorURL, createBotModule } from "../index.js";

describe("extractGeneratorURL", () => {
  describe("valid Grafana alert URLs", () => {
    it("should extract URL from standard Grafana alert template", () => {
      const text = "*<https://grafana.example.com/alerting/abc123/view?orgId=1|:arrow_right: Go to alert>*";
      const result = extractGeneratorURL(text);

      expect(result).toBe("https://grafana.example.com/alerting/abc123/view?orgId=1");
    });

    it("should extract URL with complex query parameters", () => {
      const text = "*<https://grafana.example.com/alerting/rule-uid-xyz/view?orgId=1&var-datasource=prometheus&var-cluster=prod|:arrow_right: Go to alert>*";
      const result = extractGeneratorURL(text);

      expect(result).toBe("https://grafana.example.com/alerting/rule-uid-xyz/view?orgId=1&var-datasource=prometheus&var-cluster=prod");
    });

    it("should extract URL with different hostnames", () => {
      const text = "*<https://monitoring.internal.company.com/alerting/alert-123/view?orgId=2|:arrow_right: Go to alert>*";
      const result = extractGeneratorURL(text);

      expect(result).toBe("https://monitoring.internal.company.com/alerting/alert-123/view?orgId=2");
    });

    it("should extract URL when embedded in larger message", () => {
      const text = `🔥 *High CPU Usage*
Server: prod-app-01
*<https://grafana.example.com/alerting/cpu-alert/view?orgId=1|:arrow_right: Go to alert>*
Check the dashboard immediately.`;
      const result = extractGeneratorURL(text);

      expect(result).toBe("https://grafana.example.com/alerting/cpu-alert/view?orgId=1");
    });
  });

  describe("invalid or missing URLs", () => {
    it("should return null for text without Grafana link", () => {
      const text = "Just some random text without any Grafana link";
      const result = extractGeneratorURL(text);

      expect(result).toBeNull();
    });

    it("should return null for plain URL without Slack formatting", () => {
      const text = "https://grafana.example.com/alerting/abc123/view?orgId=1";
      const result = extractGeneratorURL(text);

      expect(result).toBeNull();
    });

    it("should return null for URL with wrong emoji label", () => {
      const text = "*<https://grafana.example.com/alerting/abc123/view?orgId=1|:warning: Warning>*";
      const result = extractGeneratorURL(text);

      expect(result).toBeNull();
    });

    it("should return null for URL with different label text", () => {
      const text = "*<https://grafana.example.com/alerting/abc123/view?orgId=1|:arrow_right: View Dashboard>*";
      const result = extractGeneratorURL(text);

      expect(result).toBeNull();
    });

    it("should return null for empty string", () => {
      const result = extractGeneratorURL("");

      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should extract first URL when multiple links present", () => {
      const text = `*<https://grafana.example.com/alerting/first/view?orgId=1|:arrow_right: Go to alert>*
      *<https://grafana.example.com/alerting/second/view?orgId=1|:arrow_right: Go to alert>*`;
      const result = extractGeneratorURL(text);

      // Should return the first match
      expect(result).toBe("https://grafana.example.com/alerting/first/view?orgId=1");
    });

    it("should handle URL with special characters", () => {
      const text = "*<https://grafana.example.com/alerting/alert-123_test/view?orgId=1&var-job=app-1%2F2|:arrow_right: Go to alert>*";
      const result = extractGeneratorURL(text);

      expect(result).toBe("https://grafana.example.com/alerting/alert-123_test/view?orgId=1&var-job=app-1%2F2");
    });

    it("should handle URL with port number", () => {
      const text = "*<https://grafana.example.com:3000/alerting/abc123/view?orgId=1|:arrow_right: Go to alert>*";
      const result = extractGeneratorURL(text);

      expect(result).toBe("https://grafana.example.com:3000/alerting/abc123/view?orgId=1");
    });

    it("should handle URL with fragment", () => {
      const text = "*<https://grafana.example.com/alerting/abc123/view?orgId=1#tab=query|:arrow_right: Go to alert>*";
      const result = extractGeneratorURL(text);

      expect(result).toBe("https://grafana.example.com/alerting/abc123/view?orgId=1#tab=query");
    });
  });
});

describe("createBotModule", () => {
  let mockLogger: Logger;
  let mockOnAlert: ReturnType<typeof vi.fn>;
  let mockSay: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as Logger;

    mockOnAlert = vi.fn().mockResolvedValue(undefined);
    mockSay = vi.fn().mockResolvedValue(undefined);

    // Reset all mock functions from the shared state
    vi.clearAllMocks();
    appMockState.mockEventFn.mockClear();
    appMockState.mockAppStart.mockClear();
    appMockState.mockAppStop.mockClear();
  });

  describe("factory creation", () => {
    it("should return app, start, and stop functions", () => {
      const module = createBotModule({
        logger: mockLogger,
        onAlert: mockOnAlert as (ctx: InvocationContext, generatorURL: string) => Promise<void>,
      });

      expect(module).toHaveProperty("app");
      expect(module).toHaveProperty("start");
      expect(module).toHaveProperty("stop");
      expect(typeof module.start).toBe("function");
      expect(typeof module.stop).toBe("function");
    });

    it("should register app_mention event handler", () => {
      createBotModule({
        logger: mockLogger,
        onAlert: mockOnAlert as (ctx: InvocationContext, generatorURL: string) => Promise<void>,
      });

      expect(appMockState.mockEventFn).toHaveBeenCalledWith("app_mention", expect.any(Function));
    });
  });

  describe("app_mention handler - error paths", () => {
    it("should silently return for invalid event payload", async () => {
      createBotModule({
        logger: mockLogger,
        onAlert: mockOnAlert as (ctx: InvocationContext, generatorURL: string) => Promise<void>,
      });

      const handler = appMockState.mockEventFn.mock.calls[0][1];
      const invalidEvent = { text: "test" }; // Missing required fields

      await handler({ event: invalidEvent, say: mockSay });

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockSay).not.toHaveBeenCalled();
      expect(mockOnAlert).not.toHaveBeenCalled();
    });

    it("should reply with error when no Slack message link found", async () => {
      vi.mocked(parseSlackMessageLink).mockReturnValue(null);

      createBotModule({
        logger: mockLogger,
        onAlert: mockOnAlert as (ctx: InvocationContext, generatorURL: string) => Promise<void>,
      });

      const handler = appMockState.mockEventFn.mock.calls[0][1];
      const event = {
        text: "@SRE-Agent please check this alert",
        ts: "1234567890.123456",
        channel: "C123456",
        user: "U123456",
      };

      await handler({ event, say: mockSay });

      expect(mockSay).toHaveBeenCalledWith({
        text: "❌ Could not find a Slack message link in your message. Please include a link to the Grafana alert message.",
        thread_ts: "1234567890.123456",
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { text: event.text },
        "Could not parse Slack message link from @mention text"
      );
      expect(mockOnAlert).not.toHaveBeenCalled();
    });

    it("should reply with error when linked message cannot be fetched", async () => {
      vi.mocked(parseSlackMessageLink).mockReturnValue({
        channelID: "C987654",
        messageTS: "9876543210.987654",
      });
      vi.mocked(fetchLinkedMessage).mockResolvedValue(null);

      createBotModule({
        logger: mockLogger,
        onAlert: mockOnAlert as (ctx: InvocationContext, generatorURL: string) => Promise<void>,
      });

      const handler = appMockState.mockEventFn.mock.calls[0][1];
      const event = {
        text: "Check this https://myteam.slack.com/archives/C987654/p9876543210987654",
        ts: "1234567890.123456",
        channel: "C123456",
        user: "U123456",
      };

      await handler({ event, say: mockSay });

      expect(mockSay).toHaveBeenCalledWith({
        text: "❌ Could not fetch the linked message. Make sure the bot is a member of that channel.",
        thread_ts: "1234567890.123456",
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { linkedChannelID: "C987654", linkedMessageTS: "9876543210.987654" },
        "Could not fetch linked message - bot may not be in channel or message deleted"
      );
      expect(mockOnAlert).not.toHaveBeenCalled();
    });

    it("should reply with error when generatorURL not found in message", async () => {
      vi.mocked(parseSlackMessageLink).mockReturnValue({
        channelID: "C987654",
        messageTS: "9876543210.987654",
      });
      vi.mocked(fetchLinkedMessage).mockResolvedValue({
        text: "Just a regular message without Grafana alert",
        ts: "9876543210.987654",
      });

      createBotModule({
        logger: mockLogger,
        onAlert: mockOnAlert as (ctx: InvocationContext, generatorURL: string) => Promise<void>,
      });

      const handler = appMockState.mockEventFn.mock.calls[0][1];
      const event = {
        text: "Check this https://myteam.slack.com/archives/C987654/p9876543210987654",
        ts: "1234567890.123456",
        channel: "C123456",
        user: "U123456",
      };

      await handler({ event, say: mockSay });

      expect(mockSay).toHaveBeenCalledWith({
        text: '❌ Could not find a Grafana alert URL in the linked message. Expected a "Go to alert" link.',
        thread_ts: "1234567890.123456",
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          linkedMessageTS: "9876543210.987654",
          linkedChannelID: "C987654",
        }),
        "Could not extract generatorURL from linked message"
      );
      expect(mockOnAlert).not.toHaveBeenCalled();
    });
  });

  describe("app_mention handler - happy path", () => {
    it("should post acknowledgement and call onAlert with correct context", async () => {
      const generatorURL = "https://grafana.example.com/alerting/abc123/view?orgId=1";
      vi.mocked(parseSlackMessageLink).mockReturnValue({
        channelID: "C987654",
        messageTS: "9876543210.987654",
      });
      vi.mocked(fetchLinkedMessage).mockResolvedValue({
        text: `*<${generatorURL}|:arrow_right: Go to alert>*`,
        ts: "9876543210.987654",
      });

      createBotModule({
        logger: mockLogger,
        onAlert: mockOnAlert as (ctx: InvocationContext, generatorURL: string) => Promise<void>,
      });

      const handler = appMockState.mockEventFn.mock.calls[0][1];
      const event = {
        text: "Check this https://myteam.slack.com/archives/C987654/p9876543210987654",
        ts: "1234567890.123456",
        channel: "C123456",
        user: "U123456",
      };

      await handler({ event, say: mockSay });

      // Should post acknowledgement
      expect(mockSay).toHaveBeenCalledWith({
        text: "🔍 Investigating... I'll post the analysis here when done.",
        thread_ts: "1234567890.123456",
      });

      // Should call onAlert with correct context
      expect(mockOnAlert).toHaveBeenCalledWith(
        {
          triggerMessageTS: "1234567890.123456",
          triggerChannelID: "C123456",
          linkedMessageTS: "9876543210.987654",
          linkedChannelID: "C987654",
          requestedByUserID: "U123456",
        },
        generatorURL
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          triggerMessageTS: "1234567890.123456",
          linkedMessageTS: "9876543210.987654",
          generatorURL,
        },
        "Posting acknowledgement and invoking onAlert"
      );
    });

    it("should ack is posted before onAlert is called", async () => {
      const callOrder: string[] = [];
      
      mockSay.mockImplementation(async () => {
        callOrder.push("say");
      });
      (mockOnAlert as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push("onAlert");
      });

      vi.mocked(parseSlackMessageLink).mockReturnValue({
        channelID: "C987654",
        messageTS: "9876543210.987654",
      });
      vi.mocked(fetchLinkedMessage).mockResolvedValue({
        text: "*<https://grafana.example.com/alerting/abc123/view?orgId=1|:arrow_right: Go to alert>*",
        ts: "9876543210.987654",
      });

      createBotModule({
        logger: mockLogger,
        onAlert: mockOnAlert as (ctx: InvocationContext, generatorURL: string) => Promise<void>,
      });

      const handler = appMockState.mockEventFn.mock.calls[0][1];
      const event = {
        text: "Check this https://myteam.slack.com/archives/C987654/p9876543210987654",
        ts: "1234567890.123456",
        channel: "C123456",
        user: "U123456",
      };

      await handler({ event, say: mockSay });

      // Ack reply should come before onAlert
      expect(callOrder[0]).toBe("say");
      expect(callOrder[1]).toBe("onAlert");
    });
  });

  describe("app_mention handler - error handling", () => {
    it("should catch and log unexpected errors", async () => {
      vi.mocked(parseSlackMessageLink).mockImplementation(() => {
        throw new Error("Unexpected parsing error");
      });

      createBotModule({
        logger: mockLogger,
        onAlert: mockOnAlert as (ctx: InvocationContext, generatorURL: string) => Promise<void>,
      });

      const handler = appMockState.mockEventFn.mock.calls[0][1];
      const event = {
        text: "Check this https://myteam.slack.com/archives/C987654/p9876543210987654",
        ts: "1234567890.123456",
        channel: "C123456",
        user: "U123456",
      };

      // Should not throw
      await expect(handler({ event, say: mockSay })).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Unexpected parsing error",
        }),
        "Unhandled error in app_mention handler"
      );

      // Should attempt to post error reply
      expect(mockSay).toHaveBeenCalledWith({
        text: "❌ An unexpected error occurred while processing your request. Please try again later.",
        thread_ts: "1234567890.123456",
      });
    });

    it("should handle errors when posting error reply fails", async () => {
      vi.mocked(parseSlackMessageLink).mockImplementation(() => {
        throw new Error("Unexpected error");
      });
      mockSay.mockRejectedValue(new Error("Failed to post reply"));

      createBotModule({
        logger: mockLogger,
        onAlert: mockOnAlert as (ctx: InvocationContext, generatorURL: string) => Promise<void>,
      });

      const handler = appMockState.mockEventFn.mock.calls[0][1];
      const event = {
        text: "test",
        ts: "1234567890.123456",
        channel: "C123456",
        user: "U123456",
      };

      // Should not throw even when error reply fails
      await expect(handler({ event, say: mockSay })).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          replyError: expect.any(Error),
        }),
        "Failed to post error reply to thread"
      );
    });
  });
});
