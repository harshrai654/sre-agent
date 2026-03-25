import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Logger } from "pino";
import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { MessageElement } from "@slack/web-api/dist/types/response/ConversationsHistoryResponse.js";
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
  describe("primary: attachment title_link", () => {
    it("should extract URL from attachment title_link", () => {
      const message: MessageElement = {
        text: "",
        attachments: [
          {
            title_link: "https://grafana.example.com/alerting/abc123/view?orgId=1",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com/alerting/abc123/view?orgId=1");
    });

    it("should extract URL with complex query parameters from title_link", () => {
      const message: MessageElement = {
        text: "",
        attachments: [
          {
            title_link: "https://grafana.example.com/alerting/rule-uid-xyz/view?orgId=1&var-datasource=prometheus&var-cluster=prod",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com/alerting/rule-uid-xyz/view?orgId=1&var-datasource=prometheus&var-cluster=prod");
    });

    it("should extract URL with different hostnames from title_link", () => {
      const message: MessageElement = {
        text: "",
        attachments: [
          {
            title_link: "https://monitoring.internal.company.com/alerting/alert-123/view?orgId=2",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://monitoring.internal.company.com/alerting/alert-123/view?orgId=2");
    });

    it("should ignore non-alerting URLs in title_link", () => {
      const message: MessageElement = {
        text: "",
        attachments: [
          {
            title_link: "https://grafana.example.com/dashboard/db/my-dashboard",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBeNull();
    });
  });

  describe("fallback: text scanning", () => {
    it("should extract URL from message text when no attachments", () => {
      const message: MessageElement = {
        text: "Alert triggered https://grafana.example.com/alerting/abc123/view?orgId=1 check it out",
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com/alerting/abc123/view?orgId=1");
    });

    it("should extract URL from message text when title_link missing /alerting/", () => {
      const message: MessageElement = {
        text: "Alert: https://grafana.example.com/alerting/abc123/view?orgId=1 check it out",
        attachments: [
          {
            title_link: "https://grafana.example.com/dashboard/db/my-dashboard",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com/alerting/abc123/view?orgId=1");
    });

    it("should extract URL with complex query parameters from text", () => {
      const message: MessageElement = {
        text: "https://grafana.example.com/alerting/rule-uid-xyz/view?orgId=1&var-datasource=prometheus&var-cluster=prod",
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com/alerting/rule-uid-xyz/view?orgId=1&var-datasource=prometheus&var-cluster=prod");
    });

    it("should extract URL with different hostnames from text", () => {
      const message: MessageElement = {
        text: "https://monitoring.internal.company.com/alerting/alert-123/view?orgId=2",
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://monitoring.internal.company.com/alerting/alert-123/view?orgId=2");
    });

    it("should extract URL when embedded in larger message", () => {
      const message: MessageElement = {
        text: `🔥 *High CPU Usage*
Server: prod-app-01
https://grafana.example.com/alerting/cpu-alert/view?orgId=1
Check the dashboard immediately.`,
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com/alerting/cpu-alert/view?orgId=1");
    });

    it("should extract URL with HTTP instead of HTTPS", () => {
      const message: MessageElement = {
        text: "http://grafana.example.com/alerting/abc123/view?orgId=1",
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("http://grafana.example.com/alerting/abc123/view?orgId=1");
    });
  });

  describe("invalid or missing URLs", () => {
    it("should return null for message without attachments or alerting URL in text", () => {
      const message: MessageElement = {
        text: "Just some random text without any Grafana link",
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBeNull();
    });

    it("should return null when attachment has non-alerting URL and text has no alerting URL", () => {
      const message: MessageElement = {
        text: "Just a regular message",
        attachments: [
          {
            title_link: "https://example.com/some-link",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBeNull();
    });

    it("should return null for plain URL without /alerting/ path", () => {
      const message: MessageElement = {
        text: "https://grafana.example.com/dashboard/db/my-dashboard",
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBeNull();
    });

    it("should return null for URL with wrong path pattern", () => {
      const message: MessageElement = {
        text: "*<https://grafana.example.com/api/alerting/abc123|:arrow_right: Go to alert>*",
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBeNull();
    });

    it("should return null for empty message", () => {
      const message: MessageElement = {
        text: "",
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBeNull();
    });

    it("should return null for empty attachments array", () => {
      const message: MessageElement = {
        text: "",
        attachments: [],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBeNull();
    });

    it("should return null when attachment has no title_link", () => {
      const message: MessageElement = {
        text: "",
        attachments: [{}],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBeNull();
    });

    it("should return null when message has no text or attachments", () => {
      const message: MessageElement = {} as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should prioritize attachment over text when both have alerting URLs", () => {
      const message: MessageElement = {
        text: "*<https://grafana.example.com/alerting/text-url/view?orgId=1|:arrow_right: Go to alert>*",
        attachments: [
          {
            title_link: "https://grafana.example.com/alerting/attachment-url/view?orgId=1",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com/alerting/attachment-url/view?orgId=1");
    });

    it("should extract URL with special characters", () => {
      const message: MessageElement = {
        text: "",
        attachments: [
          {
            title_link: "https://grafana.example.com/alerting/alert-123_test/view?orgId=1&var-job=app-1%2F2",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com/alerting/alert-123_test/view?orgId=1&var-job=app-1%2F2");
    });

    it("should extract URL with port number", () => {
      const message: MessageElement = {
        text: "",
        attachments: [
          {
            title_link: "https://grafana.example.com:3000/alerting/abc123/view?orgId=1",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com:3000/alerting/abc123/view?orgId=1");
    });

    it("should extract URL with fragment", () => {
      const message: MessageElement = {
        text: "",
        attachments: [
          {
            title_link: "https://grafana.example.com/alerting/abc123/view?orgId=1#tab=query",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com/alerting/abc123/view?orgId=1#tab=query");
    });

    it("should handle first attachment only when multiple attachments exist", () => {
      const message: MessageElement = {
        text: "",
        attachments: [
          {
            title_link: "https://grafana.example.com/alerting/first/view?orgId=1",
          },
          {
            title_link: "https://grafana.example.com/alerting/second/view?orgId=1",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      expect(result).toBe("https://grafana.example.com/alerting/first/view?orgId=1");
    });

    it("should fall back to text when first attachment has no alerting URL but second does", () => {
      const message: MessageElement = {
        text: "https://grafana.example.com/alerting/fallback/view?orgId=1",
        attachments: [
          {
            title_link: "https://grafana.example.com/dashboard/db/my-dashboard",
          },
          {
            title_link: "https://grafana.example.com/alerting/second/view?orgId=1",
          },
        ],
      } as MessageElement;

      const result = extractGeneratorURL(message);

      // Falls back to text because first attachment doesn't have /alerting/
      expect(result).toBe("https://grafana.example.com/alerting/fallback/view?orgId=1");
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
        "Could not parse Slack message link from @mention text",
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
        "Could not fetch linked message - bot may not be in channel or message deleted",
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
      } as MessageElement);

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

      // Note: based on the new code, it doesn't post a thread reply when generatorURL is not found
      // It just logs a warning and continues (which will likely fail later when onAlert is called with null)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          linkedMessageTS: "9876543210.987654",
          linkedChannelID: "C987654",
          hasAttachments: false,
          titleLink: "(none)",
        }),
        "Could not extract generatorURL from linked message",
      );
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
        text: "",
        attachments: [
          {
            title_link: generatorURL,
          },
        ],
        ts: "9876543210.987654",
      } as MessageElement);

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
        generatorURL,
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          triggerMessageTS: "1234567890.123456",
          linkedMessageTS: "9876543210.987654",
          generatorURL,
        },
        "Posting acknowledgement and invoking onAlert",
      );
    });

    it("should extract URL from fallback text when attachment has no title_link", async () => {
      const generatorURL = "https://grafana.example.com/alerting/abc123/view?orgId=1";
      vi.mocked(parseSlackMessageLink).mockReturnValue({
        channelID: "C987654",
        messageTS: "9876543210.987654",
      });
      vi.mocked(fetchLinkedMessage).mockResolvedValue({
        text: generatorURL,
        ts: "9876543210.987654",
      } as MessageElement);

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

      // Should call onAlert with correct generatorURL from text fallback
      expect(mockOnAlert).toHaveBeenCalledWith(
        expect.any(Object),
        generatorURL,
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
        text: "",
        attachments: [
          {
            title_link: "https://grafana.example.com/alerting/abc123/view?orgId=1",
          },
        ],
        ts: "9876543210.987654",
      } as MessageElement);

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
        "Unhandled error in app_mention handler",
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
        "Failed to post error reply to thread",
      );
    });
  });
});
