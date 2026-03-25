import type { WebClient } from "@slack/web-api";
import type { MessageElement } from "@slack/web-api/dist/types/response/ConversationsHistoryResponse.js";

/**
 * Result of parsing a Slack message link.
 */
export interface SlackMessageLink {
  channelID: string;
  messageTS: string;
}

/**
 * Parses a Slack message link from @mention text.
 *
 * Regex matches: https://[subdomain].slack.com/archives/[CHANNEL_ID]/p[TIMESTAMP]
 * - subdomain: alphanumeric with hyphens (e.g., "myteam", "acme-corp-123")
 * - CHANNEL_ID: uppercase alphanumeric (e.g., "C1234567890")
 * - TIMESTAMP: numeric, Slack's "p" format without decimal (e.g., "p1234567890123456")
 *
 * The timestamp is reformatted by inserting a dot 10 characters from the start:
 * p1234567890123456 → "1234567890.123456"
 *
 * @param text - The text to parse
 * @returns {SlackMessageLink | null} Parsed link or null if no match
 */
export function parseSlackMessageLink(text: string): SlackMessageLink | null {
  // Require at least 10 digits for the seconds part, any number of digits for the microseconds part
  const regex = /https:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p([0-9]{10,})/;
  const match = regex.exec(text);

  if (!match) {
    return null;
  }

  const channelID = match[1];
  const timestampPart = match[2];

  // Reformat timestamp: insert dot 10 characters from start
  // Slack format: p1234567890123456 (no dot)
  // API format: 1234567890.123456 (with dot)
  const messageTS = `${timestampPart.slice(0, 10)}.${timestampPart.slice(10)}`;

  return { channelID, messageTS };
}

/**
 * Fetches a specific Slack message using conversations.history.
 *
 * Uses inclusive search with limit 1 to retrieve the exact message.
 * Returns null (not an error) when message not found — this allows M1.3 to
 * distinguish "link is broken/missing" from "Slack API is down".
 * Throws only on network/API errors.
 *
 * @param client - Slack WebClient instance
 * @param channelID - The channel ID where the message was posted
 * @param messageTS - The message timestamp in API format (with dot)
 * @returns The message object or null if not found
 * @throws Error on network or API failures
 */
export async function fetchLinkedMessage(
  client: WebClient,
  channelID: string,
  messageTS: string
): Promise<MessageElement | null> {
  const response = await client.conversations.history({
    channel: channelID,
    latest: messageTS,
    limit: 1,
    inclusive: true,
  });

  if (!response || !response.messages || response.messages.length === 0) {
    return null;
  }

  return response.messages[0];
}
