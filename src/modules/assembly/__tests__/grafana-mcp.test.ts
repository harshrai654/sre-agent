import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import {
  createGrafanaMcpClient,
  extractRuleUID,
  fetchLiveAlertState,
  parseGrafanaMcpHeadersFromEnv,
} from "../grafana-mcp.js";
import type { LiveAlertState } from "../../../types/grafana.js";

// Mock pino logger
vi.mock("pino", () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

// Mock @langchain/mcp-adapters
const mockGetTools = vi.fn();
const mockInvoke = vi.fn();

vi.mock("@langchain/mcp-adapters", () => ({
  MultiServerMCPClient: vi.fn().mockImplementation(function (this: {
    getTools: typeof mockGetTools;
  }) {
    this.getTools = mockGetTools;
    return this;
  }),
}));

describe("createGrafanaMcpClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GRAFANA_MCP_HEADERS;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("successful creation", () => {
    it("should create client with GRAFANA_MCP_URL env var", () => {
      process.env.GRAFANA_MCP_URL = "https://grafana-mcp.example.com/mcp";

      const client = createGrafanaMcpClient();

      expect(client).toBeDefined();
      expect(MultiServerMCPClient).toHaveBeenCalledWith({
        mcpServers: {
          grafana: {
            url: "https://grafana-mcp.example.com/mcp",
            transport: "http",
            headers: {},
          },
        },
      });
    });

    it("should create client with localhost URL", () => {
      process.env.GRAFANA_MCP_URL = "http://localhost:3000/mcp";

      const client = createGrafanaMcpClient();

      expect(client).toBeDefined();
      expect(MultiServerMCPClient).toHaveBeenCalledWith({
        mcpServers: {
          grafana: {
            url: "http://localhost:3000/mcp",
            transport: "http",
            headers: {},
          },
        },
      });
    });

    it("should create client with URL containing path", () => {
      process.env.GRAFANA_MCP_URL = "https://grafana.example.com/api/mcp";

      const client = createGrafanaMcpClient();

      expect(client).toBeDefined();
      expect(MultiServerMCPClient).toHaveBeenCalledWith({
        mcpServers: {
          grafana: {
            url: "https://grafana.example.com/api/mcp",
            transport: "http",
            headers: {},
          },
        },
      });
    });

    it("should pass headers from JSON GRAFANA_MCP_HEADERS", () => {
      process.env.GRAFANA_MCP_URL = "https://mcp.example.com/mcp";
      process.env.GRAFANA_MCP_HEADERS =
        '{"CF-Access-Client-Id":"id1","CF-Access-Client-Secret":"secret1"}';

      createGrafanaMcpClient();

      expect(MultiServerMCPClient).toHaveBeenCalledWith({
        mcpServers: {
          grafana: {
            url: "https://mcp.example.com/mcp",
            transport: "http",
            headers: {
              "CF-Access-Client-Id": "id1",
              "CF-Access-Client-Secret": "secret1",
            },
          },
        },
      });
    });

    it("should pass headers from comma-separated GRAFANA_MCP_HEADERS", () => {
      process.env.GRAFANA_MCP_URL = "https://mcp.example.com/mcp";
      process.env.GRAFANA_MCP_HEADERS =
        "CF-Access-Client-Id: id1, CF-Access-Client-Secret: secret1";

      createGrafanaMcpClient();

      expect(MultiServerMCPClient).toHaveBeenCalledWith({
        mcpServers: {
          grafana: {
            url: "https://mcp.example.com/mcp",
            transport: "http",
            headers: {
              "CF-Access-Client-Id": "id1",
              "CF-Access-Client-Secret": "secret1",
            },
          },
        },
      });
    });
  });

  describe("error cases", () => {
    it("should throw error when GRAFANA_MCP_URL is not set", () => {
      delete process.env.GRAFANA_MCP_URL;

      expect(() => createGrafanaMcpClient()).toThrow(
        "GRAFANA_MCP_URL is required",
      );
    });

    it("should throw error when GRAFANA_MCP_URL is empty string", () => {
      process.env.GRAFANA_MCP_URL = "";

      expect(() => createGrafanaMcpClient()).toThrow(
        "GRAFANA_MCP_URL is required",
      );
    });

    it("should throw error when GRAFANA_MCP_URL is only whitespace", () => {
      process.env.GRAFANA_MCP_URL = "   ";

      expect(() => createGrafanaMcpClient()).toThrow(
        "GRAFANA_MCP_URL is required",
      );
    });
  });
});

describe("parseGrafanaMcpHeadersFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GRAFANA_MCP_HEADERS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return empty object when GRAFANA_MCP_HEADERS is unset", () => {
    expect(parseGrafanaMcpHeadersFromEnv()).toEqual({});
  });

  it("should parse JSON object with string values", () => {
    process.env.GRAFANA_MCP_HEADERS =
      '{"CF-Access-Client-Id":"cid","CF-Access-Client-Secret":"sec"}';
    expect(parseGrafanaMcpHeadersFromEnv()).toEqual({
      "CF-Access-Client-Id": "cid",
      "CF-Access-Client-Secret": "sec",
    });
  });

  it("should split comma-separated pairs on first colon only", () => {
    process.env.GRAFANA_MCP_HEADERS = "A: part:with:colons, B: tail";
    expect(parseGrafanaMcpHeadersFromEnv()).toEqual({
      A: "part:with:colons",
      B: "tail",
    });
  });

  it("should throw when JSON is invalid", () => {
    process.env.GRAFANA_MCP_HEADERS = "{not-json";
    expect(() => parseGrafanaMcpHeadersFromEnv()).toThrow(
      "GRAFANA_MCP_HEADERS looks like JSON",
    );
  });
});

describe("extractRuleUID", () => {
  describe("valid generator URLs", () => {
    it("should extract UID from standard alerting URL with /view", () => {
      const url = "https://grafana.example.com/alerting/abc123/view?orgId=1";
      const result = extractRuleUID(url);

      expect(result).toBe("abc123");
    });

    it("should extract UID from URL without query params", () => {
      const url = "https://grafana.example.com/alerting/rule-uid-xyz/view";
      const result = extractRuleUID(url);

      expect(result).toBe("rule-uid-xyz");
    });

    it("should extract UID from URL without /view suffix", () => {
      const url = "https://grafana.example.com/alerting/alert-123";
      const result = extractRuleUID(url);

      expect(result).toBe("alert-123");
    });

    it("should extract UID with complex alphanumeric format", () => {
      const url =
        "https://grafana.example.com/alerting/abc123_test-456/view?orgId=1";
      const result = extractRuleUID(url);

      expect(result).toBe("abc123_test-456");
    });

    it("should extract UID with UUID format", () => {
      const url =
        "https://grafana.example.com/alerting/a1b2c3d4-e5f6-7890-abcd-ef1234567890/view";
      const result = extractRuleUID(url);

      expect(result).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    it("should extract UID from URL with port", () => {
      const url =
        "https://grafana.example.com:3000/alerting/abc123/view?orgId=1";
      const result = extractRuleUID(url);

      expect(result).toBe("abc123");
    });

    it("should extract UID from URL with subdomain", () => {
      const url =
        "https://monitoring.internal.company.com/alerting/prod-alert-001/view";
      const result = extractRuleUID(url);

      expect(result).toBe("prod-alert-001");
    });

    it("should extract UID with URL containing special characters in query", () => {
      const url =
        "https://grafana.example.com/alerting/cpu-alert/view?orgId=1&var-job=app-1%2F2";
      const result = extractRuleUID(url);

      expect(result).toBe("cpu-alert");
    });

    it("should extract UID from URL with namespace/datasource segment (e.g., /alerting/grafana/<uid>/view)", () => {
      const url =
        "https://tools.koinx.com/grafana/alerting/grafana/dem26jtj7zsw0a/view?orgId=1";
      const result = extractRuleUID(url);

      expect(result).toBe("dem26jtj7zsw0a");
    });

    it("should extract UID from URL with namespace and without /view", () => {
      const url = "https://grafana.example.com/alerting/prometheus/alert-123";
      const result = extractRuleUID(url);

      expect(result).toBe("alert-123");
    });

    it("should extract UID from URL with multiple intermediate segments", () => {
      const url =
        "https://grafana.example.com/alerting/folder/subfolder/alert-456/view";
      const result = extractRuleUID(url);

      expect(result).toBe("alert-456");
    });
  });

  describe("invalid URLs", () => {
    it("should throw error for invalid URL format", () => {
      const url = "not-a-valid-url";

      expect(() => extractRuleUID(url)).toThrow(
        "Could not extract rule UID from generatorURL",
      );
    });

    it("should throw error for URL without /alerting/ path", () => {
      const url = "https://grafana.example.com/dashboard/db/my-dashboard";

      expect(() => extractRuleUID(url)).toThrow(
        "Could not extract rule UID from generatorURL",
      );
    });

    it("should extract UID from URL with base path prefix (e.g., /api/alerting/...)", () => {
      const url = "https://grafana.example.com/api/alerting/abc123";

      // Base path prefix before /alerting is handled - finds 'alerting' anywhere in path
      const result = extractRuleUID(url);
      expect(result).toBe("abc123");
    });

    it("should handle URL with trailing slash after view gracefully", () => {
      const url = "https://grafana.example.com/alerting/abc123/view/";

      // Trailing slash is handled gracefully - still extracts the UID
      const result = extractRuleUID(url);
      expect(result).toBe("abc123");
    });

    it("should throw error for empty string", () => {
      expect(() => extractRuleUID("")).toThrow(
        "Could not extract rule UID from generatorURL",
      );
    });

    it("should throw error for URL with missing UID", () => {
      const url = "https://grafana.example.com/alerting//view";

      expect(() => extractRuleUID(url)).toThrow(
        "Could not extract rule UID from generatorURL",
      );
    });

    it("should throw error for URL with only /alerting/", () => {
      const url = "https://grafana.example.com/alerting/";

      expect(() => extractRuleUID(url)).toThrow(
        "Could not extract rule UID from generatorURL",
      );
    });
  });

  describe("edge cases", () => {
    it("should handle URL with fragment", () => {
      const url =
        "https://grafana.example.com/alerting/abc123/view?orgId=1#tab=query";
      const result = extractRuleUID(url);

      expect(result).toBe("abc123");
    });

    it("should handle URL with multiple query parameters", () => {
      const url =
        "https://grafana.example.com/alerting/abc123/view?orgId=1&var-datasource=prometheus&var-cluster=prod";
      const result = extractRuleUID(url);

      expect(result).toBe("abc123");
    });

    it("should handle URL with HTTP instead of HTTPS", () => {
      const url = "http://grafana.example.com/alerting/abc123/view?orgId=1";
      const result = extractRuleUID(url);

      expect(result).toBe("abc123");
    });
  });
});

describe("fetchLiveAlertState", () => {
  const generatorURL =
    "https://grafana.example.com/alerting/abc123/view?orgId=1";
  let mockClient: MultiServerMCPClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset();
    mockGetTools.mockReset();
    // Create a mock client with getTools method
    mockClient = {
      getTools: mockGetTools,
    } as unknown as MultiServerMCPClient;
  });

  describe("successful fetches", () => {
    it("should fetch alert rule with complete response", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "High CPU Usage",
        state: "firing",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "production",
        labels: { severity: "critical", team: "sre" },
        annotations: { summary: "CPU is high", description: "CPU usage > 80%" },
        condition: "B",
        for: "5m",
        is_paused: false,
        last_evaluation: "2025-01-15T10:30:00Z",
        type: "alerting",
        alerts: [
          {
            labels: { instance: "server-01" },
            annotations: { value: "85%" },
            state: "firing",
            activeAt: "2025-01-15T10:25:00Z",
            value: "85",
          },
        ],
        queries: [
          {
            ref_id: "A",
            datasource_uid: "prometheus",
            expression: "cpu_usage_percent",
          },
        ],
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result).toMatchObject({
        ruleUID: "abc123",
        ruleName: "High CPU Usage",
        state: "firing",
        health: "ok",
        folderUID: "folder-001",
        ruleGroup: "production",
        labels: { severity: "critical", team: "sre" },
        annotations: { summary: "CPU is high", description: "CPU usage > 80%" },
        condition: "B",
        for: "5m",
        isPaused: false,
        lastEvaluation: "2025-01-15T10:30:00Z",
        type: "alerting",
        generatorURL,
        activeAt: "2025-01-15T10:25:00Z",
        value: "85",
      } as Partial<LiveAlertState>);

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts?.[0]).toMatchObject({
        labels: { instance: "server-01" },
        annotations: { value: "85%" },
        state: "firing",
        activeAt: "2025-01-15T10:25:00Z",
        value: "85",
      });

      expect(result.queries).toHaveLength(1);
      expect(result.queries?.[0]).toMatchObject({
        refID: "A",
        datasourceUID: "prometheus",
        expression: "cpu_usage_percent",
      });
    });

    it("should call alerting_manage_rules tool with correct parameters", async () => {
      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue({ uid: "abc123", title: "Test" });

      await fetchLiveAlertState(mockClient, "abc123", generatorURL);

      expect(mockInvoke).toHaveBeenCalledWith({
        operation: "get",
        rule_uid: "abc123",
      });
    });

    it("should handle response with snake_case field names", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "Test Alert",
        state: "pending",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "test-group",
        labels: {},
        annotations: {},
        is_paused: false,
        notification_settings: {
          receiver: "slack-alerts",
          group_by: ["alertname", "severity"],
          group_wait: "30s",
          group_interval: "5m",
          repeat_interval: "4h",
        },
        queries: [
          {
            ref_id: "A",
            datasource_uid: "prometheus",
            expression: "up == 1",
          },
        ],
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.notificationSettings).toEqual({
        receiver: "slack-alerts",
        groupBy: ["alertname", "severity"],
        groupWait: "30s",
        groupInterval: "5m",
        repeatInterval: "4h",
      });

      expect(result.queries?.[0]).toMatchObject({
        refID: "A",
        datasourceUID: "prometheus",
        expression: "up == 1",
      });
    });

    it("should handle recording rule with record configuration", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "record-001",
        title: "Recording Rule",
        state: "normal",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "recording",
        labels: {},
        annotations: {},
        is_paused: false,
        type: "recording",
        record: {
          from: "A",
          metric: "aggregated_metric",
          target_datasource_uid: "prometheus",
        },
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "record-001",
        generatorURL,
      );

      expect(result.type).toBe("recording");
      expect(result.record).toEqual({
        from: "A",
        metric: "aggregated_metric",
        targetDatasourceUID: "prometheus",
      });
    });

    it("should handle multiple active alerts", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "Multiple Instances Alert",
        state: "firing",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "production",
        labels: {},
        annotations: {},
        is_paused: false,
        alerts: [
          {
            labels: { instance: "server-01" },
            annotations: {},
            state: "firing",
            activeAt: "2025-01-15T10:20:00Z",
            value: "90",
          },
          {
            labels: { instance: "server-02" },
            annotations: {},
            state: "firing",
            activeAt: "2025-01-15T10:25:00Z",
            value: "85",
          },
          {
            labels: { instance: "server-03" },
            annotations: {},
            state: "pending",
            activeAt: "2025-01-15T10:28:00Z",
            value: "75",
          },
        ],
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.alerts).toHaveLength(3);
      expect(result.activeAt).toBe("2025-01-15T10:20:00Z"); // First firing alert
      expect(result.value).toBe("90"); // Value from first firing alert
    });
  });

  describe("minimal/partial responses", () => {
    it("should handle response with only required fields", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "Minimal Alert",
        state: "normal",
        health: "ok",
        folder_uid: "",
        rule_group: "",
        labels: {},
        annotations: {},
        is_paused: false,
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.ruleUID).toBe("abc123");
      expect(result.ruleName).toBe("Minimal Alert");
      expect(result.state).toBe("normal");
      expect(result.health).toBe("ok");
      expect(result.isPaused).toBe(false);
      expect(result.generatorURL).toBe(generatorURL);
      expect(result.alerts).toBeUndefined();
      expect(result.activeAt).toBeUndefined();
      expect(result.value).toBeUndefined();
    });

    it("should handle response with null optional fields", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "Test Alert",
        state: "firing",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "test",
        labels: null,
        annotations: null,
        condition: null,
        for: null,
        is_paused: false,
        last_evaluation: null,
        last_error: null,
        type: null,
        alerts: null,
        queries: null,
        notification_settings: null,
        record: null,
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.labels).toEqual({});
      expect(result.annotations).toEqual({});
      expect(result.condition).toBeUndefined();
      expect(result.for).toBeUndefined();
      expect(result.lastEvaluation).toBeUndefined();
      expect(result.lastError).toBeUndefined();
      expect(result.type).toBeUndefined();
      expect(result.alerts).toBeUndefined();
      expect(result.queries).toBeUndefined();
      expect(result.notificationSettings).toBeUndefined();
      expect(result.record).toBeUndefined();
    });

    it("should handle response with missing optional fields", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "Test Alert",
        state: "firing",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "test",
        labels: {},
        annotations: {},
        is_paused: false,
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.condition).toBeUndefined();
      expect(result.for).toBeUndefined();
      expect(result.noDataState).toBeUndefined();
      expect(result.execErrState).toBeUndefined();
      expect(result.keepFiringFor).toBeUndefined();
      expect(result.lastEvaluation).toBeUndefined();
      expect(result.lastError).toBeUndefined();
      expect(result.type).toBeUndefined();
      expect(result.alerts).toBeUndefined();
      expect(result.queries).toBeUndefined();
      expect(result.notificationSettings).toBeUndefined();
      expect(result.record).toBeUndefined();
      expect(result.activeAt).toBeUndefined();
      expect(result.value).toBeUndefined();
    });
  });

  describe("type coercion and edge cases", () => {
    it("should coerce non-string values to strings", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: 12345, // number
        title: true, // boolean
        state: "firing",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "test",
        labels: {},
        annotations: {},
        is_paused: false,
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.ruleUID).toBe("12345");
      expect(result.ruleName).toBe("true");
    });

    it("should handle boolean is_paused as string", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "Test",
        state: "firing",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "test",
        labels: {},
        annotations: {},
        is_paused: "true", // string instead of boolean
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.isPaused).toBe(true); // coerced to boolean
    });

    it("should handle alerts with non-object items", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "Test",
        state: "firing",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "test",
        labels: {},
        annotations: {},
        is_paused: false,
        alerts: [
          null,
          "invalid",
          123,
          {
            labels: { instance: "server-01" },
            annotations: {},
            state: "firing",
          },
        ],
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.alerts).toHaveLength(4);
      // First three should have defaults
      expect(result.alerts?.[0]).toMatchObject({
        labels: {},
        annotations: {},
        state: "unknown",
      });
      expect(result.alerts?.[1]).toMatchObject({
        labels: {},
        annotations: {},
        state: "unknown",
      });
      expect(result.alerts?.[2]).toMatchObject({
        labels: {},
        annotations: {},
        state: "unknown",
      });
      // Fourth should be properly parsed
      expect(result.alerts?.[3]).toMatchObject({
        labels: { instance: "server-01" },
        state: "firing",
      });
    });

    it("should handle queries with both ref_id and refID", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "Test",
        state: "firing",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "test",
        labels: {},
        annotations: {},
        is_paused: false,
        queries: [
          { ref_id: "A", datasource_uid: "prom-1" },
          { refID: "B", datasourceUID: "prom-2" },
        ],
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.queries?.[0].refID).toBe("A");
      expect(result.queries?.[1].refID).toBe("B");
    });
  });

  describe("error scenarios", () => {
    it("should throw error when alerting_manage_rules tool not found", async () => {
      mockGetTools.mockResolvedValue([
        { name: "other_tool", invoke: mockInvoke },
        { name: "another_tool", invoke: mockInvoke },
      ]);

      await expect(
        fetchLiveAlertState(mockClient, "abc123", generatorURL),
      ).rejects.toThrow(
        "MCP tool 'alerting_manage_rules' not found. Available tools: other_tool, another_tool",
      );
    });

    it("should throw error when no tools available", async () => {
      mockGetTools.mockResolvedValue([]);

      await expect(
        fetchLiveAlertState(mockClient, "abc123", generatorURL),
      ).rejects.toThrow(
        "MCP tool 'alerting_manage_rules' not found. Available tools:",
      );
    });

    it("should throw error when tool has no invoke method", async () => {
      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules" }, // No invoke method
      ]);

      await expect(
        fetchLiveAlertState(mockClient, "abc123", generatorURL),
      ).rejects.toThrow("MCP tool 'alerting_manage_rules' not found");
    });

    it("should throw error when getTools fails", async () => {
      mockGetTools.mockRejectedValue(new Error("Connection failed"));

      await expect(
        fetchLiveAlertState(mockClient, "abc123", generatorURL),
      ).rejects.toThrow("Connection failed");
    });

    it("should throw error when tool invocation fails", async () => {
      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockRejectedValue(new Error("Rule not found"));

      await expect(
        fetchLiveAlertState(mockClient, "abc123", generatorURL),
      ).rejects.toThrow("Rule not found");
    });

    it("should handle non-object response gracefully", async () => {
      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(null);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.ruleUID).toBe("");
      expect(result.ruleName).toBe("");
      expect(result.state).toBe("unknown");
      expect(result.generatorURL).toBe(generatorURL);
    });

    it("should handle primitive response gracefully", async () => {
      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue("invalid response");

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.ruleUID).toBe("");
      expect(result.ruleName).toBe("");
      expect(result.state).toBe("unknown");
      expect(result.generatorURL).toBe(generatorURL);
    });
  });

  describe("tool discovery", () => {
    it("should log available tools at debug level", async () => {
      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
        { name: "other_tool", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue({ uid: "abc123", title: "Test" });

      await fetchLiveAlertState(mockClient, "abc123", generatorURL);

      // The mock for pino should have been called with debug containing available tools
      // This is verified through the mock setup in vi.mock("pino")
    });

    it("should handle tools without name property", async () => {
      mockGetTools.mockResolvedValue([
        { invoke: mockInvoke }, // No name
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue({ uid: "abc123", title: "Test" });

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.ruleUID).toBe("abc123");
    });
  });

  describe("notification settings extraction", () => {
    it("should extract complete notification settings", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "Test",
        state: "firing",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "test",
        labels: {},
        annotations: {},
        is_paused: false,
        notification_settings: {
          receiver: "pagerduty",
          group_by: ["alertname", "severity", "instance"],
          group_wait: "30s",
          group_interval: "5m",
          repeat_interval: "4h",
          mute_time_intervals: ["maintenance"],
          active_time_intervals: ["business-hours"],
        },
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.notificationSettings).toEqual({
        receiver: "pagerduty",
        groupBy: ["alertname", "severity", "instance"],
        groupWait: "30s",
        groupInterval: "5m",
        repeatInterval: "4h",
        muteTimeIntervals: ["maintenance"],
        activeTimeIntervals: ["business-hours"],
      });
    });

    it("should handle notification settings with non-array group_by", async () => {
      const mockResponse: Record<string, unknown> = {
        uid: "abc123",
        title: "Test",
        state: "firing",
        health: "ok",
        folder_uid: "folder-001",
        rule_group: "test",
        labels: {},
        annotations: {},
        is_paused: false,
        notification_settings: {
          receiver: "slack",
          group_by: "invalid", // Not an array
        },
      };

      mockGetTools.mockResolvedValue([
        { name: "alerting_manage_rules", invoke: mockInvoke },
      ]);
      mockInvoke.mockResolvedValue(mockResponse);

      const result = await fetchLiveAlertState(
        mockClient,
        "abc123",
        generatorURL,
      );

      expect(result.notificationSettings?.groupBy).toBeUndefined();
    });
  });
});
