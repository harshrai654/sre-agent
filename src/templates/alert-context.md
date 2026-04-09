## Live Alert State

Rule: {{ruleName}}
Rule UID: {{ruleUID}}
State: {{state}} Health: {{health}}
For: {{for}}
Active Since: {{activeSince}}
Last evaluation: {{lastEvaluation}}

_(Snapshot from latest fetch — the linked Slack alert may be from an earlier time; rule state may already be `normal` or `pending` even though the incident was real.)_

---

## ⚠️ Historical Recovery Instruction (read before planning)

{{#if isFiring}}
**Alert is actively firing.** Use `{{activeSince}}` and the Firing Instances below as the primary time anchors. Still query a window of ±1–3 hours around `{{activeSince}}` to capture the ramp-up.
{{else}}
**This alert is NOT currently firing (State: `{{state}}`).** The engineer likely shared a stale incident thread.

**Mandatory first step before writing todos:**

1. Call `alerting_manage_rules` with Rule UID `{{ruleUID}}` to retrieve the rule definition and any available instance history.
2. If the alert is not currently active, **call `alerting_manage_rules` again** to surface past firing instances for this Rule UID. Extract all `activeAt` / `since` / `resolvedAt` timestamps.
3. Use those timestamps — not "now" — as the anchor time ranges for all Loki, Thanos, Tempo, and Pyroscope queries.
4. If no historical instances are returned at all, state that gap explicitly and use `{{activeSince}}` as the best-effort anchor, querying ±1–3 hours around it.
   {{/if}}

---

## Firing Instances

{{#if hasAlerts}}
{{#each alerts}}
Instance {{@index}}: state={{state}} since={{activeAt}} value={{value}}
Labels: {{labelString}}
{{/each}}
{{else}}
(none — alert may be pending or rule-level; use Historical Recovery steps above)
{{/if}}

---

## Labels

{{#if hasLabels}}
{{#each labels}}
{{@key}}: {{this}}
{{/each}}
{{else}}
(none)
{{/if}}

---

## Annotations

{{#if hasAnnotations}}
{{#each annotations}}
{{@key}}: {{this}}
{{/each}}
{{else}}
(none)
{{/if}}

---

## Queries

{{#if hasQueries}}
{{#each queries}}
[{{refID}}] datasource={{datasourceUID}}
expr: {{expression}}
{{/each}}
{{else}}
(no query information available)
{{/if}}

_(Use these expressions as the starting point for Thanos/Prometheus range queries over the firing window. For application-emitted metrics, also fetch exemplars — they carry `trace_id`/`span_id` for Tempo correlation.)_

---

## URLs

- Generator: {{generatorURL}}
- Dashboard: {{dashboardURL}}
- Panel: {{panelURL}}
- Silence: {{silenceURL}}

---

## Datasource & Signal Correlation Reminders (apply to this alert)

Before writing your todo list, resolve the following against the labels and queries above:

1. **Service identity (mandatory discovery first)** — discover real Loki `service_name`/`app` values in-range, then map from alert labels (`job`, `service`, `app`, `namespace`, etc.). Never use endpoint/path text as a service label value.
2. **Loki scope** — query Loki with chosen `service_name=<service>` or `app=<service>` plus `container="main-service"` over the firing window. If empty, retry with alternate valid service candidates before concluding no logs.
3. **Metric -> Trace pivot** — if the alert expression references an application metric (error rate, latency histogram, etc.), query Thanos exemplars for that metric over the firing window to collect `trace_id` values, then query Tempo.
4. **Log -> Trace pivot** — extract `trace_id` and `span_id` from error/slow log lines in Loki, then query Tempo to inspect the full request trace.
5. **Reverse Trace pivot (mandatory fallback)** — if no trace IDs are found from metrics/logs, search Tempo by span attributes in the same window (discover attributes first; use `service.name`, `http.route`, `http.path`, `http.method`, status/error keys), then pivot trace IDs back into Loki/metrics.
6. **Trace -> Profile pivot** — if a Tempo span is unexpectedly slow with no slow downstream calls, query Pyroscope scoped to the affected `pod` label over the same window to check for CPU/memory hotspots.
7. **Infra baseline checks** — for backend latency alerts, attempt CPU and memory saturation checks from infrastructure/app metrics (e.g., kube/node-level signals) and call out if unavailable.
8. **Datasource UIDs** — list datasources early in your investigation to confirm UIDs for Loki, Thanos, Tempo, and Pyroscope before issuing queries.
9. **Exemplar-first trace attempt** — run at least one exemplar-enabled metric query for the alert metric and try to harvest `trace_id`/`span_id`.
10. **Tempo mandatory attempt** — even without IDs, discover searchable span attributes/tags and run at least one attribute-based trace query in-window.
11. **Dashboard/panel anchors** — if Dashboard/Panel URLs are present above, extract panel queries and use them as additional investigation paths.

For this alert, use at least one primary and one fallback correlation path:

- Primary: `metrics/logs -> traces -> profiles`
- Fallback: `traces (attribute search) -> trace_id/span_id -> logs/metrics`
- Do not conclude root cause until applicable evidence gates are met; otherwise state blocked gates explicitly under gaps.

---

## Agent Context

{{agentContext}}

---

## Task

You are Alert Cop, investigating a Grafana alert. Your task is to analyze this alert and provide a root cause analysis.

Focus on:

1. Establishing the exact firing time window(s) using `alerting_manage_rules` (mandatory if State ≠ `firing`)
1. Understanding the alert condition and its expression
1. Checking the affected service/deployment health via metrics (Thanos), logs (Loki), traces (Tempo), and profiles (Pyroscope) — correlated across signals using `trace_id`/`span_id`/`pod` labels
1. Performing both forward and reverse correlation paths when needed (`metrics/logs -> traces` and fallback `traces -> logs/metrics`)
1. Looking for infrastructure issues (nodes, networking, storage), including CPU/memory saturation checks when latency is elevated
{{#if includesPastIncidents}}
1. Determining if this is a new issue or a recurrence — past incident context is available, use it
{{/if}}
1. Providing a clear, evidence-backed root cause with time ranges explicitly named

Be thorough but concise. Use the available tools to investigate. Report findings in valid Slack mrkdwn with specific evidence — datasource, time range (UTC), and what each query returned. Avoid repeated explanations; prefer compact bullets grouped by datasource.
Use the mandatory final output template from system instructions. If unsure, prioritize compact sections with non-overlapping facts over long prose.

{{#if isPaused}}
⚠️ WARNING: This alert rule is currently PAUSED.
{{/if}}
{{#if lastError}}
Last Error: {{lastError}}
{{/if}}
