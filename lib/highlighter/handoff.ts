export interface HandoffInput {
  report_id: string;
  fact: string;
  conclusion: string;
  freshness_token: string;
}

/**
 * Prime string for the user's own Claude (R4). Carries our cited starting point
 * + how to pull the full live report via the MCP, so they can extend it with
 * outside info and build a chart/doc in their session — off our meter.
 */
export function buildClaudeHandoff(i: HandoffInput): string {
  return [
    `I'm looking at SWFL Data Gulf's "${i.report_id}" report.`,
    `Fact in focus: ${i.fact}`,
    `Report's bottom line: ${i.conclusion}`,
    `Freshness: ${i.freshness_token}`,
    "",
    `To work with the live, cited data, call the SWFL MCP tool \`swfl_fetch\` with report_id="${i.report_id}" (add it once via: claude mcp add --transport http swfl https://www.swfldatagulf.com/api/mcp). Then help me analyze or chart it, and feel free to combine it with other sources — but keep every SWFL number attributed to the report.`,
  ].join("\n");
}
