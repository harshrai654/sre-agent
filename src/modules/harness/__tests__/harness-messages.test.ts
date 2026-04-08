import { describe, it, expect, beforeAll } from "vitest";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

let extractFinalMessage: (messages: BaseMessage[]) => string;
let formatTranscript: (messages: BaseMessage[]) => string;

beforeAll(async () => {
  process.env.GRAFANA_MCP_URL = "http://localhost/mcp";
  process.env.LLM_MODEL = "gpt-4o-mini";
  process.env.OPENAI_API_KEY = "test-key-for-unit-tests";
  const mod = await import("../index.js");
  extractFinalMessage = mod.extractFinalMessage;
  formatTranscript = mod.formatTranscript;
});

describe("extractFinalMessage", () => {
  it("should return the last AI message when content is a string", () => {
    const messages: BaseMessage[] = [
      new HumanMessage("hello"),
      new AIMessage("first reply"),
      new AIMessage("final reply"),
    ];
    expect(extractFinalMessage(messages)).toBe("final reply");
  });

  it("should walk from the end and skip tool messages after the final AI", () => {
    const messages: BaseMessage[] = [
      new AIMessage("analysis complete"),
      new ToolMessage({
        content: '{"ok":true}',
        tool_call_id: "call_1",
        name: "some_tool",
      }),
    ];
    expect(extractFinalMessage(messages)).toBe("analysis complete");
  });

  it("should return text from the first text block when AI content is an array", () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: [
          { type: "text", text: "visible answer" },
          { type: "text", text: "ignored second block" },
        ],
      }),
    ];
    expect(extractFinalMessage(messages)).toBe("visible answer");
  });

  it("should use the last AI message when multiple AI messages exist", () => {
    const messages: BaseMessage[] = [
      new AIMessage("older"),
      new HumanMessage("follow-up"),
      new AIMessage("newer"),
    ];
    expect(extractFinalMessage(messages)).toBe("newer");
  });

  it("should return placeholder when the last AI message has no text block", () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: [{ type: "reasoning", reasoning: "thinking only" }],
      }),
    ];
    expect(extractFinalMessage(messages)).toBe("(agent produced no output)");
  });

  it("should return placeholder when there are no AI messages", () => {
    const messages: BaseMessage[] = [new HumanMessage("only human")];
    expect(extractFinalMessage(messages)).toBe("(agent produced no output)");
  });
});

describe("formatTranscript", () => {
  it("should serialize human, AI, and tool roles with separators", () => {
    const messages: BaseMessage[] = [
      new HumanMessage("task"),
      new AIMessage("done"),
      new ToolMessage({
        content: "result json",
        tool_call_id: "id1",
        name: "grafana_query",
      }),
    ];
    const out = formatTranscript(messages);
    expect(out).toContain("### HUMAN");
    expect(out).toContain("task");
    expect(out).toContain("### AI");
    expect(out).toContain("done");
    expect(out).toContain("### TOOL (grafana_query)");
    expect(out).toContain("result json");
    expect(out).toContain("---");
  });

  it("should include tool name in header when present", () => {
    const messages: BaseMessage[] = [
      new ToolMessage({
        content: "x",
        tool_call_id: "t",
        name: "my_tool",
      }),
    ];
    expect(formatTranscript(messages)).toContain("### TOOL (my_tool)");
  });

  it("should join array content blocks with newlines in transcript", () => {
    const messages: BaseMessage[] = [
      new AIMessage({
        content: [
          { type: "text", text: "line a" },
          { type: "text", text: "line b" },
        ],
      }),
    ];
    const out = formatTranscript(messages);
    expect(out).toContain("line a\nline b");
  });
});
