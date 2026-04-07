import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Handlebars from "handlebars";
import type { AlertInstance, LiveAlertState } from "../../types/grafana.js";

/**
 * Maximum length for sanitized values to prevent context window overflow
 */
const MAX_VALUE_LENGTH = 2000;

/**
 * Lines that start with these patterns could alter markdown structure.
 * Prepending a space neutralizes them while preserving readability.
 */
const MARKDOWN_STRUCTURAL_PATTERNS = [
  /^#/, // Headers
  /^>/, // Blockquotes
  /^---/, // Horizontal rules
];

/**
 * Cache for the compiled Handlebars template
 */
let compiledTemplate: HandlebarsTemplateDelegate | null = null;

/**
 * Gets the directory of the current module (works with ESM)
 */
function getCurrentDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  return dirname(__filename);
}

/**
 * Loads and compiles the Handlebars template from disk (with caching)
 */
function loadTemplate(): HandlebarsTemplateDelegate {
  if (compiledTemplate !== null) {
    return compiledTemplate;
  }

  const templatePath = join(
    getCurrentDir(),
    "..",
    "..",
    "templates",
    "alert-context.md"
  );
  const templateSource = readFileSync(templatePath, "utf-8");

  // Compile with noEscape option since we're generating markdown, not HTML
  compiledTemplate = Handlebars.compile(templateSource, { noEscape: true });
  return compiledTemplate;
}

/**
 * Sanitizes a single label or annotation value before it enters the markdown file.
 *
 * Mitigations:
 * - Truncation prevents context window overflow from massive values (e.g., full
 *   stack traces or JSON blobs injected as label values by misconfigured exporters).
 * - Markdown structural injection neutralization prevents attackers or buggy systems
 *   from breaking the ALERT_CONTEXT.md structure by injecting headers, blockquotes,
 *   or horizontal rules that would be misinterpreted by the LLM.
 *
 * @param value - The raw string value to sanitize
 * @returns The sanitized string, safe for inclusion in markdown
 */
export function sanitizeLabelValue(value: string): string {
  // Truncate if longer than MAX_VALUE_LENGTH
  let sanitized =
    value.length > MAX_VALUE_LENGTH
      ? `${value.slice(0, MAX_VALUE_LENGTH)}... [truncated]`
      : value;

  // Neutralize markdown structural elements by prepending space
  // We process line-by-line to only affect lines that would be structural
  const lines = sanitized.split("\n");
  const processedLines = lines.map((line) => {
    for (const pattern of MARKDOWN_STRUCTURAL_PATTERNS) {
      if (pattern.test(line)) {
        // Prepend a space to neutralize the structural meaning
        return ` ${line}`;
      }
    }
    return line;
  });

  return processedLines.join("\n");
}

/**
 * Applies sanitizeLabelValue to every value in a Record<string, string>.
 * Returns a new record without mutating the input.
 *
 * @param record - The record with string values to sanitize
 * @returns A new record with sanitized values
 */
export function sanitizeRecord(
  record: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = sanitizeLabelValue(value);
  }
  return result;
}

/**
 * Builds the full ALERT_CONTEXT.md string for the DeepAgent using Handlebars templating.
 *
 * This function uses a Handlebars template from src/templates/alert-context.md,
 * making it easy to modify the output format without touching TypeScript code.
 * Simply edit the template file and the changes take effect immediately.
 *
 * The includesPastIncidents flag steers agent behaviour by modifying the Task section:
 * - When true: The agent is told to check for recurring patterns and related
 *   incident history, encouraging deeper investigation into whether this is
 *   a new issue or a recurrence.
 * - When false: The agent focuses on a fresh root cause analysis without
 *   prior incident context.
 *
 * @param state - The live alert state fetched from Grafana
 * @param includesPastIncidents - Whether this alert has fired before
 * @returns The complete ALERT_CONTEXT.md content as a string
 */
export function buildAlertContextFile(
  state: LiveAlertState,
  includesPastIncidents: boolean
): string {
  // Load and compile the Handlebars template (cached after first load)
  const template = loadTemplate();

  // Sanitize labels and annotations
  const sanitizedLabels = sanitizeRecord(state.labels);
  const sanitizedAnnotations = sanitizeRecord(state.annotations);

  // Extract agent_context separately (excluded from Annotations section)
  const { agent_context: rawAgentContext, ...otherAnnotations } =
    sanitizedAnnotations;
  // Trim first, then sanitize to ensure structural protection isn't removed
  const agentContext = rawAgentContext
    ? sanitizeLabelValue(rawAgentContext.trim())
    : "";

  // Helper to format alert instances for the template
  const formatAlertForTemplate = (alert: AlertInstance, index: number) => {
    const labelStr = Object.entries(sanitizeRecord(alert.labels))
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    return {
      state: alert.state,
      activeAt: alert.activeAt ?? "unknown",
      value: alert.value ?? "unknown",
      labelString: labelStr,
    };
  };

  // Build the template data object
  const templateData = {
    // Basic alert info
    ruleName: state.ruleName,
    ruleUID: state.ruleUID,
    state: state.state,
    health: state.health,
    for: state.for ?? "(not set)",
    activeSince: state.activeAt ?? "(unknown)",
    generatorURL: state.generatorURL,
    dashboardURL: state.dashboardURL ?? "(none)",
    panelURL: state.panelURL ?? "(none)",
    silenceURL: state.silenceURL ?? "(none)",

    // Conditional flags
    isPaused: state.isPaused,
    lastError: state.lastError ? sanitizeLabelValue(state.lastError) : null,
    includesPastIncidents,

    // Arrays for {{#each}} loops
    alerts: state.alerts?.map(formatAlertForTemplate) ?? [],
    labels: sanitizedLabels,
    annotations: otherAnnotations,
    queries:
      state.queries?.map((q) => ({
        refID: q.refID,
        datasourceUID: q.datasourceUID,
        expression: q.expression ?? "(expression not available)",
      })) ?? [],

    // Boolean flags for {{#if}} conditionals
    hasAlerts: (state.alerts?.length ?? 0) > 0,
    hasLabels: Object.keys(sanitizedLabels).length > 0,
    hasAnnotations: Object.keys(otherAnnotations).length > 0,
    hasQueries: (state.queries?.length ?? 0) > 0,

    // Agent context (special handling)
    agentContext: agentContext.length > 0 ? agentContext : "(none provided)",
  };

  // Render the template with the data
  return template(templateData);
}

// Type for the compiled Handlebars template
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlebarsTemplateDelegate = (context: any) => string;
