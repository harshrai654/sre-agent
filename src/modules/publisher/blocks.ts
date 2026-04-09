import type { KnownBlock } from "@slack/types";
import type { AnalysisResult } from "../../types/session.js";

const SECTION_MRKDWN_MAX = 3000;

/**
 * Splits analysis text into segments of at most SECTION_MRKDWN_MAX characters.
 * Prefers breaks at newlines; if a single line exceeds the limit, hard-splits that line.
 */
function chunkAnalysisForSections(analysis: string): string[] {
  const trimmed = analysis.trimEnd();
  if (trimmed.length === 0) {
    return ["_No analysis returned._"];
  }

  const chunks: string[] = [];
  const lines = trimmed.split("\n");
  let currentLines: string[] = [];
  let currentLen = 0;

  const flush = (): void => {
    if (currentLines.length === 0) {
      return;
    }
    chunks.push(currentLines.join("\n"));
    currentLines = [];
    currentLen = 0;
  };

  const pushHardSegments = (line: string): void => {
    let offset = 0;
    while (offset < line.length) {
      chunks.push(line.slice(offset, offset + SECTION_MRKDWN_MAX));
      offset += SECTION_MRKDWN_MAX;
    }
  };

  for (const line of lines) {
    const lineLen = line.length;
    const sep = currentLen === 0 ? 0 : 1;
    const candidateLen = currentLen + sep + lineLen;

    if (lineLen > SECTION_MRKDWN_MAX) {
      flush();
      pushHardSegments(line);
      continue;
    }

    if (candidateLen <= SECTION_MRKDWN_MAX) {
      currentLines.push(line);
      currentLen = candidateLen;
      continue;
    }

    flush();
    currentLines = [line];
    currentLen = lineLen;
  }

  flush();
  return chunks;
}

/**
 * Builds Block Kit blocks for posting the SRE agent analysis in a Slack thread.
 *
 * @see https://docs.slack.dev/reference/block-kit/blocks/section-block/ — section `text` max 3000 chars
 */
export function buildAnalysisBlocks(result: AnalysisResult): KnownBlock[] {
  const { liveAlertState, invocation, analysis } = result;
  const activeSince = liveAlertState.activeAt ?? "unknown";

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🤖 Alert Cop Analysis",
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Rule:* ${liveAlertState.ruleName}`,
        },
        {
          type: "mrkdwn",
          text: `*State:* ${liveAlertState.state}`,
        },
        {
          type: "mrkdwn",
          text: `*Active since:* ${activeSince}`,
        },
        {
          type: "mrkdwn",
          text: `*Requested by:* <@${invocation.requestedByUserID}>`,
        },
      ],
    },
    {
      type: "divider",
    },
  ];

  for (const chunk of chunkAnalysisForSections(analysis)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: chunk,
      },
    });
  }

  blocks.push({
    type: "divider",
  });

  return blocks;
}
