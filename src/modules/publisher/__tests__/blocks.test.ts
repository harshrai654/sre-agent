import { describe, it, expect } from "vitest";
import { buildAnalysisBlocks } from "../blocks.js";
import type { AnalysisResult, InvocationContext } from "../../../types/session.js";
import type { LiveAlertState } from "../../../types/grafana.js";

const createMockLiveAlertState = (
  overrides?: Partial<LiveAlertState>,
): LiveAlertState => ({
  ruleUID: "rule-uid-1",
  ruleName: "HighErrorRate",
  generatorURL: "https://grafana.example.com/alerting/rule-uid-1/view",
  state: "firing",
  health: "ok",
  folderUID: "folder-1",
  ruleGroup: "default",
  labels: {},
  annotations: {},
  isPaused: false,
  ...overrides,
});

const createMockInvocation = (
  overrides?: Partial<InvocationContext>,
): InvocationContext => ({
  triggerMessageTS: "1.0",
  triggerChannelID: "C1",
  linkedMessageTS: "2.0",
  linkedChannelID: "C2",
  requestedByUserID: "U12345",
  ...overrides,
});

const createMockAnalysisResult = (
  overrides?: Partial<AnalysisResult>,
): AnalysisResult => ({
  invocation: createMockInvocation(),
  liveAlertState: createMockLiveAlertState(),
  analysis: "Root cause: latency spike.",
  conversationTranscript: "",
  ...overrides,
});

describe("buildAnalysisBlocks", () => {
  describe("structure and ordering", () => {
    it("should start with header, context, divider, end with divider", () => {
      const blocks = buildAnalysisBlocks(createMockAnalysisResult());
      expect(blocks[0]).toMatchObject({
        type: "header",
        text: { type: "plain_text", text: "🤖 SRE Agent Analysis", emoji: true },
      });
      expect(blocks[1]).toMatchObject({ type: "context" });
      expect(blocks[2]).toMatchObject({ type: "divider" });
      expect(blocks[blocks.length - 1]).toMatchObject({ type: "divider" });
    });

    it("should include rule, state, active since, and requester in context", () => {
      const blocks = buildAnalysisBlocks(
        createMockAnalysisResult({
          liveAlertState: createMockLiveAlertState({
            ruleName: "MyRule",
            state: "pending",
            activeAt: "2024-06-01T12:00:00Z",
          }),
          invocation: createMockInvocation({ requestedByUserID: "U999" }),
        }),
      );
      const ctx = blocks[1] as {
        type: "context";
        elements: { type: string; text: string }[];
      };
      expect(ctx.elements).toHaveLength(4);
      expect(ctx.elements[0].text).toBe("*Rule:* MyRule");
      expect(ctx.elements[1].text).toBe("*State:* pending");
      expect(ctx.elements[2].text).toBe("*Active since:* 2024-06-01T12:00:00Z");
      expect(ctx.elements[3].text).toBe("*Requested by:* <@U999>");
    });

    it("should use unknown for activeAt when absent", () => {
      const blocks = buildAnalysisBlocks(
        createMockAnalysisResult({
          liveAlertState: createMockLiveAlertState({ activeAt: undefined }),
        }),
      );
      const ctx = blocks[1] as {
        type: "context";
        elements: { text: string }[];
      };
      expect(ctx.elements[2].text).toContain("unknown");
    });
  });

  describe("analysis sections and 3000-char chunking", () => {
    it("should emit one section block for short analysis", () => {
      const blocks = buildAnalysisBlocks(createMockAnalysisResult());
      const sections = blocks.filter((b) => b.type === "section");
      expect(sections).toHaveLength(1);
      expect(sections[0]).toMatchObject({
        type: "section",
        text: { type: "mrkdwn", text: "Root cause: latency spike." },
      });
    });

    it("should split on newlines before exceeding 3000 characters", () => {
      const lineA = "a".repeat(2000);
      const lineB = "b".repeat(2000);
      const analysis = `${lineA}\n${lineB}`;
      const blocks = buildAnalysisBlocks(
        createMockAnalysisResult({ analysis }),
      );
      const sections = blocks.filter((b) => b.type === "section");
      expect(sections.length).toBeGreaterThanOrEqual(2);
      for (const s of sections) {
        if (s.type === "section" && s.text?.type === "mrkdwn") {
          expect(s.text.text.length).toBeLessThanOrEqual(3000);
        }
      }
    });

    it("should hard-split a single line longer than 3000 characters", () => {
      const longLine = "x".repeat(6500);
      const blocks = buildAnalysisBlocks(
        createMockAnalysisResult({ analysis: longLine }),
      );
      const sections = blocks.filter((b) => b.type === "section");
      expect(sections.length).toBe(3);
      for (const s of sections) {
        if (s.type === "section" && s.text?.type === "mrkdwn") {
          expect(s.text.text.length).toBeLessThanOrEqual(3000);
        }
      }
      const texts = sections.map((s) =>
        s.type === "section" && s.text?.type === "mrkdwn" ? s.text.text : "",
      );
      expect(texts.join("")).toBe(longLine);
    });

    it("should use placeholder section for empty analysis", () => {
      const blocks = buildAnalysisBlocks(
        createMockAnalysisResult({ analysis: "   " }),
      );
      const sections = blocks.filter((b) => b.type === "section");
      expect(sections).toHaveLength(1);
      expect(sections[0]).toMatchObject({
        type: "section",
        text: { type: "mrkdwn", text: "_No analysis returned._" },
      });
    });
  });

  describe("block count", () => {
    it("should have fixed non-analysis blocks plus one section per chunk", () => {
      const blocks = buildAnalysisBlocks(createMockAnalysisResult());
      // header + context + divider + 1 section + divider
      expect(blocks.length).toBe(5);
    });
  });
});
