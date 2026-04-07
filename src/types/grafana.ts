/**
 * LiveAlertState represents the current state of a Grafana alert as fetched
 * from the Grafana MCP server. It contains all the metadata needed for the
 * SRE agent to perform a root cause analysis.
 *
 * This interface maps to the alertRuleDetail structure returned by the
 * Grafana MCP server's alerting_manage_rules tool with operation: "get".
 */
export interface LiveAlertState {
  // Core identification
  ruleUID: string;                      // Maps to uid in MCP response
  ruleName: string;                     // Maps to title in MCP response
  generatorURL: string;                 // Original generator URL (preserved from input)

  // Current state
  state: string;                        // firing, pending, normal, recovering, nodata, error
  health: string;                       // ok, nodata, error

  // Location/organization
  folderUID: string;                    // Folder containing the rule
  ruleGroup: string;                    // Rule group name

  // Metadata
  labels: Record<string, string>;
  annotations: Record<string, string>;  // May contain 'agent_context' key

  // Configuration
  condition?: string;                   // Query condition identifier (e.g., 'A', 'B')
  for?: string;                         // Duration before alert fires (e.g., '5m')
  noDataState?: string;                 // State when no data (NoData, Alerting, OK)
  execErrState?: string;                // State on execution error (NoData, Alerting, OK)
  isPaused: boolean;                    // Whether rule is paused
  keepFiringFor?: string;              // Duration to keep firing after condition clears

  // Runtime information
  lastEvaluation?: string;              // ISO 8601 timestamp
  lastError?: string;                   // Last error message if health is 'error'
  type?: string;                        // Alert rule type (e.g., 'alerting', 'recording')

  // Active alert instances (when state is firing/pending)
  alerts?: AlertInstance[];

  // Query information
  queries?: QuerySummary[];

  // Notification configuration
  notificationSettings?: NotificationSettings;

  // Recording rule configuration (if type is 'recording')
  record?: RecordConfig;

  // Legacy/simple fields for backwards compatibility
  activeAt?: string;                    // ISO 8601 (from first firing alert)
  value?: string;                       // Alert value (from first firing alert)
  dashboardURL?: string;                // Derived from annotations
  panelURL?: string;                    // Derived from annotations
  silenceURL?: string;                  // Can be constructed from generatorURL
}

/**
 * Represents an active alert instance within an alert rule.
 * Maps to the alert struct in the Grafana MCP response.
 */
export interface AlertInstance {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: string;                        // firing, pending, etc.
  activeAt?: string;                    // ISO 8601 timestamp
  value?: string;                       // Current metric value
}

/**
 * Summary of a query used in an alert rule.
 * Maps to querySummary in the Grafana MCP response.
 */
export interface QuerySummary {
  refID: string;                        // Query identifier (e.g., 'A', 'B')
  datasourceUID: string;                  // Datasource UID
  expression?: string;                    // Query expression (PromQL, LogQL, etc.)
}

/**
 * Notification settings for an alert rule.
 */
export interface NotificationSettings {
  receiver?: string;                    // Receiver name for notifications
  groupBy?: string[];                   // Labels for grouping alerts
  groupWait?: string;                   // Initial wait before first notification
  groupInterval?: string;               // Wait before updates to existing group
  repeatInterval?: string;              // Interval before resending notification
  muteTimeIntervals?: string[];         // Muted time interval names
  activeTimeIntervals?: string[];       // Active time interval names
}

/**
 * Configuration for a recording rule.
 */
export interface RecordConfig {
  from: string;                         // Reference ID of input query
  metric: string;                       // Name of recorded metric
  targetDatasourceUID?: string;         // Where to write the recorded metric
}
