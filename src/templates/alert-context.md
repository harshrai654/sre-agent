## Live Alert State

Rule: {{ruleName}}
Rule UID: {{ruleUID}}
State: {{state}} Health: {{health}}
For: {{for}}
Active Since: {{activeSince}}
{{#if isPaused}}
⚠️ WARNING: This alert rule is currently PAUSED.
{{/if}}
{{#if lastError}}
Last Error: {{lastError}}
{{/if}}

## Firing Instances

{{#if hasAlerts}}
{{#each alerts}}
Instance {{@index}}: state={{state}} since={{activeAt}} value={{value}}
Labels: {{labelString}}
{{/each}}
{{else}}
(none — alert may be pending or rule-level)
{{/if}}

## Labels

{{#if hasLabels}}
{{#each labels}}
{{@key}}: {{this}}
{{/each}}
{{else}}
(none)
{{/if}}

## Annotations

{{#if hasAnnotations}}
{{#each annotations}}
{{@key}}: {{this}}
{{/each}}
{{else}}
(none)
{{/if}}

## Queries

{{#if hasQueries}}
{{#each queries}}
[{{refID}}] datasource={{datasourceUID}}
expr: {{expression}}
{{/each}}
{{else}}
(no query information available)
{{/if}}

## URLs

- Generator: {{generatorURL}}
- Dashboard: {{dashboardURL}}
- Panel: {{panelURL}}
- Silence: {{silenceURL}}

## Agent Context

{{agentContext}}

## Task

{{#if includesPastIncidents}}
You are an SRE assistant investigating a Grafana alert. Your task is to analyze this alert and provide a root cause analysis. The alert has fired before — use your tools to check if this is a recurring pattern or if there's a related incident history that should inform your analysis.

Focus on:

1. Understanding the alert condition and why it's firing
2. Checking the affected service/deployment health
3. Looking for infrastructure issues (nodes, networking, storage)
4. Searching logs for error patterns
5. Determining if this is a new issue or a recurrence
6. Providing clear, actionable recommendations
   {{else}}
   You are an SRE assistant investigating a Grafana alert. Your task is to analyze this alert and provide a root cause analysis.

Focus on:

1. Understanding the alert condition and why it's firing
2. Checking the affected service/deployment health
3. Looking for infrastructure issues (nodes, networking, storage)
4. Searching logs for error patterns
5. Providing clear, actionable recommendations
   {{/if}}

Be thorough but concise. Use the available tools to investigate. Report back your findings in a clear, structured format with specific evidence from your queries.
