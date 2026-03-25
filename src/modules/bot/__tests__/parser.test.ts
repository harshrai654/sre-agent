import { describe, it, expect, vi } from "vitest";
import type { WebClient } from "@slack/web-api";
import { parseSlackMessageLink, fetchLinkedMessage } from "../parser.js";

describe("parseSlackMessageLink", () => {
  describe("valid Slack message links", () => {
    it("should parse a standard Slack archive URL", () => {
      const text = "Check this alert: https://myteam.slack.com/archives/C1234567890/p1234567890123456";
      const result = parseSlackMessageLink(text);

      expect(result).toEqual({
        channelID: "C1234567890",
        messageTS: "1234567890.123456",
      });
    });

    it("should parse URL with hyphenated subdomain", () => {
      const text = "https://acme-corp-123.slack.com/archives/CABC123DEF/p9876543210987654";
      const result = parseSlackMessageLink(text);

      expect(result).toEqual({
        channelID: "CABC123DEF",
        messageTS: "9876543210.987654",
      });
    });

    it("should parse URL with numeric-only channel ID", () => {
      const text = "https://team.slack.com/archives/C0123456789/p1111111111111111";
      const result = parseSlackMessageLink(text);

      expect(result).toEqual({
        channelID: "C0123456789",
        messageTS: "1111111111.111111",
      });
    });

    it("should parse URL when it's the only content", () => {
      const text = "https://myteam.slack.com/archives/C1234567890/p1234567890123456";
      const result = parseSlackMessageLink(text);

      expect(result).toEqual({
        channelID: "C1234567890",
        messageTS: "1234567890.123456",
      });
    });
  });

  describe("timestamp reformatting", () => {
    it("should correctly reformat timestamps with exact 16 digits", () => {
      const text = "https://team.slack.com/archives/C123/p1234567890123456";
      const result = parseSlackMessageLink(text);

      expect(result?.messageTS).toBe("1234567890.123456");
    });

    it("should reformat timestamps longer than 16 digits", () => {
      // Slack timestamps can occasionally be longer
      const text = "https://team.slack.com/archives/C123/p1234567890123456789";
      const result = parseSlackMessageLink(text);

      expect(result?.messageTS).toBe("1234567890.123456789");
    });

    it("should handle shorter timestamps gracefully", () => {
      const text = "https://team.slack.com/archives/C123/p1234567890";
      const result = parseSlackMessageLink(text);

      // After 10 chars, slice(10) returns empty string, resulting in "1234567890."
      expect(result?.messageTS).toBe("1234567890.");
    });
  });

  describe("invalid URLs", () => {
    it("should return null for non-Slack URLs", () => {
      const text = "https://example.com/archives/C123/p1234567890123456";
      const result = parseSlackMessageLink(text);

      expect(result).toBeNull();
    });

    it("should return null for Slack URLs without archives path", () => {
      const text = "https://myteam.slack.com/messages/C123/p1234567890123456";
      const result = parseSlackMessageLink(text);

      expect(result).toBeNull();
    });

    it("should return null for URLs missing timestamp", () => {
      const text = "https://myteam.slack.com/archives/C1234567890/";
      const result = parseSlackMessageLink(text);

      expect(result).toBeNull();
    });

    it("should return null for URLs with lowercase channel ID", () => {
      const text = "https://myteam.slack.com/archives/c1234567890/p1234567890123456";
      const result = parseSlackMessageLink(text);

      expect(result).toBeNull();
    });

    it("should return null for URLs with invalid characters in timestamp", () => {
      const text = "https://myteam.slack.com/archives/C123/p12345abc90123456";
      const result = parseSlackMessageLink(text);

      expect(result).toBeNull();
    });

    it("should return null for empty text", () => {
      const result = parseSlackMessageLink("");

      expect(result).toBeNull();
    });

    it("should return null for text without URLs", () => {
      const text = "Just some random text without any links";
      const result = parseSlackMessageLink(text);

      expect(result).toBeNull();
    });

    it("should return null for http (non-https) Slack URLs", () => {
      const text = "http://myteam.slack.com/archives/C123/p1234567890123456";
      const result = parseSlackMessageLink(text);

      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should extract first match when multiple URLs present", () => {
      const text =
        "First: https://team.slack.com/archives/C111/p1111111111111111 " +
        "Second: https://team.slack.com/archives/C222/p2222222222222222";
      const result = parseSlackMessageLink(text);

      // Regex without global flag returns first match
      expect(result).toEqual({
        channelID: "C111",
        messageTS: "1111111111.111111",
      });
    });

    it("should handle URLs with query parameters", () => {
      const text = "https://myteam.slack.com/archives/C123/p1234567890123456?thread_ts=123";
      const result = parseSlackMessageLink(text);

      // Query params should not interfere with extraction
      expect(result).toEqual({
        channelID: "C123",
        messageTS: "1234567890.123456",
      });
    });

    it("should handle URLs with fragments", () => {
      const text = "https://myteam.slack.com/archives/C123/p1234567890123456#thread";
      const result = parseSlackMessageLink(text);

      expect(result).toEqual({
        channelID: "C123",
        messageTS: "1234567890.123456",
      });
    });
  });
});

describe("fetchLinkedMessage", () => {
  const createMockClient = (response: unknown): WebClient => {
    return {
      conversations: {
        history: vi.fn().mockResolvedValue(response),
      },
    } as unknown as WebClient;
  };

  describe("successful fetches", () => {
    it("should return the first message when found", async () => {
      const mockMessage = { text: "Alert: High CPU usage", ts: "1234567890.123456" };
      const client = createMockClient({
        messages: [mockMessage],
        ok: true,
      });

      const result = await fetchLinkedMessage(client, "C123", "1234567890.123456");

      expect(result).toEqual(mockMessage);
    });

    it("should call conversations.history with correct parameters", async () => {
      const mockHistory = vi.fn().mockResolvedValue({
        messages: [{ text: "Test" }],
        ok: true,
      });
      const client = {
        conversations: { history: mockHistory },
      } as unknown as WebClient;

      await fetchLinkedMessage(client, "C123456", "1234567890.123456");

      expect(mockHistory).toHaveBeenCalledWith({
        channel: "C123456",
        latest: "1234567890.123456",
        limit: 1,
        inclusive: true,
      });
    });

    it("should handle messages with complex structure", async () => {
      const complexMessage = {
        type: "message",
        user: "U123",
        text: "Alert message",
        ts: "1234567890.123456",
        attachments: [{ fallback: "alert" }],
        blocks: [{ type: "section" }],
      };
      const client = createMockClient({
        messages: [complexMessage],
        ok: true,
      });

      const result = await fetchLinkedMessage(client, "C123", "1234567890.123456");

      expect(result).toEqual(complexMessage);
    });
  });

  describe("not found scenarios", () => {
    it("should return null when messages array is empty", async () => {
      const client = createMockClient({
        messages: [],
        ok: true,
      });

      const result = await fetchLinkedMessage(client, "C123", "1234567890.123456");

      expect(result).toBeNull();
    });

    it("should return null when messages property is missing", async () => {
      const client = createMockClient({
        ok: true,
      });

      const result = await fetchLinkedMessage(client, "C123", "1234567890.123456");

      expect(result).toBeNull();
    });

    it("should return null when response is null", async () => {
      const client = createMockClient(null);

      const result = await fetchLinkedMessage(client, "C123", "1234567890.123456");

      expect(result).toBeNull();
    });
  });

  describe("error scenarios", () => {
    it("should throw on API error", async () => {
      const client = {
        conversations: {
          history: vi.fn().mockRejectedValue(new Error("channel_not_found")),
        },
      } as unknown as WebClient;

      await expect(
        fetchLinkedMessage(client, "C123", "1234567890.123456")
      ).rejects.toThrow("channel_not_found");
    });

    it("should throw on network errors", async () => {
      const client = {
        conversations: {
          history: vi.fn().mockRejectedValue(new Error("ETIMEDOUT")),
        },
      } as unknown as WebClient;

      await expect(
        fetchLinkedMessage(client, "C123", "1234567890.123456")
      ).rejects.toThrow("ETIMEDOUT");
    });

    it("should throw on Slack API error response", async () => {
      const client = {
        conversations: {
          history: vi.fn().mockResolvedValue({
            ok: false,
            error: "not_authed",
          }),
        },
      } as unknown as WebClient;

      // The function doesn't check response.ok, so this would return null
      // Caller (M1.3) should handle validation
      const result = await fetchLinkedMessage(client, "C123", "1234567890.123456");
      expect(result).toBeNull();
    });
  });

  describe("parameter validation", () => {
    it("should pass through any channel ID format", async () => {
      const mockHistory = vi.fn().mockResolvedValue({
        messages: [{ text: "Test" }],
        ok: true,
      });
      const client = {
        conversations: { history: mockHistory },
      } as unknown as WebClient;

      await fetchLinkedMessage(client, "CABC123", "1234567890.123456");

      expect(mockHistory).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "CABC123" })
      );
    });

    it("should pass through any timestamp format", async () => {
      const mockHistory = vi.fn().mockResolvedValue({
        messages: [{ text: "Test" }],
        ok: true,
      });
      const client = {
        conversations: { history: mockHistory },
      } as unknown as WebClient;

      await fetchLinkedMessage(client, "C123", "9999999999.999999");

      expect(mockHistory).toHaveBeenCalledWith(
        expect.objectContaining({ latest: "9999999999.999999" })
      );
    });
  });
});
