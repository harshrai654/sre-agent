import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeLabelValue,
  sanitizeRecord,
  buildAlertContextFile,
} from "../context-builder.js";
import type { LiveAlertState, AlertInstance, QuerySummary } from "../../../types/grafana.js";

describe("sanitizeLabelValue", () => {
  describe("truncation", () => {
    it("should truncate values longer than 2000 characters", () => {
      const longValue = "a".repeat(2500);
      const result = sanitizeLabelValue(longValue);

      expect(result.length).toBeLessThan(2500);
      expect(result).toContain("... [truncated]");
      expect(result.startsWith("a".repeat(2000))).toBe(true);
    });

    it("should not truncate values under 2000 characters", () => {
      const shortValue = "normal label value";
      const result = sanitizeLabelValue(shortValue);

      expect(result).toBe(shortValue);
      expect(result).not.toContain("[truncated]");
    });

    it("should handle exactly 2000 character values", () => {
      const exactValue = "b".repeat(2000);
      const result = sanitizeLabelValue(exactValue);

      expect(result).toBe(exactValue);
    });
  });

  describe("markdown structural injection prevention", () => {
    it("should prefix header lines with space", () => {
      const value = "# This looks like a header";
      const result = sanitizeLabelValue(value);

      expect(result).toBe(" # This looks like a header");
    });

    it("should prefix blockquote lines with space", () => {
      const value = "> This is a quote";
      const result = sanitizeLabelValue(value);

      expect(result).toBe(" > This is a quote");
    });

    it("should prefix horizontal rule lines with space", () => {
      const value = "---";
      const result = sanitizeLabelValue(value);

      expect(result).toBe(" ---");
    });

    it("should handle multi-line values with mixed structural patterns", () => {
      const value = "normal line\n# header line\nnormal again\n> quote";
      const result = sanitizeLabelValue(value);

      expect(result).toBe("normal line\n # header line\nnormal again\n > quote");
    });

    it("should not affect lines that only contain structural characters mid-line", () => {
      const value = "this has # in the middle";
      const result = sanitizeLabelValue(value);

      expect(result).toBe(value);
    });

    it("should handle empty string", () => {
      const result = sanitizeLabelValue("");
      expect(result).toBe("");
    });

    it("should handle structural patterns at start followed by whitespace", () => {
      const value = "#   header with spaces";
      const result = sanitizeLabelValue(value);

      expect(result).toBe(" #   header with spaces");
    });
  });
});

describe("sanitizeRecord", () => {
  it("should sanitize all values in a record", () => {
    const record = {
      key1: "normal value",
      key2: "# header value",
      key3: "a".repeat(2500),
    };

    const result = sanitizeRecord(record);

    expect(result.key1).toBe("normal value");
    expect(result.key2).toBe(" # header value");
    expect(result.key3).toContain("[truncated]");
  });

  it("should return a new record without mutating input", () => {
    const original = { key: "# header" };
    const result = sanitizeRecord(original);

    expect(original.key).toBe("# header");
    expect(result.key).toBe(" # header");
    expect(result).not.toBe(original);
  });

  it("should handle empty record", () => {
    const result = sanitizeRecord({});
    expect(result).toEqual({});
  });
});

describe("buildAlertContextFile", () => {
  const createMockAlertState = (overrides?: Partial<LiveAlertState>): LiveAlertState => ({
    ruleUID: "test-rule-123",
    ruleName: "Test Alert Rule",
    generatorURL: "https://grafana.example.com/alerting/test-rule-123/view",
    state: "firing",
    health: "ok",
    folderUID: "folder-abc",
    ruleGroup: "test-group",
    labels: { severity: "critical", service: "api" },
    annotations: { summary: "API is down" },
    isPaused: false,
    ...overrides,
  });

  describe("basic alert info rendering", () => {
    it("should include rule name and UID in Live Alert State section", () => {
      const state = createMockAlertState();
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("Rule: Test Alert Rule");
      expect(result).toContain("Rule UID: test-rule-123");
    });

    it("should include state and health information", () => {
      const state = createMockAlertState({ state: "pending", health: "nodata" });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("State: pending Health: nodata");
    });

    it("should handle missing 'for' duration", () => {
      const state = createMockAlertState({ for: undefined });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("For: (not set)");
    });

    it("should include 'for' duration when present", () => {
      const state = createMockAlertState({ for: "5m" });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("For: 5m");
    });
  });

  describe("paused alert warning", () => {
    it("should show warning when alert rule is paused", () => {
      const state = createMockAlertState({ isPaused: true });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("⚠️ WARNING: This alert rule is currently PAUSED.");
    });

    it("should not show paused warning when alert is not paused", () => {
      const state = createMockAlertState({ isPaused: false });
      const result = buildAlertContextFile(state, false);

      expect(result).not.toContain("PAUSED");
    });
  });

  describe("last error display", () => {
    it("should show last error when present", () => {
      const state = createMockAlertState({ lastError: "connection timeout" });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("Last Error: connection timeout");
    });

    it("should not show last error section when absent", () => {
      const state = createMockAlertState({ lastError: undefined });
      const result = buildAlertContextFile(state, false);

      expect(result).not.toContain("Last Error:");
    });
  });

  describe("firing instances section", () => {
    it("should render alert instances with labels", () => {
      const alerts: AlertInstance[] = [
        {
          labels: { pod: "api-1", instance: "10.0.0.1" },
          annotations: {},
          state: "firing",
          activeAt: "2024-01-15T10:30:00Z",
          value: "95.5",
        },
      ];
      const state = createMockAlertState({ alerts });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("## Firing Instances");
      expect(result).toContain("Instance 0: state=firing"); // Handlebars @index starts at 0
      expect(result).toContain("pod=api-1 instance=10.0.0.1");
      expect(result).toContain("since=2024-01-15T10:30:00Z");
      expect(result).toContain("value=95.5");
    });

    it("should show placeholder when no alerts present", () => {
      const state = createMockAlertState({ alerts: [] });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain(
        "(none — alert may be pending or rule-level; use Historical Recovery steps above)",
      );
    });

    it("should handle alerts with missing optional fields", () => {
      const alerts: AlertInstance[] = [
        {
          labels: {},
          annotations: {},
          state: "pending",
        },
      ];
      const state = createMockAlertState({ alerts });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("since=unknown");
      expect(result).toContain("value=unknown");
    });

    it("should sanitize alert instance labels", () => {
      const alerts: AlertInstance[] = [
        {
          labels: { message: "# header in label" },
          annotations: {},
          state: "firing",
        },
      ];
      const state = createMockAlertState({ alerts });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("message= # header in label");
    });
  });

  describe("labels section", () => {
    it("should render all labels", () => {
      const state = createMockAlertState({
        labels: { severity: "critical", service: "api", team: "platform" },
      });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("## Labels");
      expect(result).toContain("severity: critical");
      expect(result).toContain("service: api");
      expect(result).toContain("team: platform");
    });

    it("should show placeholder when no labels", () => {
      const state = createMockAlertState({ labels: {} });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("(none)");
    });

    it("should sanitize label values", () => {
      const state = createMockAlertState({
        labels: { description: "# Critical alert" },
      });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("description:  # Critical alert");
    });
  });

  describe("annotations section", () => {
    it("should render all annotations except agent_context", () => {
      const state = createMockAlertState({
        annotations: {
          summary: "API latency high",
          description: "Response time > 500ms",
          agent_context: "This is special context for agent",
        },
      });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("## Annotations");
      expect(result).toContain("summary: API latency high");
      expect(result).toContain("description: Response time > 500ms");
      expect(result).not.toContain("agent_context:");
    });

    it("should show placeholder when no annotations (except agent_context)", () => {
      const state = createMockAlertState({
        annotations: { agent_context: "only agent context" },
      });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("(none)");
    });
  });

  describe("agent context section", () => {
    it("should render agent_context in its own section", () => {
      const state = createMockAlertState({
        annotations: { agent_context: "Check runbook at https://wiki/runbooks/api" },
      });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("## Agent Context");
      expect(result).toContain("Check runbook at https://wiki/runbooks/api");
    });

    it("should show placeholder when no agent_context", () => {
      const state = createMockAlertState({ annotations: {} });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("## Agent Context");
      expect(result).toContain("(none provided)");
    });
  });

  describe("queries section", () => {
    it("should render query information", () => {
      const queries: QuerySummary[] = [
        { refID: "A", datasourceUID: "prom-1", expression: "up{job=\"api\"} == 0" },
        { refID: "B", datasourceUID: "loki-1", expression: 'rate({app="api"}[5m])' },
      ];
      const state = createMockAlertState({ queries });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("## Queries");
      expect(result).toContain("[A] datasource=prom-1");
      expect(result).toContain("expr: up{job=\"api\"} == 0");
      expect(result).toContain("[B] datasource=loki-1");
    });

    it("should show placeholder when no queries", () => {
      const state = createMockAlertState({ queries: [] });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("(no query information available)");
    });

    it("should handle queries without expressions", () => {
      const queries: QuerySummary[] = [
        { refID: "A", datasourceUID: "prom-1" },
      ];
      const state = createMockAlertState({ queries });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("expr: (expression not available)");
    });
  });

  describe("URLs section", () => {
    it("should render all URLs when present", () => {
      const state = createMockAlertState({
        generatorURL: "https://grafana.example.com/alerting/abc/view",
        dashboardURL: "https://grafana.example.com/d/xyz",
        panelURL: "https://grafana.example.com/d/xyz?viewPanel=2",
        silenceURL: "https://grafana.example.com/alerting/silence/new",
      });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("## URLs");
      expect(result).toContain("- Generator: https://grafana.example.com/alerting/abc/view");
      expect(result).toContain("- Dashboard: https://grafana.example.com/d/xyz");
      expect(result).toContain("- Panel: https://grafana.example.com/d/xyz?viewPanel=2");
      expect(result).toContain("- Silence: https://grafana.example.com/alerting/silence/new");
    });

    it("should show (none) for missing optional URLs", () => {
      const state = createMockAlertState({
        dashboardURL: undefined,
        panelURL: undefined,
        silenceURL: undefined,
      });
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("- Dashboard: (none)");
      expect(result).toContain("- Panel: (none)");
      expect(result).toContain("- Silence: (none)");
    });
  });

  describe("task section", () => {
    it("should include standard task instructions by default", () => {
      const state = createMockAlertState();
      const result = buildAlertContextFile(state, false);

      expect(result).toContain("## Task");
      expect(result).toContain("You are Alert Cop, investigating a Grafana alert");
      expect(result).toContain("Focus on:");
      expect(result).toContain("Establishing the exact firing time window(s)");
      expect(result).toContain("Performing both forward and reverse correlation paths");
      expect(result).toContain(
        "Providing a clear, evidence-backed root cause with time ranges explicitly named",
      );
    });

    it("should include past incidents variant when includesPastIncidents is true", () => {
      const state = createMockAlertState();
      const result = buildAlertContextFile(state, true);

      expect(result).toContain(
        "Determining if this is a new issue or a recurrence",
      );
      expect(result).toContain(
        "Providing a clear, evidence-backed root cause with time ranges explicitly named",
      );
    });

    it("should not include recurrence check when includesPastIncidents is false", () => {
      const state = createMockAlertState();
      const result = buildAlertContextFile(state, false);

      expect(result).not.toContain("new issue or a recurrence");
    });
  });

  describe("end-to-end sanitization", () => {
    it("should properly sanitize all user-controlled values throughout the document", () => {
      const state = createMockAlertState({
        labels: {
          malicious: "# Header injection attempt",
          long: "x".repeat(3000),
        },
        annotations: {
          summary: "> Blockquote attempt",
          description: "---\nHorizontal rule attempt",
          agent_context: "# Also sanitized",
        },
        lastError: "# Error with markdown",
      });
      const result = buildAlertContextFile(state, false);

      // All markdown structural characters should be neutralized
      expect(result).toContain(" # Header injection attempt");
      expect(result).toContain(" > Blockquote attempt");
      expect(result).toContain(" ---");
      expect(result).not.toMatch(/^# /m); // No lines starting with #
      expect(result).toContain("[truncated]");
    });
  });
});
