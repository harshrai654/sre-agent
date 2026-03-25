/**
 * LiveAlertState represents the current state of a Grafana alert as fetched
 * from the Grafana MCP server. It contains all the metadata needed for the
 * SRE agent to perform a root cause analysis.
 */
export interface LiveAlertState {
  ruleUID: string;
  ruleName: string;
  ruleURL: string;
  state: string;                        // e.g. "Alerting", "Pending", "Normal"
  labels: Record<string, string>;
  annotations: Record<string, string>;  // may contain 'agent_context' key
  dashboardURL?: string;
  panelURL?: string;
  silenceURL?: string;
  generatorURL: string;
  activeAt?: string;                    // ISO 8601
  value?: string;
}
