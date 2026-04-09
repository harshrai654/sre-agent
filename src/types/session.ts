import { z } from "zod";
import type { LiveAlertState } from "./grafana.js";

/**
 * InvocationContext captures the Slack-specific metadata about how the SRE agent
 * was invoked. It tracks both the triggering @mention message and the original
 * Grafana alert message that was linked.
 */
export interface InvocationContext {
  triggerMessageTS: string;      // ts of the @mention message
  triggerChannelID: string;      // channel where @mention occurred
  linkedMessageTS: string;       // ts of the linked Grafana alert message
  linkedChannelID: string;       // channel where Grafana alert was posted
  requestedByUserID: string;     // Slack user ID of the engineer
}

/**
 * SessionContext is the complete runtime context passed to the DeepAgent.
 * It includes the invocation metadata, live alert state, the assembled system
 * prompt, and any files that should be made available to the agent (e.g.,
 * `/ALERT_CONTEXT.md`, optional AGENTS.md content).
 */
export interface SessionContext {
  invocation: InvocationContext;
  liveAlertState: LiveAlertState;
  systemPrompt: string;
  files: Record<string, string>; // always includes "/ALERT_CONTEXT.md"
}

/**
 * AnalysisResult contains the output of the DeepAgent session along with all
 * the input context needed for debugging and traceability.
 */
export interface AnalysisResult {
  invocation: InvocationContext;
  liveAlertState: LiveAlertState;
  analysis: string;
  conversationTranscript: string;
}

/**
 * Zod schema for Slack app_mention event — validates only the fields we use.
 * This schema is intentionally minimal; we only extract the data needed to
 * trigger the SRE agent workflow.
 */
export const SlackMentionPayloadSchema = z.object({
  text: z.string(),
  ts: z.string(),
  channel: z.string(),
  user: z.string(),
  thread_ts: z.string().optional(),
});

export type SlackMentionPayload = z.infer<typeof SlackMentionPayloadSchema>;
