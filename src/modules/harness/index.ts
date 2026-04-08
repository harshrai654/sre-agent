import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import pino from "pino";
import type { AnalysisResult, SessionContext } from "../../types/session.js";

function requireEnv(
  name: "GRAFANA_MCP_URL" | "LLM_MODEL" | "OPENAI_API_KEY",
): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is required`);
  }
  return v;
}

const GRAFANA_MCP_URL = requireEnv("GRAFANA_MCP_URL");
const LLM_MODEL = requireEnv("LLM_MODEL");
const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

/** DeepAgents file state uses line arrays; SessionContext supplies plain strings from M2.4. */
function sessionFilesToAgentFiles(
  files: Record<string, string>,
): Record<
  string,
  { content: string[]; created_at: string; modified_at: string }
> {
  const now = new Date().toISOString();
  const out: Record<
    string,
    { content: string[]; created_at: string; modified_at: string }
  > = {};
  for (const [path, text] of Object.entries(files)) {
    out[path] = {
      content: text.split("\n"),
      created_at: now,
      modified_at: now,
    };
  }
  return out;
}

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: string }).type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  );
}

/**
 * Text from a message for transcript / display. Array blocks are joined with newlines.
 */
function contentToTranscriptString(content: BaseMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return String(content);
  }
  return content
    .map((block) => {
      if (isTextBlock(block)) {
        return block.text;
      }
      const asRec = block as unknown as { type?: string; reasoning?: string };
      if (asRec.type === "reasoning" && typeof asRec.reasoning === "string") {
        return asRec.reasoning;
      }
      try {
        return JSON.stringify(block);
      } catch {
        return String(block);
      }
    })
    .join("\n");
}

/**
 * Walk messages from the end; return the first AI message's primary text (string or first `text` block).
 */
export function extractFinalMessage(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message._getType() !== "ai") {
      continue;
    }
    const { content } = message;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const textBlock = content.find(isTextBlock);
      if (textBlock) {
        return textBlock.text;
      }
    }
    return "(agent produced no output)";
  }
  return "(agent produced no output)";
}

function headerForMessage(message: BaseMessage): string {
  const t = message._getType();
  if (t === "human") {
    return "### HUMAN";
  }
  if (t === "ai") {
    return "### AI";
  }
  if (t === "tool") {
    const name =
      typeof (message as { name?: string }).name === "string"
        ? (message as { name: string }).name
        : undefined;
    return name ? `### TOOL (${name})` : "### TOOL";
  }
  return "### UNKNOWN";
}

/**
 * Readable transcript for logs and downstream modules (e.g. persistence / audit).
 */
export function formatTranscript(messages: BaseMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    parts.push(headerForMessage(message));
    parts.push(contentToTranscriptString(message.content));
    parts.push("");
    parts.push("---");
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

export async function runAgentSession(
  context: SessionContext,
): Promise<AnalysisResult> {
  const mcpClient = new MultiServerMCPClient({
    grafana: {
      url: GRAFANA_MCP_URL,
      transport: "http",
    },
  });

  try {
    const mcpTools = await mcpClient.getTools();

    logger.debug(
      { tools: mcpTools.map((t) => t.name) },
      "MCP tools discovered",
    );

    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: LLM_MODEL,
        apiKey: OPENAI_API_KEY,
      }),
      tools: mcpTools,
      systemPrompt: context.systemPrompt,
    });

    const result = await agent.invoke({
      messages: [
        new HumanMessage(
          "Read ALERT_CONTEXT.md and complete the investigation task described in it.",
        ),
      ],
      files: sessionFilesToAgentFiles(context.files),
    });

    const messages = result.messages as BaseMessage[];
    const analysis = extractFinalMessage(messages);
    const conversationTranscript = formatTranscript(messages);

    logger.debug({ conversationTranscript }, "Agent conversation transcript");
    logger.info(
      { messageCount: messages.length, analysisLength: analysis.length },
      "Agent session complete",
    );

    return {
      invocation: context.invocation,
      liveAlertState: context.liveAlertState,
      analysis,
      conversationTranscript,
    };
  } finally {
    try {
      await mcpClient.close();
    } catch (closeErr) {
      logger.warn({ err: closeErr }, "Error closing MCP client after session");
    }
  }
}
