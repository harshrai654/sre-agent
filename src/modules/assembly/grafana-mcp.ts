import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import pino from "pino";
import type { AlertInstance, LiveAlertState, NotificationSettings, QuerySummary, RecordConfig } from "../../types/grafana.js";

const logger = pino({ name: "grafana-mcp" });

/**
 * Creates a MultiServerMCPClient for connecting to the Grafana MCP server via
 * Streamable HTTP transport.
 *
 * Streamable HTTP is the modern MCP transport that supports both HTTP POST
 * for requests and Server-Sent Events (SSE) for streaming responses. It
 * automatically falls back to legacy SSE mode if the server doesn't support
 * streamable HTTP.
 *
 * @returns Configured MultiServerMCPClient instance
 * @throws Error if GRAFANA_MCP_URL environment variable is not set
 */
export function createGrafanaMcpClient(): MultiServerMCPClient {
  const url = process.env.GRAFANA_MCP_URL?.trim();
  if (!url) {
    throw new Error("GRAFANA_MCP_URL is required");
  }

  return new MultiServerMCPClient({
    mcpServers: {
      grafana: {
        url,
        transport: "http",
      },
    },
  });
}

/**
 * Extracts the rule UID from a Grafana alert generator URL.
 *
 * Grafana generator URLs have various formats:
 * https://<host>/alerting/<ruleUID>/view?...
 * https://<host>/alerting/<namespace>/<ruleUID>/view?...
 *
 * The rule UID is typically the last path segment before optional "/view",
 * or the last segment if no "/view" suffix exists.
 *
 * @param generatorURL - The Grafana generator URL from the alert
 * @returns The extracted rule UID
 * @throws Error if the rule UID cannot be extracted from the URL
 */
export function extractRuleUID(generatorURL: string): string {
  // Parse the URL to work with the pathname
  let pathname: string;
  try {
    const url = new URL(generatorURL);
    pathname = url.pathname;
  } catch (error) {
    throw new Error("Could not extract rule UID from generatorURL");
  }

  // Split pathname into segments
  const segments = pathname.split("/").filter(Boolean);

  // Find the "alerting" segment index (may not be at start due to base paths like /grafana)
  const alertingIndex = segments.indexOf("alerting");
  if (alertingIndex === -1 || alertingIndex >= segments.length - 1) {
    throw new Error("Could not extract rule UID from generatorURL");
  }

  // Extract segments after "alerting"
  const afterAlerting = segments.slice(alertingIndex + 1);

  // Remove optional "view" suffix if present
  if (afterAlerting.length > 0 && afterAlerting[afterAlerting.length - 1] === "view") {
    afterAlerting.pop();
  }

  // After removing suffix, the last segment is the rule UID
  // This handles: /alerting/<uid>, /alerting/<namespace>/<uid>, /base/alerting/<uid>
  if (afterAlerting.length === 0) {
    throw new Error("Could not extract rule UID from generatorURL");
  }

  const ruleUID = afterAlerting[afterAlerting.length - 1];

  // Validate that the extracted UID looks reasonable (not empty)
  if (!ruleUID || ruleUID.length === 0) {
    throw new Error("Could not extract rule UID from generatorURL");
  }

  return ruleUID;
}

// Helper type for raw MCP response
type RawMcpResponse = Record<string, unknown>;

// Defensive field extractors
function extractStringField(
  raw: RawMcpResponse,
  field: string,
  ruleUID: string,
  defaultValue = ""
): string {
  const value = raw[field];
  if (value === undefined || value === null) {
    if (defaultValue === "") {
      logger.warn({ field, ruleUID }, "Missing expected field in MCP response");
    }
    return defaultValue;
  }
  if (typeof value !== "string") {
    logger.warn({ field, ruleUID, type: typeof value }, "Field has unexpected type");
    return String(value);
  }
  return value;
}

function extractOptionalStringField(
  raw: RawMcpResponse,
  field: string,
  ruleUID: string
): string | undefined {
  const value = raw[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    logger.warn({ field, ruleUID, type: typeof value }, "Optional field has unexpected type");
    return String(value);
  }
  return value;
}

function extractRecordField(
  raw: RawMcpResponse,
  field: string,
  ruleUID: string
): Record<string, string> {
  const value = raw[field];
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    logger.warn({ field, ruleUID, type: typeof value }, "Record field has unexpected type");
    return {};
  }

  const record = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(record)) {
    result[key] = typeof val === "string" ? val : String(val);
  }
  return result;
}

function extractBooleanField(
  raw: RawMcpResponse,
  field: string,
  ruleUID: string,
  defaultValue = false
): boolean {
  const value = raw[field];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    logger.warn({ field, ruleUID, type: typeof value }, "Boolean field has unexpected type");
    return Boolean(value);
  }
  return value;
}

function extractAlertsArray(
  raw: RawMcpResponse,
  field: string,
  ruleUID: string
): AlertInstance[] | undefined {
  const value = raw[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    logger.warn({ field, ruleUID, type: typeof value }, "Alerts field is not an array");
    return undefined;
  }

  return value.map((alert: unknown, index: number) => {
    if (typeof alert !== "object" || alert === null) {
      logger.warn({ field, index, ruleUID }, "Alert item is not an object");
      return {
        labels: {},
        annotations: {},
        state: "unknown",
      };
    }

    const alertObj = alert as Record<string, unknown>;
    const extractAlertRecord = (key: string): Record<string, string> => {
      const val = alertObj[key];
      if (typeof val !== "object" || val === null || Array.isArray(val)) {
        return {};
      }
      const rec = val as Record<string, unknown>;
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec)) {
        result[k] = typeof v === "string" ? v : String(v);
      }
      return result;
    };

    return {
      labels: extractAlertRecord("labels"),
      annotations: extractAlertRecord("annotations"),
      state: typeof alertObj.state === "string" ? alertObj.state : "unknown",
      activeAt: typeof alertObj.activeAt === "string" ? alertObj.activeAt : undefined,
      value: typeof alertObj.value === "string" ? alertObj.value : undefined,
    };
  });
}

function extractQueriesArray(
  raw: RawMcpResponse,
  field: string,
  ruleUID: string
): QuerySummary[] | undefined {
  const value = raw[field];
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((query: unknown, index: number) => {
    if (typeof query !== "object" || query === null) {
      logger.warn({ field, index, ruleUID }, "Query item is not an object");
      return { refID: "", datasourceUID: "" };
    }

    const q = query as Record<string, unknown>;
    return {
      refID: typeof q.ref_id === "string" ? q.ref_id : (typeof q.refID === "string" ? q.refID : ""),
      datasourceUID: typeof q.datasource_uid === "string" ? q.datasource_uid : (typeof q.datasourceUID === "string" ? q.datasourceUID : ""),
      expression: typeof q.expression === "string" ? q.expression : undefined,
    };
  });
}

function extractNotificationSettings(
  raw: RawMcpResponse,
  field: string,
  ruleUID: string
): NotificationSettings | undefined {
  const value = raw[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const ns = value as Record<string, unknown>;
  return {
    receiver: typeof ns.receiver === "string" ? ns.receiver : undefined,
    groupBy: Array.isArray(ns.group_by) ? ns.group_by.filter((v): v is string => typeof v === "string") : undefined,
    groupWait: typeof ns.group_wait === "string" ? ns.group_wait : undefined,
    groupInterval: typeof ns.group_interval === "string" ? ns.group_interval : undefined,
    repeatInterval: typeof ns.repeat_interval === "string" ? ns.repeat_interval : undefined,
    muteTimeIntervals: Array.isArray(ns.mute_time_intervals) ? ns.mute_time_intervals.filter((v): v is string => typeof v === "string") : undefined,
    activeTimeIntervals: Array.isArray(ns.active_time_intervals) ? ns.active_time_intervals.filter((v): v is string => typeof v === "string") : undefined,
  };
}

function extractRecordConfig(
  raw: RawMcpResponse,
  field: string,
  ruleUID: string
): RecordConfig | undefined {
  const value = raw[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const rec = value as Record<string, unknown>;
  const from = typeof rec.from === "string" ? rec.from : undefined;
  const metric = typeof rec.metric === "string" ? rec.metric : undefined;

  if (!from || !metric) {
    return undefined;
  }

  return {
    from,
    metric,
    targetDatasourceUID: typeof rec.target_datasource_uid === "string" ? rec.target_datasource_uid : undefined,
  };
}

/**
 * Fetches the current state of an alert rule from the Grafana MCP server.
 *
 * Uses the alerting_manage_rules tool with operation "get" to fetch full alert
 * rule details including configuration and runtime state.
 *
 * @param client - The MultiServerMCPClient connected to Grafana MCP
 * @param ruleUID - The UID of the alert rule to fetch
 * @param generatorURL - The original generator URL (preserved in output)
 * @returns Promise resolving to the live alert state
 * @throws Error if the MCP tool invocation fails
 */
export async function fetchLiveAlertState(
  client: MultiServerMCPClient,
  ruleUID: string,
  generatorURL: string
): Promise<LiveAlertState> {
  // Get available tools for diagnostic purposes
  const tools = await client.getTools();
  logger.debug({
    availableTools: tools.map((t) => ("name" in t ? t.name : "unknown")),
    ruleUID,
  }, "MCP tools discovered");

  // The Grafana MCP tool for managing alert rules
  const toolName = "alerting_manage_rules";
  const alertingTool = tools.find((t) =>
    "name" in t ? t.name === toolName : false
  );

  if (!alertingTool || !("invoke" in alertingTool)) {
    throw new Error(
      `MCP tool '${toolName}' not found. Available tools: ${
        tools.map((t) => ("name" in t ? t.name : "unknown")).join(", ")
      }`
    );
  }

  // Invoke the tool with operation "get" to fetch rule details
  const response = await (alertingTool as { invoke: (args: Record<string, unknown>) => Promise<unknown> }).invoke({
    operation: "get",
    rule_uid: ruleUID,
  });

  logger.debug({ response, ruleUID, responseType: typeof response }, "Raw MCP tool response");

  // Defensive mapping: handle cases where response might be a JSON string or an object
  let raw: RawMcpResponse;
  if (typeof response === "object" && response !== null) {
    raw = response as RawMcpResponse;
  } else if (typeof response === "string") {
    // MCP sometimes returns JSON as a string - parse it
    try {
      const parsed = JSON.parse(response);
      raw = (typeof parsed === "object" && parsed !== null) ? parsed : {};
    } catch {
      logger.error({ response: response.substring(0, 200), ruleUID }, "Failed to parse MCP response as JSON");
      raw = {};
    }
  } else {
    logger.error({ responseType: typeof response, ruleUID }, "Unexpected MCP response type");
    raw = {};
  }

  // Extract active alerts array
  const alerts = extractAlertsArray(raw, "alerts", ruleUID);

  // Derive activeAt and value from first firing alert (for backwards compatibility)
  const firstFiringAlert = alerts?.find((a) => a.state === "firing" || a.state === "pending") ?? alerts?.[0];
  const activeAt = firstFiringAlert?.activeAt;
  const value = firstFiringAlert?.value;

  const state: LiveAlertState = {
    // Core identification
    ruleUID: extractStringField(raw, "uid", ruleUID, ""),
    ruleName: extractStringField(raw, "title", ruleUID, ""),
    generatorURL, // Preserved from input

    // Current state
    state: extractStringField(raw, "state", ruleUID, "unknown"),
    health: extractStringField(raw, "health", ruleUID, ""),

    // Location/organization
    folderUID: extractStringField(raw, "folder_uid", ruleUID, ""),
    ruleGroup: extractStringField(raw, "rule_group", ruleUID, ""),

    // Metadata
    labels: extractRecordField(raw, "labels", ruleUID),
    annotations: extractRecordField(raw, "annotations", ruleUID),

    // Configuration
    condition: extractOptionalStringField(raw, "condition", ruleUID),
    for: extractOptionalStringField(raw, "for", ruleUID),
    noDataState: extractOptionalStringField(raw, "no_data_state", ruleUID),
    execErrState: extractOptionalStringField(raw, "exec_err_state", ruleUID),
    isPaused: extractBooleanField(raw, "is_paused", ruleUID, false),
    keepFiringFor: extractOptionalStringField(raw, "keep_firing_for", ruleUID),

    // Runtime information
    lastEvaluation: extractOptionalStringField(raw, "last_evaluation", ruleUID),
    lastError: extractOptionalStringField(raw, "last_error", ruleUID),
    type: extractOptionalStringField(raw, "type", ruleUID),

    // Active alert instances
    alerts,

    // Query information
    queries: extractQueriesArray(raw, "queries", ruleUID),

    // Notification configuration
    notificationSettings: extractNotificationSettings(raw, "notification_settings", ruleUID),

    // Recording rule configuration
    record: extractRecordConfig(raw, "record", ruleUID),

    // Legacy/simple fields (derived from alerts array)
    activeAt,
    value,

    // Optional URLs (can be derived from generatorURL or annotations)
    dashboardURL: extractOptionalStringField(raw, "dashboardURL", ruleUID),
    panelURL: extractOptionalStringField(raw, "panelURL", ruleUID),
    silenceURL: extractOptionalStringField(raw, "silenceURL", ruleUID),
  };

  logger.info({
    ruleUID: state.ruleUID,
    ruleName: state.ruleName,
    state: state.state,
    health: state.health,
    alertCount: state.alerts?.length ?? 0,
  }, "Live alert state fetched from Grafana MCP");

  return state;
}
