import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Logger } from "pino";
import type { AnalysisResult, InvocationContext } from "../../../types/session.js";
import type { LiveAlertState } from "../../../types/grafana.js";

const { mockPostMessage } = vi.hoisted(() => ({
  mockPostMessage: vi.fn().mockResolvedValue({
    ok: true,
    ts: "1234.5678",
    channel: "C1",
  }),
}));

vi.mock("@slack/web-api", () => ({
  WebClient: class MockWebClient {
    chat = { postMessage: mockPostMessage };
  },
}));

import { createPublisherModule } from "../index.js";

const createMockLiveAlertState = (
  overrides?: Partial<LiveAlertState>,
): LiveAlertState => ({
  ruleUID: "rule-1",
  ruleName: "TestRule",
  generatorURL: "https://grafana.example.com/alerting/rule-1/view",
  state: "firing",
  health: "ok",
  folderUID: "f1",
  ruleGroup: "g1",
  labels: {},
  annotations: {},
  isPaused: false,
  ...overrides,
});

const createMockInvocation = (
  overrides?: Partial<InvocationContext>,
): InvocationContext => ({
  triggerMessageTS: "111.222",
  triggerChannelID: "CCHANNEL",
  linkedMessageTS: "333.444",
  linkedChannelID: "COTHER",
  requestedByUserID: "U1",
  ...overrides,
});

const createMockAnalysisResult = (
  overrides?: Partial<AnalysisResult>,
): AnalysisResult => ({
  invocation: createMockInvocation(),
  liveAlertState: createMockLiveAlertState(),
  analysis: "Investigation summary here.",
  conversationTranscript: "",
  ...overrides,
});

describe("createPublisherModule", () => {
  const originalEnv = process.env;
  let mockLogger: Logger;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    mockPostMessage.mockClear();
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("environment validation", () => {
    it("should throw when SLACK_BOT_TOKEN is missing", () => {
      delete process.env.SLACK_BOT_TOKEN;

      expect(() => createPublisherModule({ logger: mockLogger })).toThrow(
        "Missing required environment variable: SLACK_BOT_TOKEN",
      );
    });
  });

  describe("postAnalysis", () => {
    it("should call chat.postMessage with channel, thread_ts, text fallback, and blocks", async () => {
      const publisher = createPublisherModule({ logger: mockLogger });
      const result = createMockAnalysisResult();

      await publisher.postAnalysis(result);

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const arg = mockPostMessage.mock.calls[0][0];
      expect(arg.channel).toBe("CCHANNEL");
      expect(arg.thread_ts).toBe("111.222");
      expect(arg.text).toBe("🤖 SRE Agent Analysis");
      expect(Array.isArray(arg.blocks)).toBe(true);
      expect(arg.blocks!.length).toBeGreaterThan(0);
    });

    it("should log info with channel and thread_ts on success", async () => {
      const publisher = createPublisherModule({ logger: mockLogger });
      await publisher.postAnalysis(createMockAnalysisResult());

      expect(mockLogger.info).toHaveBeenCalledWith(
        { channel: "CCHANNEL", thread_ts: "111.222" },
        "Posted SRE analysis to Slack thread",
      );
    });

    it("should log error with err and analysis text when postMessage fails without rethrowing", async () => {
      mockPostMessage.mockRejectedValueOnce(new Error("rate_limited"));
      const publisher = createPublisherModule({ logger: mockLogger });
      const result = createMockAnalysisResult({
        analysis: "critical finding: DB down",
      });

      await expect(publisher.postAnalysis(result)).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          err: expect.any(Error),
          analysis: "critical finding: DB down",
          channel: "CCHANNEL",
          thread_ts: "111.222",
        },
        "Failed to post analysis to Slack; analysis text preserved in log",
      );
    });
  });
});
