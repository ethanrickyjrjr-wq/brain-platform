/**
 * Semantic Ledger generator — "the data on the data."
 *
 * Renders refinery/vocab/brain-vocabulary.json + the PACKS registry as a
 * single read-only markdown report at `docs/semantic-ledger.md`. The report
 * is intended for the operator to browse the SKOS layer without grepping
 * JSON: categories, concepts, raw_slugs, source brains, status, DAG edges
 * (with edge_type), constitution overrides, and a data-quality section.
 *
 * Run:
 *   bun refinery/tools/semantic-ledger.mts
 *
 * Output is deterministic — same vocab + same packs always produce the same
 * file. Re-generation lives in git so a vocab edit's downstream impact is
 * visible in the diff.
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadVocabularySync } from "../vocab/loader.mts";
import { PACKS } from "../config/packs.mts";
import { financeConstitution } from "../constitution/finance.mts";
import { realEstateConstitution } from "../constitution/real-estate.mts";
import type { Constitution } from "../constitution/types.mts";
import type { VocabConcept } from "../stages/2.5-normalize.mts";

const OUTPUT_PATH = path.join(process.cwd(), "docs", "semantic-ledger.md");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "(no git)";
  }
}

function fmtList(items: readonly string[]): string {
  if (items.length === 0) return "_none_";
  return items.map((s) => `\`${s}\``).join(", ");
}

function fmtRange(c: VocabConcept): string {
  if (c.allowed_values && c.allowed_values.length > 0) {
    return c.allowed_values.map((v) => `\`${v}\``).join(" / ");
  }
  if (c.value_range) return `${c.value_range[0]} – ${c.value_range[1]}`;
  return "_unbounded_";
}

function fmtUnit(c: VocabConcept): string {
  if (!c.unit) return "—";
  return c.unit;
}

function escapeTable(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildHeader(vocab: ReturnType<typeof loadVocabularySync>): string {
  const conceptCount = Object.keys(vocab.concepts).length;
  const slugCount = Object.keys(vocab.slug_index).filter(
    (k) => !k.startsWith("_"),
  ).length;
  const categories = new Set<string>();
  const brains = new Set<string>();
  let activeCount = 0;
  let stubCount = 0;
  for (const c of Object.values(vocab.concepts)) {
    categories.add(c.category);
    for (const b of c.source_brains ?? []) brains.add(b);
    if (c.status === "active") activeCount++;
    else if (c.status === "stub") stubCount++;
  }
  return [
    "# Semantic Ledger",
    "",
    "_The data on the data — auto-generated read-only view of the SKOS vocabulary, DAG, and constitution overrides that drive the SWFL Intelligence Lake._",
    "",
    `**Generated:** ${new Date().toISOString()} (commit \`${gitShortSha()}\`)`,
    `**Vocab schema:** ${vocab.meta.schema_version} · created ${vocab.meta.created_at} · next review ${vocab.meta.next_review ?? "—"}`,
    `**Audit doc:** \`${vocab.meta.audit_doc ?? "—"}\``,
    "",
    "## TL;DR",
    "",
    `- **${conceptCount}** SKOS concepts across **${categories.size}** categories (${activeCount} active, ${stubCount} stub).`,
    `- **${slugCount}** raw slugs registered in \`slug_index\`.`,
    `- **${brains.size}** distinct source brains referenced (live + planned).`,
    `- **${Object.keys(PACKS).length}** packs in the runtime registry.`,
    "",
    "## Regenerate",
    "",
    "```",
    "bun refinery/tools/semantic-ledger.mts",
    "```",
    "",
  ].join("\n");
}

function buildCategoriesTable(
  vocab: ReturnType<typeof loadVocabularySync>,
): string {
  const counts = new Map<
    string,
    { total: number; active: number; stub: number }
  >();
  for (const c of Object.values(vocab.concepts)) {
    const row = counts.get(c.category) ?? { total: 0, active: 0, stub: 0 };
    row.total += 1;
    if (c.status === "active") row.active += 1;
    else if (c.status === "stub") row.stub += 1;
    counts.set(c.category, row);
  }
  const lines = [
    "## Categories",
    "",
    "| Category | Concepts | Active | Stub |",
  ];
  lines.push("| --- | ---: | ---: | ---: |");
  for (const cat of [...counts.keys()].sort()) {
    const row = counts.get(cat)!;
    lines.push(`| \`${cat}\` | ${row.total} | ${row.active} | ${row.stub} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildConceptsByCategory(
  vocab: ReturnType<typeof loadVocabularySync>,
): string {
  const byCategory = new Map<string, VocabConcept[]>();
  for (const c of Object.values(vocab.concepts)) {
    const arr = byCategory.get(c.category) ?? [];
    arr.push(c);
    byCategory.set(c.category, arr);
  }
  const out: string[] = ["## Concepts by Category", ""];
  for (const cat of [...byCategory.keys()].sort()) {
    const concepts = byCategory
      .get(cat)!
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    out.push(`### \`${cat}\` (${concepts.length})`);
    out.push("");
    out.push(
      "| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |",
    );
    out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const c of concepts) {
      const cells = [
        `\`${c.id}\``,
        escapeTable(c.prefLabel),
        fmtList(c.raw_slugs),
        c.value_type ?? "—",
        escapeTable(fmtUnit(c)),
        escapeTable(fmtRange(c)),
        fmtList(c.source_brains ?? []),
        fmtList(c.domain ?? []),
        c.status === "active" ? "✅ active" : `⚠️ ${c.status}`,
      ];
      out.push(`| ${cells.join(" | ")} |`);
    }
    out.push("");
    // Scope notes — render below the table, only for concepts that have one
    // and where it adds context beyond the prefLabel.
    const withNotes = concepts.filter((c) => c.scope_note);
    if (withNotes.length > 0) {
      out.push("<details><summary>Scope notes</summary>");
      out.push("");
      for (const c of withNotes) {
        out.push(`- **\`${c.id}\`** — ${truncate(c.scope_note!, 600)}`);
      }
      out.push("");
      out.push("</details>");
      out.push("");
    }
  }
  return out.join("\n");
}

function buildOrderedCollections(
  vocab: ReturnType<typeof loadVocabularySync>,
): string {
  const ocs = vocab.ordered_collections ?? {};
  const keys = Object.keys(ocs);
  if (keys.length === 0) {
    return "## Ordered Collections\n\n_None registered._\n";
  }
  const out: string[] = ["## Ordered Collections", ""];
  for (const id of keys) {
    const oc = ocs[id] as Record<string, unknown>;
    out.push(`### \`${id}\``);
    out.push("");
    out.push(`- **prefLabel:** ${oc.prefLabel ?? "—"}`);
    out.push(`- **type:** \`${oc.type ?? "—"}\``);
    out.push(`- **ordering criterion:** ${oc.ordering_criterion ?? "—"}`);
    const members = (oc.ordered_members as string[]) ?? [];
    out.push(
      `- **ordered members:** ${members.map((m) => `\`${m}\``).join(" → ")}`,
    );
    const memberNotes = (oc.member_notes as Record<string, string>) ?? {};
    if (Object.keys(memberNotes).length > 0) {
      out.push("");
      out.push("| Member | Note |");
      out.push("| --- | --- |");
      for (const m of members) {
        out.push(`| \`${m}\` | ${escapeTable(memberNotes[m] ?? "—")} |`);
      }
    }
    out.push("");
  }
  return out.join("\n");
}

function buildDagAndEdges(): string {
  const packs = Object.values(PACKS)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const out: string[] = [
    "## Brain DAG (typed edges)",
    "",
    "Every edge is `{ id, edge_type }`. `edge_type` ∈ `input | constraint | veto | modifier` — see `refinery/types/pack.mts` → `BrainEdgeType`. A disputant reading `OUTPUT.drivers` on any brain can see edge semantics inline; this table is the authoring view of the same DAG.",
    "",
    "| Brain | Domain | Upstream edges | Edge weight legend |",
    "| --- | --- | --- | --- |",
  ];
  for (const p of packs) {
    const edges = p.input_brains ?? [];
    const edgesStr =
      edges.length === 0
        ? "_leaf_"
        : edges.map((e) => `\`${e.id}\` (**${e.edge_type}**)`).join(", ");
    const vetoes = edges.filter((e) => e.edge_type === "veto").length;
    const modifiers = edges.filter((e) => e.edge_type === "modifier").length;
    const constraints = edges.filter(
      (e) => e.edge_type === "constraint",
    ).length;
    const weight =
      vetoes > 0
        ? `${vetoes}× veto`
        : modifiers > 0
          ? `${modifiers}× modifier`
          : constraints > 0
            ? `${constraints}× constraint`
            : edges.length > 0
              ? "all input"
              : "—";
    out.push(`| \`${p.id}\` | \`${p.domain}\` | ${edgesStr} | ${weight} |`);
  }
  out.push("");
  return out.join("\n");
}

function buildBrainEmissions(
  vocab: ReturnType<typeof loadVocabularySync>,
): string {
  // Invert source_brains → concepts so the operator can see which concepts
  // each brain produces. Helpful for "what does env-swfl actually emit?"
  const byBrain = new Map<string, VocabConcept[]>();
  for (const c of Object.values(vocab.concepts)) {
    for (const b of c.source_brains ?? []) {
      if (b === "all") continue; // qualitative concepts emit "all" — render in a footer
      const arr = byBrain.get(b) ?? [];
      arr.push(c);
      byBrain.set(b, arr);
    }
  }
  const out: string[] = ["## What each brain emits (SKOS concepts)", ""];
  for (const brain of [...byBrain.keys()].sort()) {
    const concepts = byBrain
      .get(brain)!
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    out.push(`### \`${brain}\` (${concepts.length} concepts)`);
    out.push("");
    out.push("| Concept | prefLabel | Raw slugs | Status |");
    out.push("| --- | --- | --- | --- |");
    for (const c of concepts) {
      out.push(
        `| \`${c.id}\` | ${escapeTable(c.prefLabel)} | ${fmtList(c.raw_slugs)} | ${c.status} |`,
      );
    }
    out.push("");
  }
  out.push(
    '_Concepts with `source_brains: ["all"]` (qualitative brain-output fields like `qual_confidence`, `qual_trust_tier`, `qual_sentiment_direction`) are emitted by every brain and intentionally omitted from this table._',
  );
  out.push("");
  return out.join("\n");
}

function buildOverrides(constitutions: Constitution[]): string {
  const all = constitutions.flatMap((c) =>
    c.overrideCascade.map((r) => ({ rule: r, domains: c.domains })),
  );
  all.sort((a, b) => b.rule.priority - a.rule.priority);
  const out: string[] = [
    "## Constitution overrides (cascade)",
    "",
    "Higher priority wins. Effect `force_signal_direction` tracks the originating signal's direction; `force_bearish` / `force_bullish` pin the read; `add_caveat` only appends a caveat. SKOS-aware rules (e.g. `flood-veto`) declare trigger concepts by SKOS ID and resolve to raw slugs at module-init via `refinery/vocab/loader.mts`.",
    "",
    "| Priority | Override ID | Effect | Domains |",
    "| ---: | --- | --- | --- |",
  ];
  for (const { rule, domains } of all) {
    out.push(
      `| ${rule.priority} | \`${rule.override_id}\` | \`${rule.effect}\` | ${fmtList(domains)} |`,
    );
  }
  out.push("");
  out.push(
    "_Source: `refinery/constitution/{real-estate,finance}.mts` — see those files for the predicate code and threshold values._",
  );
  out.push("");
  return out.join("\n");
}

function buildTrustTierLegend(): string {
  return [
    "## Trust tiers (confidence weights)",
    "",
    "Every `SourceConnector` declares one `trust_tier`. Stage 4's deterministic confidence formula averages the tier scores below across a pack's sources and multiplies by the TTL-freshness ratio (and upstream confidences). No LLM in the math path.",
    "",
    "| Tier | Authority | Score |",
    "| ---: | --- | ---: |",
    "| 1 | Primary — federal, SEC, NOAA, FEMA | 1.0 |",
    "| 2 | Verified editorial / shipped brain output | 0.8 |",
    "| 3 | Secondary aggregator / industry report | 0.6 |",
    "| 4 | Inferred / weakly attested | 0.4 |",
    "",
    "_Formula: `refinery/lib/confidence.mts` — `confidence = avg(trust_tier_score) × freshness_ratio × avg(upstream_confidences)`._",
    "",
  ].join("\n");
}

function buildDataQuality(
  vocab: ReturnType<typeof loadVocabularySync>,
): string {
  const out: string[] = ["## Data-quality checks", ""];

  // 1. Concepts with empty source_brains
  const orphanedConcepts = Object.values(vocab.concepts).filter(
    (c) => !c.source_brains || c.source_brains.length === 0,
  );
  out.push(`### Concepts with no source brain (${orphanedConcepts.length})`);
  out.push("");
  if (orphanedConcepts.length === 0) {
    out.push("_None — every concept is claimed by at least one brain._");
  } else {
    out.push(
      "These concepts are registered in the vocab but no brain currently emits them. Usually intentional (stubs pre-registered for upcoming brains).",
    );
    out.push("");
    out.push("| Concept | Status | Scope hint |");
    out.push("| --- | --- | --- |");
    for (const c of orphanedConcepts.sort((a, b) => a.id.localeCompare(b.id))) {
      out.push(
        `| \`${c.id}\` | ${c.status} | ${escapeTable(truncate(c.scope_note ?? "—", 200))} |`,
      );
    }
  }
  out.push("");

  // 2. slug_index entries that don't resolve to a known concept
  const unresolvedSlugs: string[] = [];
  for (const [slug, target] of Object.entries(vocab.slug_index)) {
    if (slug.startsWith("_")) continue;
    if (typeof target !== "string") continue;
    if (!vocab.concepts[target]) unresolvedSlugs.push(slug);
  }
  out.push(`### Unresolved \`slug_index\` entries (${unresolvedSlugs.length})`);
  out.push("");
  if (unresolvedSlugs.length === 0) {
    out.push(
      "_None — every `slug_index` entry points to a concept that exists._",
    );
  } else {
    out.push(
      "These slugs map to concept IDs that don't exist in `concepts{}` — likely a typo or a deletion that missed a back-pointer.",
    );
    out.push("");
    for (const s of unresolvedSlugs) out.push(`- \`${s}\``);
  }
  out.push("");

  // 3. Concepts whose source_brains references a brain not in PACKS
  const knownBrains = new Set(Object.keys(PACKS));
  knownBrains.add("all"); // qualitative concepts
  const danglingBrainRefs: { concept: string; brain: string }[] = [];
  for (const c of Object.values(vocab.concepts)) {
    for (const b of c.source_brains ?? []) {
      if (!knownBrains.has(b)) {
        danglingBrainRefs.push({ concept: c.id, brain: b });
      }
    }
  }
  out.push(
    `### Concepts referencing a brain not in PACKS (${danglingBrainRefs.length})`,
  );
  out.push("");
  if (danglingBrainRefs.length === 0) {
    out.push(
      "_None — every `source_brains` entry resolves to a registered pack._",
    );
  } else {
    out.push(
      "Either the brain is planned but not yet scaffolded, or the reference is stale.",
    );
    out.push("");
    out.push("| Concept | Missing brain |");
    out.push("| --- | --- |");
    for (const d of danglingBrainRefs) {
      out.push(`| \`${d.concept}\` | \`${d.brain}\` |`);
    }
  }
  out.push("");

  return out.join("\n");
}

function buildFooter(): string {
  return [
    "---",
    "",
    "**Notes**",
    "",
    "- This file is generated; do not edit by hand. Edit `refinery/vocab/brain-vocabulary.json` or the per-pack `input_brains` arrays, then rerun the generator.",
    "- SKOS pattern: each concept's stable ID (e.g. `env_lee_ve_zone_coverage_pct`) is the lookup key; `raw_slugs` are the legacy strings the engine still writes into brain `.md` files. `slug_index` inverts to make raw → concept resolution sync.",
    "- DAG edge semantics live in `refinery/types/pack.mts` (`BrainEdgeType`). Edge weights in this ledger summarize the strongest edge type the brain carries on any of its inbound connections.",
    "- Override priority ordering is enforced by `refinery/constitution/index.mts` after merging per-domain rule sets.",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const vocab = loadVocabularySync();
  const constitutions: Constitution[] = [
    realEstateConstitution,
    financeConstitution,
  ];

  const md = [
    buildHeader(vocab),
    buildCategoriesTable(vocab),
    buildConceptsByCategory(vocab),
    buildOrderedCollections(vocab),
    buildDagAndEdges(),
    buildBrainEmissions(vocab),
    buildOverrides(constitutions),
    buildTrustTierLegend(),
    buildDataQuality(vocab),
    buildFooter(),
  ].join("\n");

  writeFileSync(OUTPUT_PATH, md, "utf-8");
  console.log(`[semantic-ledger] wrote ${OUTPUT_PATH} (${md.length} bytes)`);
}

main();
