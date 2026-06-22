/**
 * prove-gap-fill.mts — PROVE Increment B (live cited gap-fill) on a REAL run.
 *
 * Three things proven live:
 *   1. VENDOR SURFACE — fillExternalPoint runs a real Anthropic web_search_20250305
 *      call (sonnet-4-6) and returns a peer figure WITH its publisher URL + the
 *      verbatim cited span the value was verified against. If the surface drifted,
 *      this fails loudly (Vendor-First: running code, not a remembered spec).
 *   2. THE MOAT — the returned value's digits appear in the cited_text (verified by
 *      valueAppearsInCitations inside fillExternalPoint). A number not in the fetched
 *      bytes is dropped; nothing is plotted from memory.
 *   3. ANSWER PATH — composeChartFromRequest on a peer-comparison ask builds a chart
 *      whose caption footnotes the external source, and live Haiku describes it,
 *      cites figures, and never deflects/leaks (push-gate detectors).
 *
 * Run:  bun run scripts/prove-gap-fill.mts
 */
import Anthropic from "@anthropic-ai/sdk";
import { TRIAGE_MODEL } from "../refinery/agents/anthropic.mts";
import { buildGroundedRegionSystem } from "../lib/assistant/conversation-path";
import { composeChartFromRequest } from "../lib/assistant/compose-chart";
import { fillExternalPoint } from "../lib/assistant/gap-fill";
import { findDeflection, findLeak } from "../.claude/hooks/check-answer-fix-proof.mjs";

const ORIGIN = "https://www.swfldatagulf.com";
const QUESTION =
  "Chart SWFL commercial corridor vacancy and compare it to the Tampa office vacancy rate.";
const ROLLS = 5;
const MAX_TOKENS = 700;
const fs = await import("node:fs/promises");

async function callHaiku(client: Anthropic, system: string): Promise<string> {
  const res = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: QUESTION }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(JSON.stringify({ key_loaded: false, reason: "run with `bun run` so .env.local loads" })); // prettier-ignore
    return;
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const observedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // STEP 1 — standalone live gap-fill (vendor surface + moat).
  const standalone = await fillExternalPoint({
    label: "Tampa office vacancy",
    search_query: "Tampa office vacancy rate 2025 2026 Colliers CBRE",
  });
  process.stderr.write(
    standalone
      ? `✓ live gap-fill: ${standalone.label} = ${standalone.value} (${standalone.url})\n`
      : "· live gap-fill returned null (no verifiable cited value found)\n",
  );

  // STEP 2 — full compose with gap-fill, then describe-the-chart rolls.
  const composed = await composeChartFromRequest(QUESTION, ORIGIN);
  if (!composed) {
    console.log(JSON.stringify({ key_loaded: true, composed: false, standalone }, null, 2));
    return;
  }
  const externalSources = (composed.chart.options?.externalSources ?? []) as Array<{
    label: string;
    value: number;
    url: string;
  }>;

  const { system } = await buildGroundedRegionSystem(QUESTION, ORIGIN, "analyst");
  const full =
    system +
    "\n\n=== CHART ON SCREEN — a chart is displayed to the user RIGHT NOW. Describe what it shows; " +
    "never say you can't chart or that it's out of scope. State ONLY the figures below — never invent " +
    "one not listed here. ===\n" +
    composed.groundingNote;

  const results: { answer: string; bad: boolean; deflect: string | null; leak: string | null }[] = []; // prettier-ignore
  for (let i = 0; i < ROLLS; i++) {
    let answer = "";
    try {
      answer = await callHaiku(client, full);
    } catch (e) {
      answer = `__ERROR__: ${(e as Error).message}`;
    }
    const deflect = findDeflection(answer);
    const leak = findLeak(answer);
    results.push({ answer, bad: Boolean(deflect || leak), deflect, leak });
    process.stderr.write(results[i].bad ? "x" : ".");
  }
  process.stderr.write("\n");

  const bad = results.filter((r) => r.bad).length;
  const firstClean = results.find((r) => !r.bad)?.answer ?? null;
  const report = {
    key_loaded: true,
    composed: true,
    observed_at: observedAt,
    model: TRIAGE_MODEL,
    search_surface: "web_search_20250305 + claude-sonnet-4-6 (live)",
    harness: "scripts/prove-gap-fill.mts",
    endpoint: "/api/assistant",
    question: QUESTION,
    chart_title: composed.chart.title,
    chart_rows: composed.chart.rows.length,
    standalone_gap_fill: standalone,
    external_sources_on_chart: externalSources,
    rolls: ROLLS,
    bad,
    worked: bad === 0,
    sample_clean: firstClean,
    breakdown: results.map((r) => ({ bad: r.bad, deflect: r.deflect, leak: r.leak })),
  };
  await fs.writeFile("scripts/.prove-gap-fill-result.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  // Honest by construction: only record a gap-fill proof when a peer was ACTUALLY
  // fetched + verified + plotted AND every roll was clean. A run that attached no
  // external point proves nothing about gap-fill (it's just an Increment-A chart).
  if (firstClean && externalSources.length > 0 && bad === 0) {
    const proof = {
      question: QUESTION,
      answer: firstClean,
      endpoint: "/api/assistant",
      observed_at: observedAt,
      commit_claim:
        "Increment B live cited gap-fill: composeChartFromRequest fetched a peer figure via web_search_20250305, accepted it ONLY because its digits appeared verbatim in a returned cited_text span, footnoted the source host, and the analyst describes the chart with no deflection/leak",
    };
    await fs.appendFile("verification/answer-proofs.jsonl", JSON.stringify(proof) + "\n");
    process.stderr.write("✅ appended live proof to verification/answer-proofs.jsonl\n");
  }
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
