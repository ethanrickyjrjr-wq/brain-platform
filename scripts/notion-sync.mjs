#!/usr/bin/env node
// Notion sync — Big Bird's Brain → Latest Sync hub
//
// Tears down stale Latest Sync content and rebuilds the hub + 4 detail pages
// (Project Audit, Roadmap, Premise Data Replacement, Data Sources Inventory).
// Idempotent: re-running wipes + rebuilds, never duplicates.
//
// v2 upgrades (2026-05-27): 3-column dashboard hub, TOC on each detail page,
// bookmark cards for live URLs, toggle blocks for long sections, page covers
// from public/logo.svg, richer callout palette, inline brand swatches.
//
// Env vars:
//   NOTION_KEY              — Big Bird's Brain integration token (ntn_...)
//   NOTION_LATEST_SYNC_PAGE — optional override (default: 3658729a64598193a737f845f9747bb1)
//
// Usage (local): NOTION_KEY=ntn_... node scripts/notion-sync.mjs
// Usage (GHA):   see .github/workflows/notion-sync-weekly.yml
// Replaceability: port to Supabase Edge Function + pg_cron in ~1 day if needed.

const KEY = process.env.NOTION_KEY;
if (!KEY) {
  console.error("set NOTION_KEY");
  process.exit(2);
}
const LB_PAGE = process.env.NOTION_LATEST_SYNC_PAGE || "3658729a64598193a737f845f9747bb1";

const H = {
  Authorization: `Bearer ${KEY}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

const SITE = "https://www.swfldatagulf.com";
const REPO = "https://github.com/ethanrickyjrjr-wq/brain-platform";
// Notion needs a renderable image URL (PNG/JPEG/WEBP). The 512×512 wave PNG
// lives in public/ and is served by Vercel at the SITE-rooted path below.
// (GitHub raw 404s because the repo is private — Vercel is the public CDN.)
const LOGO_URL = `${SITE}/swfl-data-gulf-icon-512.png`;
const COVER_URL = LOGO_URL;
const FRESHNESS = "SWFL-7421-v53-20260525";
const TODAY = new Date().toISOString().slice(0, 10);

async function api(method, path, body) {
  const r = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${t}`);
  return JSON.parse(t);
}

// ──────────────────────────────────────────────────────────────────────
// Block builders
// ──────────────────────────────────────────────────────────────────────
const T = (text, opts = {}) => ({
  type: "text",
  text: { content: text, link: opts.link ? { url: opts.link } : null },
  annotations: {
    bold: !!opts.bold,
    italic: !!opts.italic,
    strikethrough: false,
    underline: !!opts.underline,
    code: !!opts.code,
    color: opts.color || "default",
  },
});
const RT = (...x) => x.map((v) => (typeof v === "string" ? T(v) : v));
const P = (...rt) => ({
  object: "block",
  type: "paragraph",
  paragraph: { rich_text: RT(...rt) },
});
const _H1 = (txt, color = "default") => ({
  object: "block",
  type: "heading_1",
  heading_1: { rich_text: [T(txt)], color, is_toggleable: false },
});
const H2 = (txt, color = "default") => ({
  object: "block",
  type: "heading_2",
  heading_2: { rich_text: [T(txt)], color, is_toggleable: false },
});
const H3 = (txt, color = "default") => ({
  object: "block",
  type: "heading_3",
  heading_3: { rich_text: [T(txt)], color, is_toggleable: false },
});
const BUL = (...rt) => ({
  object: "block",
  type: "bulleted_list_item",
  bulleted_list_item: { rich_text: RT(...rt) },
});
const NUM = (...rt) => ({
  object: "block",
  type: "numbered_list_item",
  numbered_list_item: { rich_text: RT(...rt) },
});
const QUOTE = (color = "default", ...rt) => ({
  object: "block",
  type: "quote",
  quote: { rich_text: RT(...rt), color },
});
const DIVIDER = () => ({ object: "block", type: "divider", divider: {} });
const CODE = (txt, lang = "plain text") => ({
  object: "block",
  type: "code",
  code: { rich_text: [T(txt)], language: lang },
});
const CALLOUT = (emoji, color, ...rt) => ({
  object: "block",
  type: "callout",
  callout: { rich_text: RT(...rt), icon: { type: "emoji", emoji }, color },
});
const TOC = (color = "default") => ({
  object: "block",
  type: "table_of_contents",
  table_of_contents: { color },
});
const BOOKMARK = (url, ...captionRt) => ({
  object: "block",
  type: "bookmark",
  bookmark: { url, caption: captionRt.length ? RT(...captionRt) : [] },
});
const IMAGE = (url, ...captionRt) => ({
  object: "block",
  type: "image",
  image: {
    type: "external",
    external: { url },
    caption: captionRt.length ? RT(...captionRt) : [],
  },
});
const _TOGGLE = (heading, color, children) => ({
  object: "block",
  type: "toggle",
  toggle: { rich_text: [T(heading)], color, children },
});
const TOGGLE_BOLD = (heading, color, children) => ({
  object: "block",
  type: "toggle",
  toggle: { rich_text: [T(heading, { bold: true })], color, children },
});
const COLS = (...colsArrays) => ({
  object: "block",
  type: "column_list",
  column_list: {
    children: colsArrays.map((blocks) => ({
      object: "block",
      type: "column",
      column: { children: blocks },
    })),
  },
});
const TABLE = (rows, hasColHeader = true) => ({
  object: "block",
  type: "table",
  table: {
    table_width: rows[0].length,
    has_column_header: hasColHeader,
    has_row_header: false,
    children: rows.map((r) => ({
      object: "block",
      type: "table_row",
      table_row: {
        cells: r.map((cell) => (Array.isArray(cell) ? cell : [T(String(cell))])),
      },
    })),
  },
});
const STATUS = (label, color) => [T(label, { bold: true, color: `${color}_background` })];

// ──────────────────────────────────────────────────────────────────────
// Hub page — 3-column dashboard
// ──────────────────────────────────────────────────────────────────────
const hubBlocks = (childUrls = {}) => [
  // Hero callout
  CALLOUT(
    "🦅",
    "blue_background",
    T("Big Bird's Brain — SWFL Data Gulf hub. ", { bold: true }),
    T(`Last refresh ${TODAY}. Freshness token `),
    T(FRESHNESS, { code: true }),
    T(". Mirrors brain-platform repo. The repo wins on every disagreement."),
  ),

  // Inline logo
  IMAGE(
    LOGO_URL,
    T("SWFL Data Gulf — three stacked sine waves, decreasing opacity. Generator at "),
    T("Downloads/generate-icon.html", { code: true }),
    T("."),
  ),

  // 3-column dashboard
  COLS(
    // Column 1 — Live links
    [
      H3("🔌 Live links", "blue"),
      BOOKMARK(`${SITE}/api/mcp`, T("MCP endpoint", { bold: true })),
      BOOKMARK(SITE, T("Public site (homepage)", { bold: true })),
      BOOKMARK(REPO, T("brain-platform repo", { bold: true })),
      P(T("Install:", { bold: true, color: "gray" })),
      CODE("claude mcp add --transport http swfl https://www.swfldatagulf.com/api/mcp", "shell"),
    ],
    // Column 2 — Status
    [
      H3("📊 Status", "blue"),
      CALLOUT("🟢", "green_background", T("MCP v1 LIVE in prod", { bold: true })),
      CALLOUT("🟢", "green_background", T("15 brains feeding master", { bold: true })),
      CALLOUT("🟡", "yellow_background", T("master = index, not synthesizer", { bold: true })),
      CALLOUT("🔴", "red_background", T("tourism-tdt reads premise's Supabase", { bold: true })),
      CALLOUT("🟢", "green_background", T("20 ingest pipelines active", { bold: true })),
      CALLOUT("🟡", "orange_background", T("1 OPEN incident: faf5-annual DDL", { bold: true })),
    ],
    // Column 3 — Brand
    [
      H3("🎨 Brand", "blue"),
      P(T("Background  ", { color: "gray" }), T("#080E11", { bold: true, code: true })),
      P(
        T("Accent teal  ", { color: "gray" }),
        T("#0a8078", { bold: true, code: true, color: "blue" }),
      ),
      P(
        T("                       ", { color: "gray" }),
        T("#3ECFB2", { bold: true, code: true, color: "blue" }),
      ),
      P(
        T("Bearish amber  ", { color: "gray" }),
        T("#E8A84C", { bold: true, code: true, color: "orange" }),
      ),
      P(T("Fonts  ", { color: "gray" }), T("IBM Plex Sans + Mono", { bold: true })),
      P(T("Notion mapping:", { color: "gray" })),
      P(T("teal → ", { color: "gray" }), T("blue_background", { code: true, color: "blue" })),
      P(T("amber → ", { color: "gray" }), T("orange_background", { code: true, color: "orange" })),
    ],
  ),

  DIVIDER(),

  // What shipped this week
  H2("✅ Shipped in the last 7 days", "green"),
  BUL(
    T("housing-swfl ", { code: true }),
    T("— Redfin buy-side brain, 125 SWFL ZIPs, Jan 2026 vintage"),
  ),
  BUL(
    T("permits-swfl ", { code: true }),
    T("— second-county join (Collier added via Firecrawl stealth-scrape)"),
  ),
  BUL(
    "corridor character generator Steps 0–4.5 — per-corridor facts + chart + speculative blocks, all 26 corridors",
  ),
  BUL("MCP v1 live in prod + waitlist + Anthropic Connectors directory submitted"),
  BUL(
    "Freshness-first chain (PRs #19–#26) — pipeline-freshness standard, scaffold, drift-guard, daily probe, cadence registry, 3 new Tier-1 macro pipelines",
  ),
  BUL(
    T("Firecrawl→Spider fallback rule locked (", { color: "default" }),
    T("CLAUDE.md §6", { code: true }),
    T(" / PR #48)"),
  ),

  DIVIDER(),

  // What's next
  H2("🎯 What's next (sequenced)", "blue"),
  CALLOUT(
    "🥇",
    "blue_background",
    T("1. Master synthesizer (§6.1). ", { bold: true }),
    T(
      "Every other roadmap item depends on it. After master synthesizes, every brain compounds against a real combined-conclusion endpoint.",
    ),
  ),
  NUM(
    T("Self-ingest tourism-tdt source data ", { bold: true }),
    T("— drop premise-engine's Supabase dependency."),
  ),
  NUM(T("Per-domain LAKE_ID refactor (§6.3) ", { bold: true }), T("— mechanical.")),
  NUM(T("NOW acceptance tests (§6.4) ", { bold: true }), T("— prove §6.1 + speaker layer.")),
  NUM(
    T("Industry-characters Phase 0 ", { bold: true }),
    T("— 7-voice multiplier on the corridor-character pattern."),
  ),

  DIVIDER(),

  // Blocked / stale
  H2("⚠️ Blocked / stale / open incidents", "orange"),
  CALLOUT(
    "🛠",
    "orange_background",
    T("tourism-tdt", { code: true }),
    T(" brain reads "),
    T("fl_dor_tdt_collections", { code: true }),
    T(" from premise-engine's Supabase. Self-ingest plan in the Premise Data Replacement page."),
  ),
  CALLOUT(
    "🛠",
    "orange_background",
    T("faf5-annual ", { code: true }),
    T("workflow OPEN: "),
    T('relation "data_lake.faf_sctg_lookup" does not exist', { code: true }),
    T(". Needs versioned DDL + DLT state clear."),
  ),
  CALLOUT(
    "🛠",
    "orange_background",
    T("news_swfl ", { code: true }),
    T("pipeline in "),
    T("not_yet_running", { code: true }),
    T(" — no consumer brain yet, Tier-1 cold storage."),
  ),

  DIVIDER(),

  // Detailed sections — bookmark cards
  H2("📚 Detailed sections", "blue"),
  P(
    T(
      "Each child page below is a paste-mirror of an in-repo doc. The repo is the source of truth; these pages are the readable surface.",
      { italic: true, color: "gray" },
    ),
  ),
  ...(childUrls.audit
    ? [
        BOOKMARK(
          childUrls.audit,
          T("📋 Project Audit — repo, issues, pipelines, roadmap scorecard, phantom work", {
            bold: true,
          }),
        ),
      ]
    : []),
  ...(childUrls.roadmap
    ? [
        BOOKMARK(
          childUrls.roadmap,
          T("🗺️ Roadmap — NEXT / NEAR / LONG + North Star", { bold: true }),
        ),
      ]
    : []),
  ...(childUrls.premise
    ? [
        BOOKMARK(
          childUrls.premise,
          T("🛠 Premise Data Replacement Plan — drop the cross-project tether", { bold: true }),
        ),
      ]
    : []),
  ...(childUrls.inv
    ? [
        BOOKMARK(
          childUrls.inv,
          T("📊 Data Sources Inventory — every premise source vs. our state", {
            bold: true,
          }),
        ),
      ]
    : []),

  DIVIDER(),

  // Repo deep links
  H2("🔗 Source-of-truth files in the repo", "gray"),
  COLS(
    [
      BOOKMARK(
        `${REPO}/blob/main/CLAUDE.md`,
        T("CLAUDE.md", { code: true }),
        T(" — agent rules (RULE 0, RULE 1, Brain Factory non-negotiables, SWFL Protocol v3)"),
      ),
      BOOKMARK(
        `${REPO}/blob/main/SESSION_LOG.md`,
        T("SESSION_LOG.md", { code: true }),
        T(" — append-only cross-session activity"),
      ),
      BOOKMARK(
        `${REPO}/blob/main/docs/ontology-and-roadmap.md`,
        T("ontology-and-roadmap.md", { code: true }),
        T(" — quarterly-reviewed living roadmap"),
      ),
      BOOKMARK(
        `${REPO}/blob/main/docs/BRAIN_PLATFORM_AUTOMATION_GUIDE.md`,
        T("BRAIN_PLATFORM_AUTOMATION_GUIDE.md", { code: true }),
        T(" — single-doc build guide for the automation layer"),
      ),
    ],
    [
      BOOKMARK(
        `${REPO}/blob/main/docs/standards/pipeline-freshness.md`,
        T("pipeline-freshness.md", { code: true }),
        T(" — Firecrawl→Spider rule + 6 cron rules"),
      ),
      BOOKMARK(
        `${REPO}/blob/main/docs/cron-rebuild-failures.md`,
        T("cron-rebuild-failures.md", { code: true }),
        T(" — auto-capture incident ledger"),
      ),
      BOOKMARK(
        `${REPO}/blob/main/ingest/cadence_registry.yaml`,
        T("cadence_registry.yaml", { code: true }),
        T(" — every pipeline + cadence"),
      ),
      BOOKMARK(
        `${REPO}/tree/main/_AUDIT_AND_ROADMAP`,
        T("_AUDIT_AND_ROADMAP/", { code: true }),
        T(" — dated audit + roadmap + premise chart + HTML inventory"),
      ),
    ],
  ),

  DIVIDER(),

  // North star
  H2("🌊 North star", "blue"),
  QUOTE(
    "blue",
    T(
      "A homebuyer, a CRE analyst, a city planner, a journalist, a small operator, a parent picking a school — they can hold three variables in their head when they make a real decision about a real place. ",
      { bold: true },
    ),
    T("We hold fifty, weighted honestly, with a quoted citation chain. "),
    T("Math is easy. Weighting is everything. ", { italic: true }),
    T(
      "A war starts in Iran, crude is going to $7, retail gas is about to double — the math hasn't changed but the decision has. That's the gas tank. Brains is the apparatus that recognizes the shockwave coming and weights every other brain against it.",
    ),
  ),

  // Footer
  P(
    T("Generated by ", { color: "gray" }),
    T("scripts/notion-sync.mjs", {
      code: true,
      link: `${REPO}/blob/main/scripts/notion-sync.mjs`,
    }),
    T(" · runs every Monday 09:00 ET via ", { color: "gray" }),
    T(".github/workflows/notion-sync-weekly.yml", {
      code: true,
      link: `${REPO}/blob/main/.github/workflows/notion-sync-weekly.yml`,
    }),
    T(" · manual: ", { color: "gray" }),
    T("gh workflow run notion-sync-weekly.yml", { code: true }),
  ),
];

// ──────────────────────────────────────────────────────────────────────
// Helpers used in detail pages
// ──────────────────────────────────────────────────────────────────────
const childIntro = (title, repoPath, ...extra) => [
  CALLOUT(
    "🦅",
    "blue_background",
    T(`${title} — ${TODAY}. `, { bold: true }),
    T("Source of truth in the repo: "),
    T(repoPath, { code: true, link: `${REPO}/blob/main/${repoPath}` }),
    T(". "),
    ...extra,
  ),
  TOC("gray"),
  DIVIDER(),
];

// ──────────────────────────────────────────────────────────────────────
// AUDIT page
// ──────────────────────────────────────────────────────────────────────
const auditBlocks = () => [
  ...childIntro("Project Audit", "_AUDIT_AND_ROADMAP/audit-2026-05-27.md"),

  H2("Branch + tests"),
  COLS(
    [
      CALLOUT(
        "📌",
        "green_background",
        T("Branch: ", { bold: true }),
        T("main", { code: true }),
        T(" — clean except untracked operator-owned fixture"),
      ),
    ],
    [
      CALLOUT(
        "🧪",
        "green_background",
        T("Tests: ", { bold: true }),
        T("762 pass / 0 fail / 0 skip", { code: true }),
        T(" — bun test 897ms"),
      ),
    ],
  ),

  H2("Headline state"),
  BUL("15 upstream brains feeding master."),
  BUL(
    T("tourism-tdt", { code: true }),
    T(
      " IS LIVE — reads from premise-engine's Supabase. Flagged for self-ingest in the Premise Data Replacement page.",
    ),
  ),
  BUL(
    T("MCP v1 fully live in prod. ", { color: "default" }),
    T("swfl_fetch", { code: true }),
    T(" returns SSE-framed JSON-RPC; tier-2 master payload carries freshness token "),
    T(FRESHNESS, { code: true }),
    T("."),
  ),
  BUL("133 commits in the audit window. Busiest day 2026-05-27 (47 commits, 7 PRs)."),

  H2("What shipped — by day"),
  TABLE([
    ["Day", "Highlight"],
    ["2026-05-22", "Fiverr briefs added."],
    ["2026-05-23", "Redfin SWFL pipeline; rentals-swfl ZORI brain (PR #9); viz scaffold."],
    [
      "2026-05-24",
      "MCP v1 step 1 + step 2 foundation; corridor-data pipeline + bundle; URL migration to www.swfldatagulf.com; Resend waitlist email.",
    ],
    [
      "2026-05-25",
      "MCP step 3 /connect; speaker CRLF fix; banned internal pack IDs in MCP; provenance page (PR #13); BLS LAUS + macro-swfl real metrics (PR #14); MarketBeat Flow 3 (PR #18).",
    ],
    [
      "2026-05-26",
      "Freshness-first chain PRs #19–#26; MCP basePath fix (PR #28) — POST live; MCP v1 LIVE IN PROD; permits-swfl v2 (PR #29); SESSION_LOG mechanism; corridor-character Steps 0–2; broker-scrape pipelines killed (PR #41).",
    ],
    [
      "2026-05-27",
      "corridor-character Step 4 — all 26 corridors (PR #42); Step 4.5 type-conditional voice (PR #43); housing-swfl LIVE; permits-swfl Collier join; auto-capture incident ledger; data-intel page; FDOT pagination fix (PR #45); CI catalog drift fix (PR #46); spider extraction-schema fix (PR #47); Firecrawl→Spider plain-scrape wrapper + rule lock (PR #48); 5 stale GH issues closed; CLAUDE.md refactored 21KB→16KB; _AUDIT_AND_ROADMAP/ folder created; Notion automation layer shipped.",
    ],
  ]),

  H2("Issue board"),
  COLS(
    [
      CALLOUT(
        "📭",
        "default",
        T("Open: ", { bold: true }),
        T("1 — "),
        T("#44 Cron incident feed (do not close)", { code: true }),
        T(" — sticky."),
      ),
      CALLOUT("✅", "green_background", T("Open PRs: ", { bold: true }), T("0.")),
    ],
    [
      CALLOUT(
        "📬",
        "gray_background",
        T("Closed in window: ", { bold: true }),
        T("#33 (epic), #34, #35, #36, #37, #38 — all corridor-character sub-issues."),
      ),
      CALLOUT(
        "🌿",
        "yellow_background",
        T("Stale local branch: ", { bold: true }),
        T("fix/firecrawl-agent-client", { code: true }),
        T(" — upstream gone, commits live in PR #47."),
      ),
    ],
  ),

  TOGGLE_BOLD("📊 Pipeline status (click to expand — 21 pipelines)", "default", [
    TABLE([
      ["Pipeline", "Tier", "Cadence", "Status"],
      ["zori_swfl_duckdb", "T1 DuckDB", "30d", "OWN"],
      ["redfin_swfl", "T1 DuckDB", "30d", "OWN — first-fired 2026-05-27"],
      ["hurdat2_fl", "T1 DuckDB", "365d", "OWN"],
      ["storm_history_swfl", "T1 DuckDB", "30d", "OWN"],
      ["usgs", "T1 DuckDB", "30d", "OWN"],
      ["faf5", "T1 prefix", "365d", "OWN — incident OPEN (faf_sctg_lookup DDL gap)"],
      ["fred_g17", "T1", "30d", "OWN — first-fired 2026-05-27"],
      ["bls_ppi", "T1", "30d", "OWN — first-fired 2026-05-27"],
      ["census_vip", "T1", "30d", "OWN — first-fired 2026-05-27"],
      ["bls_laus", "T2 dlt", "30d", "OWN"],
      ["bls_qcew", "T2 dlt", "90d", "OWN"],
      ["census_cbp", "T2 dlt", "365d", "OWN"],
      ["usgs_tier2", "T2 dlt", "30d", "OWN"],
      ["fema", "T2 dlt", "90d", "OWN"],
      ["leepa", "T2 dlt", "365d", "OWN"],
      ["fhfa", "T2 dlt", "90d", "OWN"],
      ["fdot", "T2 dlt", "365d", "OWN"],
      ["lee_permits", "T2 dlt", "7d", "OWN"],
      ["collier_permits", "T2 dlt", "30d", "OWN — first cron June 5 2026"],
      ["zori_swfl_tier2", "T2 dlt", "30d", "OWN"],
      ["news_swfl", "T1", "—", "not_yet_running — no consumer brain"],
    ]),
    CALLOUT(
      "🛠",
      "orange_background",
      T("Open incident: ", { bold: true }),
      T("faf5-annual", { code: true }),
      T(" — needs versioned DDL + DLT state clear."),
    ),
  ]),

  H2("Roadmap scorecard vs. ontology doc"),
  TABLE([
    ["Item", "Status"],
    [
      "§6.1 Master synthesizer",
      [...STATUS("NOT STARTED", "red"), T(" — highest-leverage NOW item")],
    ],
    [
      "§6.2 tourism-tdt brain",
      [...STATUS("LIVE", "green"), T(" (ontology doc says 'not started' — WRONG)")],
    ],
    ["§6.3 Per-domain LAKE_ID", [...STATUS("NOT STARTED", "red"), T(" — mechanical")]],
    ["§6.4 NOW acceptance tests", [...STATUS("NOT STARTED", "red"), T(" — gated on §6.1 + §6.5")]],
    [
      "§6.5 Speaker Layer + Tier Table",
      [...STATUS("PARTIAL", "yellow"), T(" — speaker exists, tier table not formalized")],
    ],
    [
      "§6.6 Trigger Logic + Capability Inventory",
      [...STATUS("PARTIAL", "yellow"), T(" — in MCP tool description")],
    ],
    ["§6.7 MCP Wrapper", [...STATUS("SHIPPED ✅", "green"), T(" LIVE IN PROD")]],
  ]),

  TOGGLE_BOLD("👻 Phantom / dead / drift (click to expand)", "default", [
    BUL(
      T("docs/superpowers/plans/2026-05-26-corridor-broker-narrative-promotion/", { code: true }),
      T(" — DEAD. Dir gitignored."),
    ),
    BUL(
      T("docs/superpowers/plans/2026-05-25-firecrawl-pipeline-skeleton/README.md", { code: true }),
      T(" — PARTIAL. Status banner added 2026-05-27."),
    ),
    BUL(
      T("ingest/pipelines/{marketbeat_swfl, corridor_narratives, county_planning_swfl}/", {
        code: true,
      }),
      T(" — pycache dirs only after Sonnet's 2026-05-27 cleanup pass."),
    ),
    BUL(
      "MEMORY.md drift fixed 2026-05-27: SHA synced, tourism-tdt premise dep flagged, MCP v1 marked LIVE.",
    ),
    BUL("Stale local branch fix/firecrawl-agent-client."),
  ]),

  H2("What's actually missing"),
  NUM(T("Master synthesizer (§6.1) — oldest unstarted NOW item.", { bold: true })),
  NUM("Self-ingest tourism-tdt source data."),
  NUM("Per-domain LAKE_ID refactor (§6.3)."),
  NUM("NOW acceptance tests (§6.4)."),
  NUM("faf5-annual DDL gap."),
  NUM("news_swfl first-fire."),
  NUM("Industry-characters Phase 0 (8 files in one PR)."),
  NUM("Vercel-side env-var rename."),
  NUM("test_pipeline_drift.py cleanup."),

  H2("Recommended next"),
  CALLOUT(
    "🎯",
    "green_background",
    T("Master synthesizer (§6.1). ", { bold: true }),
    T(
      "Single highest-leverage unblock. After master synthesizes, every other roadmap item compounds against a real combined-conclusion endpoint. Right window: 15 upstreams shipped; never more to synthesize.",
    ),
  ),
];

// ──────────────────────────────────────────────────────────────────────
// ROADMAP page
// ──────────────────────────────────────────────────────────────────────
const roadmapBlocks = () => [
  ...childIntro("Roadmap", "_AUDIT_AND_ROADMAP/roadmap-2026-05-27.md"),

  H2("Where we are"),
  P(
    "15 upstream brains feeding master. MCP v1 live in prod. Pipeline-freshness standard locked. SESSION_LOG mechanism enforces cross-session continuity. Speaker layer renders tier-1/2/3 voice. Brain output is deterministic math + cited narrative; every numeric claim traces to a source_url.",
  ),

  DIVIDER(),

  H2("🎯 NEXT — 1–3 weeks (sequenced)", "blue"),

  H3("1. Master synthesizer (§6.1)", "blue"),
  CALLOUT(
    "🥇",
    "blue_background",
    T("Why first: ", { bold: true }),
    T(
      "every roadmap item below depends on it. Right window — housing-swfl + permits-swfl Collier + Step 4.5 voice all just landed.",
    ),
  ),
  TOGGLE_BOLD("Concrete work (4 items)", "blue", [
    BUL(
      T("outputProducer", { code: true }),
      T(" on master pack that reads downstream OUTPUT blocks and emits "),
      T("conclusion + key_metrics + caveats + contradicts", { code: true }),
      T("."),
    ),
    BUL(
      T("Close OUTPUT contract: top-level "),
      T("trust_tier", { code: true }),
      T(", "),
      T("direction", { code: true }),
      T(", "),
      T("contradicts: string[]", { code: true }),
      T(" on "),
      T("BrainOutput", { code: true }),
      T(". Atomic backfill across all 15 packs."),
    ),
    BUL(
      T("Expand "),
      T("inference-bait-lint", { code: true }),
      T(
        " to flag because / due to / leading to / which is why / as a result between two different brain IDs in master's OUTPUT.",
      ),
    ),
    BUL(
      T("Seed outcomes: "),
      T("predictions", { code: true }),
      T(" + "),
      T("outcomes", { code: true }),
      T(" DDL. Log every master refine. No UI yet."),
    ),
  ]),

  H3("2. Self-ingest tourism-tdt source data", "blue"),
  CALLOUT(
    "🛠",
    "orange_background",
    T(
      "Replaces the earlier 'ship tourism-tdt brain' item — that's done. Brain runs against premise-engine's Supabase today.",
    ),
  ),
  BUL(
    T("New "),
    T("ingest/pipelines/tdt_swfl/", { code: true }),
    T(" reading Lee County Clerk Doc 328 directly → "),
    T("data_lake.tdt_collections", { code: true }),
  ),
  BUL(
    T("Same PR cuts over "),
    T("tourism-tdt-source.mts:TABLE", { code: true }),
    T(" to brain-platform Supabase."),
  ),

  H3("3. Per-domain LAKE_ID refactor (§6.3)", "blue"),
  P(
    T("Replace generic "),
    T("SWFL-7421-v…", { code: true }),
    T(" with per-domain tokens ("),
    T("FINANCE-v…", { code: true }),
    T(", "),
    T("ENVIRONMENTAL-v…", { code: true }),
    T(", etc.). Mechanical. Unblocks stale-by-domain caveats."),
  ),

  H3("4. NOW acceptance tests (§6.4)", "blue"),
  COLS(
    [
      CALLOUT(
        "👔",
        "default",
        T("Test A (operator audit, T3): ", { bold: true }),
        T(
          '"Is now a good time to sign a 5-year accommodation lease on Fort Myers Beach?" → one synthesized conclusion citing macro + tourism + sector credit + CRE + franchise outcomes.',
        ),
      ),
    ],
    [
      CALLOUT(
        "🏠",
        "default",
        T("Test B (homebuyer, T2 conversational): ", { bold: true }),
        T(
          '"Under $500K in Lee County, which ZIPs give me the best shot at low flood-insurance costs without sitting in a stagnant neighborhood?" → phone-screen length, no § / no internal pack IDs.',
        ),
      ),
    ],
  ),
  CALLOUT(
    "⚠️",
    "orange_background",
    T(
      "If A returns 'look at each brain individually' → §6.1 isn't done. If B returns an 800-word CRE-analyst dissertation → speaker layer (§6.5) isn't done.",
    ),
  ),

  H3("5. Industry-characters Phase 0", "blue"),
  P(
    T("Clones the corridor-character generator pattern across 7 voices. One PR, 8 files. Plan: "),
    T("docs/superpowers/plans/2026-05-26-industry-characters/", {
      code: true,
      link: `${REPO}/tree/main/docs/superpowers/plans/2026-05-26-industry-characters`,
    }),
  ),

  DIVIDER(),

  H2("📅 NEAR-TERM — 1–3 months"),
  NUM(
    T("Industry-characters Phase 1 ", { bold: true }),
    T("— Voices 1–3 (main-street, storm-ready, move-ready). All data live; no new pipes."),
  ),
  NUM(
    T("Corridor Factor (§7.1) ", { bold: true }),
    T(
      "— first Tier 3 derived metric. Single multiplier normalizing business performance by location advantage.",
    ),
  ),
  NUM(
    T("Constitution as YAML (§7.2) ", { bold: true }),
    T("— "),
    T("refinery/constitution/master.yaml", { code: true }),
    T(". Plain YAML default; revisit GoRules Zen JDM at rule count ≥ 20."),
  ),
  NUM(
    T("2-round critique-revision loop ", { bold: true }),
    T("at master synthesis. Hard-cap at 2."),
  ),
  NUM(
    T("Yager-DST confidence upgrade (§7.4) ", { bold: true }),
    T("— write "),
    T("refinery/lib/confidence-yager.mts", { code: true }),
    T(" ourselves (~30 LOC)."),
  ),
  NUM(T("Industry-characters Phases 2–4 ", { bold: true }), T("— Voices 4–7.")),
  NUM(
    T("Spatial oracle (§7.6) ", { bold: true }),
    T("— Supabase RPC "),
    T("corridor_for_point(lat, lon)", { code: true }),
    T("."),
  ),
  NUM(
    T("Report-page side channel (§7.7) ", { bold: true }),
    T("— "),
    T("/r/[slug]", { code: true }),
    T(" upgrade: real charts, maps, citation tables."),
  ),
  NUM(T("faf5-annual DDL gap.")),

  DIVIDER(),

  H2("🚀 LONG-TERM — 3–12 months"),
  NUM(
    T("Outcomes loop wired up. ", { bold: true }),
    T(
      "Cron grades predictions against observed values; surface drift; flag brains systematically wrong.",
    ),
  ),
  NUM(
    T("Causal layer (§8.1). ", { bold: true }),
    T("Instrumental variable analysis using Hurricane Ian as exogenous shock."),
  ),
  NUM(
    T("Backtests (§8.2). ", { bold: true }),
    T("Every derived metric tested against 2022–2024 outcomes."),
  ),
  NUM(
    T("Scheduled runs + watch-list + real-time subscriptions. ", {
      bold: true,
    }),
    T("3am refinery; brief in inbox by 7am."),
  ),
  NUM(
    T("Regional expansion. ", { bold: true }),
    T("FL-other-cities → FL statewide → national anchor → outlier brain."),
  ),
  NUM(
    T("Multi-tenant /vault (BYO overlay). ", { bold: true }),
    T("Companies overlay their own asset data on SWFL fact packs."),
  ),
  NUM(
    T("Multi-agent inference (§8.6). ", { bold: true }),
    T("Each brain as its own parallel Claude agent."),
  ),
  NUM(
    T("Fine-tuned synthesis model (§8.7). ", { bold: true }),
    T("Constitution stops being prompt, starts being weights."),
  ),

  DIVIDER(),

  H2("🌊 North star"),
  QUOTE(
    "blue",
    T(
      "A homebuyer / analyst / planner / journalist / operator holds three variables in their head. ",
      { bold: true },
    ),
    T("We hold fifty, weighted honestly, with a quoted citation chain. "),
    T("Math is easy. Weighting is everything. ", { italic: true }),
    T(
      "Brains is the apparatus that recognizes shockwaves and weights every other brain against them.",
    ),
  ),
];

// ──────────────────────────────────────────────────────────────────────
// PREMISE DATA REPLACEMENT page
// ──────────────────────────────────────────────────────────────────────
const premiseBlocks = () => [
  ...childIntro(
    "Premise-Engine Data — Self-Ingest Plan",
    "_AUDIT_AND_ROADMAP/premise-data-replacement.md",
  ),

  QUOTE(
    "default",
    T("Goal: drop every live runtime dependency on premise-engine's Supabase. ", { bold: true }),
    T("Self-ingest each feed; cut over the source connector; close the cross-project tether."),
  ),

  H2("🚨 Live data dependencies (must replace)"),
  TABLE([
    ["#", "Brain", "Premise table", "Origin", "Self-ingest plan"],
    [
      "1",
      "tourism-tdt",
      "fl_dor_tdt_collections",
      "Florida DOR — TDT collections. Lee County Clerk Doc 328. 103 monthly rows FY2013 → FY2026.",
      "New Tier-2 pipeline ingest/pipelines/tdt_swfl/ → data_lake.tdt_collections. Same PR cuts over tourism-tdt-source.mts:TABLE.",
    ],
  ]),

  TOGGLE_BOLD("📝 Historical references (not live data — comment cleanups only)", "default", [
    TABLE([
      ["File", "Mention", "Action"],
      [
        "refinery/sources/cre-source.mts:23",
        "premise-engine RLAIF Phase D training proposals (mostly unapproved/inactive)",
        "Comment-only. Leave or trim.",
      ],
      [
        "refinery/sources/sector-credit-swfl-source.mts:13",
        "Live shape (from premise-engine's 20260509190000_sba_loans_schema.sql)",
        "Schema lineage. SBA loans is brain-platform's own table.",
      ],
      [
        "refinery/types/scoring.mts:2",
        "Three-layer scoring vocabulary (adapted from premise-engine's process doc)",
        "Concept lineage. No code dependency.",
      ],
      [
        "refinery/README.md:30",
        "reads premise-engine Supabase / Sanity",
        "Stale doc. Update once tourism-tdt cut-over lands.",
      ],
      [
        "docs/sql/*_grant.sql",
        "References to premise as origin of grant patterns",
        "Historical. Leave.",
      ],
    ]),
  ]),

  H2("Sanity dataset — needs verification"),
  P(
    T("Per memory, brain-platform was reading "),
    T("corridorProfile", { code: true }),
    T(" from Sanity dataset "),
    T("lpyl3q9w/production", { code: true }),
    T(". Current code reads "),
    T("corridor_profiles", { code: true }),
    T(" from Supabase. Sanity dependency appears dropped already; verify with:"),
  ),
  CODE("grep -rn '@sanity/client\\|sanityClient' app/ refinery/", "shell"),

  H2("Sequence"),
  NUM(
    T("Stand up "),
    T("ingest/pipelines/tdt_swfl/", { code: true }),
    T(" → "),
    T("data_lake.tdt_collections", { code: true }),
    T(". Ship in same PR as the cut-over edit to "),
    T("tourism-tdt-source.mts", { code: true }),
    T(" (Data Tier Policy rule 2 — brain-first gate)."),
  ),
  NUM("Verify Sanity has no live @sanity/client reads."),
  NUM(T("Comment cleanup pass; update "), T("refinery/README.md", { code: true }), T(".")),
  NUM("Mark premise-engine fully decoupled in SESSION_LOG; date this chart."),

  H2("Why this matters"),
  CALLOUT(
    "⚠️",
    "orange_background",
    T("Two projects sharing a runtime Supabase = silent schema-coupling. ", {
      bold: true,
    }),
    T(
      "premise-engine can drop a column tomorrow and our tourism-tdt brain breaks. Self-ingest means we own the schema, the cadence, the freshness token, and the citation URL — same as every other brain in the lake.",
    ),
  ),
];

// ──────────────────────────────────────────────────────────────────────
// DATA SOURCES INVENTORY page
// ──────────────────────────────────────────────────────────────────────
const invHeader = (emoji, title) => H2(`${emoji} ${title}`, "blue");

const inventoryBlocks = () => [
  ...childIntro(
    "Data Sources Inventory",
    "_AUDIT_AND_ROADMAP/data-sources-inventory.html",
    T(
      "Cross-walked against premise-engine's 24+ sources. Full brand-styled HTML version companion in the repo.",
    ),
  ),

  CALLOUT(
    "🎨",
    "blue_background",
    T("Status legend: ", { bold: true }),
    ...STATUS("OWN", "green"),
    T(" we ingest brain-platform-controlled · "),
    ...STATUS("PREMISE-DEP", "red"),
    T(" we read from premise's Supabase, must self-ingest · "),
    ...STATUS("NEED", "blue"),
    T(" not ingested; premise has it; build it · "),
    ...STATUS("PARTIAL", "yellow"),
    T(" some coverage; gaps documented · "),
    ...STATUS("DEFER", "gray"),
    T(" not required for current brains."),
  ),

  COLS(
    [
      CALLOUT(
        "✅",
        "green_background",
        T("20 OWN", { bold: true }),
        T(" — brain-platform controls these end to end."),
      ),
    ],
    [
      CALLOUT(
        "🚨",
        "red_background",
        T("1 PREMISE-DEP", { bold: true }),
        T(" — tourism-tdt. Single PR to decouple."),
      ),
    ],
    [
      CALLOUT(
        "📋",
        "blue_background",
        T("12 NEED", { bold: true }),
        T(" — mapped to future brain consumers."),
      ),
    ],
    [
      CALLOUT(
        "⏸",
        "gray_background",
        T("9 DEFER", { bold: true }),
        T(" — paid, niche, or design-stage."),
      ),
    ],
  ),

  invHeader("🔵", "Demographics & Population"),
  TABLE([
    ["Source", "What we get", "Status", "Plan / brain-platform table"],
    [
      "Census ACS 5yr (2020-2024)",
      "Pop, income, age, housing, commute",
      STATUS("NEED", "blue"),
      "Build ingest/pipelines/census_acs/; consumer: demographics-swfl (planned)",
    ],
    [
      "Census ACS 1yr (2024)",
      "Faster pop + income estimates",
      STATUS("NEED", "blue"),
      "Same pipeline as 5yr; different vintage",
    ],
    [
      "Census CBP",
      "Establishments + employment by NAICS + county",
      STATUS("OWN", "green"),
      "data_lake.census_cbp — Tier 2 dlt, annual",
    ],
    [
      "Census BPS",
      "Building permits by county — new-construction proxy",
      STATUS("NEED", "blue"),
      "Monthly. Permits-swfl regional context layer.",
    ],
    [
      "Census B25034",
      "Housing stock age distribution by block group",
      STATUS("NEED", "blue"),
      "5yr cycle. Pair with housing-swfl extension.",
    ],
    [
      "Census VIP",
      "Voting-age population",
      STATUS("OWN", "green"),
      "lake-tier1/macro/census_vip/ — first-fired 2026-05-27",
    ],
    [
      "IRS SOI",
      "Income distribution / AGI brackets by zip",
      STATUS("NEED", "blue"),
      "Open CSV bulk download. Wealth proxy.",
    ],
    [
      "UF BEBR Projections",
      "FL county pop projections to 2045",
      STATUS("NEED", "blue"),
      "Biennial. Pair with demographics-swfl.",
    ],
    [
      "Census LODES WAC",
      "Daytime workplace population by block",
      STATUS("DEFER", "gray"),
      "One-shot bulk. No current consumer.",
    ],
  ]),

  invHeader("🟢", "POIs & Competitive Landscape"),
  TABLE([
    ["Source", "What we get", "Status", "Plan / brain-platform table"],
    [
      "Google Places API (New)",
      "Nearby businesses, ratings, OPEN/CLOSED",
      STATUS("DEFER", "gray"),
      "5k/mo cap. Per-query cost. Defer.",
    ],
    [
      "OSM Overpass",
      "Open POI data — secondary fallback",
      STATUS("DEFER", "gray"),
      "Free. Same trigger as Google Places.",
    ],
    [
      "Foursquare OS Places",
      "~6k SWFL businesses — Apache 2.0",
      STATUS("NEED", "blue"),
      "Bulk-loadable. Candidate for cre-swfl + franchise-outcomes enrichment.",
    ],
  ]),

  invHeader("🟡", "Traffic, Corridors & Seasonal Index"),
  TABLE([
    ["Source", "What we get", "Status", "Plan / brain-platform table"],
    [
      "FDOT AADT",
      "Annual avg daily traffic counts",
      STATUS("OWN", "green"),
      "data_lake.fdot_aadt_fl — 103,662 rows",
    ],
    [
      "SWFL Regional Planning Council",
      "Seasonal index (snowbird mult Nov–Apr)",
      STATUS("NEED", "blue"),
      "+22% all-business swing. Pair with master synthesizer.",
    ],
    [
      "GoDaddy Venture Forward MAI",
      "Microbusiness activity index by zip",
      STATUS("NEED", "blue"),
      "Quarterly. Free. Pair with sector-credit-swfl.",
    ],
    [
      "FGCU RERI",
      "Regional Economic Research Institute indicators",
      STATUS("NEED", "blue"),
      "Quarterly. SWFL-specific pulse.",
    ],
    [
      "Lee County TDT",
      "Monthly TDT collections (FY2013→present)",
      STATUS("PREMISE-DEP", "red"),
      "READS FROM PREMISE. Plan: ingest/pipelines/tdt_swfl/.",
    ],
    [
      "Collier TDT",
      "Collier County TDT collections",
      STATUS("NEED", "blue"),
      "Extend Lee TDT pipeline. Two-county coverage.",
    ],
    [
      "Charlotte TDT",
      "Charlotte County TDT collections",
      STATUS("NEED", "blue"),
      "Third county. Same pipeline pattern.",
    ],
    [
      "RSW Airport Enplanements",
      "Passenger volume — snowbird arrival proxy",
      STATUS("NEED", "blue"),
      "Monthly. Pair with tourism-tdt.",
    ],
  ]),

  invHeader("🟣", "Housing & Land Cover"),
  TABLE([
    ["Source", "What we get", "Status", "Plan / brain-platform table"],
    [
      "Zillow ZORI",
      "Rent index by zip (monthly)",
      STATUS("OWN", "green"),
      "data_lake.zori_swfl + lake-tier1. Brain: rentals-swfl",
    ],
    [
      "Zillow ZHVI",
      "Home value index by zip (monthly)",
      STATUS("NEED", "blue"),
      "Sibling of ZORI. ingest/duckdb_pipelines/zhvi_swfl/",
    ],
    [
      "Redfin",
      "Median sale price, DOM, listing velocity (weekly)",
      STATUS("OWN", "green"),
      "lake-tier1/market/redfin_swfl.parquet — Brain: housing-swfl",
    ],
    [
      "NLCD 2024 (USGS)",
      "Land cover classification + change count",
      STATUS("DEFER", "gray"),
      "Custom AEA WGS84 CRS. No current env-swfl consumer.",
    ],
    [
      "FHFA HPI",
      "House Price Index (Cape Coral MSA + statewide)",
      STATUS("OWN", "green"),
      "data_lake.fhfa_hpi — Brain: housing-swfl + master",
    ],
    [
      "LeePA Parcels",
      "Lee County parcels (joined 9+10+12) ~585K rows",
      STATUS("OWN", "green"),
      "data_lake.leepa_parcels_tier2 — Brain: properties-lee-value",
    ],
  ]),

  invHeader("🔴", "Risk, Regulatory & Spatial Overlays"),
  TABLE([
    ["Source", "What we get", "Status", "Plan / brain-platform table"],
    [
      "FEMA NFHL",
      "Flood zone polygons (AE / X / VE)",
      STATUS("OWN", "green"),
      "data_lake.fema_nfip_tier2 — Brain: env-swfl",
    ],
    [
      "FEMA NFIP Claims",
      "Flood insurance claims aggregates",
      STATUS("OWN", "green"),
      "env-swfl 2-source storm-vs-baseline + storm-shadow override",
    ],
    [
      "LightBox suite",
      "NFHL / Risk Index / OZ / Wetlands / Geocoding",
      STATUS("DEFER", "gray"),
      "Paid sandbox. Defer until paid-tier business case.",
    ],
    [
      "HURDAT2",
      "Atlantic hurricane track database 1851–2024",
      STATUS("OWN", "green"),
      "lake-tier1/environmental/hurdat2_fl.parquet",
    ],
    [
      "NOAA Storm Events",
      "Storm events 1996–2025 SWFL",
      STATUS("OWN", "green"),
      "1,178 SWFL events — Brain: storm-history-swfl",
    ],
    [
      "FL DEP Brownfields",
      "Brownfield site polygons",
      STATUS("NEED", "blue"),
      "FDEP ArcGIS FeatureServer. Pair with env-swfl.",
    ],
    [
      "Florida Forever (FNAI)",
      "Conservation lands overlay",
      STATUS("NEED", "blue"),
      "SFWMD FNAI. Pair with env-swfl + spatial RPC.",
    ],
    [
      "FL OIR Catastrophe Claims",
      "State insurance-carrier claim aggregates",
      STATUS("NEED", "blue"),
      "HTML-only. 240 rows / 13 events. Ian Lee = 95.7% closed.",
    ],
    [
      "USGS Water",
      "USGS water sites + daily readings",
      STATUS("OWN", "green"),
      "data_lake.usgs + lake-tier1",
    ],
    [
      "Lee Permits (Accela)",
      "Lee County building permits (weekly)",
      STATUS("OWN", "green"),
      "data_lake.lee_building_permits — Brain: permits-swfl",
    ],
    [
      "Collier Permits",
      "Collier County building permits (monthly XLSX)",
      STATUS("OWN", "green"),
      "data_lake.collier_building_permits — Firecrawl stealth-scrape",
    ],
  ]),

  invHeader("🔷", "Entity & Business Registry"),
  TABLE([
    ["Source", "What we get", "Status", "Plan / brain-platform table"],
    [
      "Sunbiz (Firecrawl)",
      "FL business survival rates by NAICS/county",
      STATUS("NEED", "blue"),
      "Survival rate basis for franchise-outcomes enrichment",
    ],
    [
      "Sunbiz Daily Filings (SFTP)",
      "1440-char fixed-width daily snapshot",
      STATUS("DEFER", "gray"),
      "No SFTP infra yet.",
    ],
    [
      "DBPR hrfood7.csv",
      "SWFL licensed food-service establishments",
      STATUS("NEED", "blue"),
      "District 7 = SWFL. Rotation outcomes = free closure labels.",
    ],
    [
      "SBA Loans (FOIA)",
      "SBA 7(a) + 504 loan volume by zip/NAICS",
      STATUS("OWN", "green"),
      "data_lake.sba_* — Brain: sector-credit-swfl",
    ],
    [
      "BLS LAUS",
      "County unemployment (Lee + Collier + FL)",
      STATUS("OWN", "green"),
      "data_lake.bls_laus — 328 rows. Brain: macro-swfl",
    ],
    [
      "BLS QCEW",
      "Quarterly Census of Employment + Wages",
      STATUS("OWN", "green"),
      "data_lake.bls_qcew — Brain: sector-credit-swfl",
    ],
    [
      "BLS PPI",
      "Producer Price Index",
      STATUS("OWN", "green"),
      "lake-tier1/macro/bls_ppi/ — first-fired 2026-05-27",
    ],
  ]),

  invHeader("🟠", "Spending, Financial & Economic Indicators"),
  TABLE([
    ["Source", "What we get", "Status", "Plan / brain-platform table"],
    [
      "ESRI Spending Potential",
      "Consumer spending by category + zip",
      STATUS("DEFER", "gray"),
      "Only paid source. Per-call cost. Defer.",
    ],
    [
      "FL DOR Sales Tax",
      "County-level taxable sales by industry",
      STATUS("NEED", "blue"),
      "Monthly. Actual spend activity by sector.",
    ],
    [
      "FRED",
      "Macro: unemployment, CPI, housing starts, SOFR",
      STATUS("OWN", "green"),
      "data_lake.fred_* — Brain: macro-us / macro-florida / macro-swfl",
    ],
    [
      "FRED G.17",
      "Industrial Production index",
      STATUS("OWN", "green"),
      "lake-tier1/macro/fred_g17/ — first-fired 2026-05-27",
    ],
    [
      "FDIC Summary of Deposits",
      "Bank deposits by branch + county",
      STATUS("NEED", "blue"),
      "Annual. api.fdic.gov/banks/sod. Pair with sector-credit-swfl.",
    ],
    [
      "FAF5 freight flows",
      "Freight Analysis Framework",
      STATUS("OWN", "green"),
      "lake-tier1/faf5/ — Brain: logistics-swfl. One open DDL incident.",
    ],
  ]),

  invHeader("🟢", "Geocoding, Routing & Spatial Infrastructure"),
  TABLE([
    ["Source", "What we get", "Status", "Plan / brain-platform table"],
    [
      "Mapbox API",
      "Geocoding, isochrones, static maps, directions",
      STATUS("OWN", "green"),
      "Wired via Mapbox MCP. Used by speaker layer + corridor pipeline.",
    ],
    [
      "LightBox Geocoding",
      "Parcel-level address geocoding",
      STATUS("DEFER", "gray"),
      "Mapbox covers current load.",
    ],
  ]),

  invHeader("🟣", "AI Inference & Research"),
  TABLE([
    ["Source", "What we get", "Status", "Plan / brain-platform table"],
    [
      "Anthropic API (Opus 4.7, Sonnet 4.6, Haiku 4.5)",
      "Brain narrative renders + corridor character + web_search_20250305",
      STATUS("OWN", "green"),
      "refinery/agents/, refinery/render/speaker.mts",
    ],
    [
      "Perplexity API",
      "Live web research",
      STATUS("DEFER", "gray"),
      "Anthropic web_search covers corridor-grounded use case.",
    ],
    [
      "Firecrawl + Spider",
      "HTML scraping (Firecrawl primary, Spider fallback)",
      STATUS("OWN", "green"),
      "ingest/lib/extract_client.py — rule locked PR #48",
    ],
  ]),

  invHeader("⚪", "Deferred (designed in premise, not required for brain-platform yet)"),
  TABLE([
    ["Source", "Trigger to build"],
    [
      "BLS OES — Occupational employment + wage stats",
      "Build when asset-management / lender voice ships",
    ],
    [
      "NPI Registry — Healthcare provider density",
      "Build when healthcare-adjacent brain materializes",
    ],
    ["EPA ECHO (curated)", "Pair with env-swfl extension"],
    ["SWFWMD ERP", "Build when builders-edge voice ships (Phase 2)"],
    ["FL DOR Tax Rolls", "Pair with properties-lee-value extension"],
    ["FL BEAD (broadband)", "Candidate for modernization-velocity card"],
  ]),

  DIVIDER(),

  CALLOUT(
    "📊",
    "blue_background",
    T("Summary: ", { bold: true }),
    T(
      "brain-platform has full ownership of 20 sources. 1 PREMISE-DEP (tourism-tdt). 12 NEED items mapped to future brain consumers. 9 DEFER. ",
    ),
    T(
      "Self-sufficiency from premise-engine = 1 pipeline + 1 source-connector edit + 1 SESSION_LOG entry.",
      { bold: true },
    ),
  ),
];

// ──────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function appendBlocks(pageId, blocks) {
  for (const batch of chunk(blocks, 90)) {
    await api("PATCH", `/blocks/${pageId}/children`, { children: batch });
  }
}

async function wipeChildren(pageId) {
  console.log(`[wipe] listing children of ${pageId}`);
  let next,
    archived = 0;
  do {
    const q = next ? `?start_cursor=${next}&page_size=100` : `?page_size=100`;
    const list = await api("GET", `/blocks/${pageId}/children${q}`);
    for (const b of list.results) {
      try {
        await api("DELETE", `/blocks/${b.id}`);
        archived++;
      } catch (e) {
        console.log(`  skip ${b.id} (${b.type}): ${e.message.slice(0, 80)}`);
      }
    }
    next = list.next_cursor;
  } while (next);
  console.log(`[wipe] archived ${archived} blocks`);
}

async function createChild(parentId, title, icon, blocks) {
  const body = {
    parent: { page_id: parentId },
    icon: { type: "emoji", emoji: icon },
    cover: { type: "external", external: { url: COVER_URL } },
    properties: {
      title: { title: [{ type: "text", text: { content: title } }] },
    },
    children: blocks.slice(0, 90),
  };
  let created;
  try {
    created = await api("POST", "/pages", body);
  } catch (e) {
    if (String(e.message).includes("cover")) {
      console.log(`  [retry without cover] ${title}`);
      delete body.cover;
      created = await api("POST", "/pages", body);
    } else {
      throw e;
    }
  }
  if (blocks.length > 90) await appendBlocks(created.id, blocks.slice(90));
  return created;
}

(async () => {
  console.log("=== Big Bird's Brain → Latest Sync rebuild (v2) ===");

  await wipeChildren(LB_PAGE);

  // Update hub page metadata
  try {
    await api("PATCH", `/pages/${LB_PAGE}`, {
      icon: { type: "emoji", emoji: "🦅" },
      cover: { type: "external", external: { url: COVER_URL } },
      properties: {
        title: {
          title: [
            {
              type: "text",
              text: { content: `🦅 Latest Sync — Big Bird's Brain (${TODAY})` },
            },
          ],
        },
      },
    });
  } catch (e) {
    if (String(e.message).includes("cover")) {
      await api("PATCH", `/pages/${LB_PAGE}`, {
        icon: { type: "emoji", emoji: "🦅" },
        properties: {
          title: {
            title: [
              {
                type: "text",
                text: {
                  content: `🦅 Latest Sync — Big Bird's Brain (${TODAY})`,
                },
              },
            ],
          },
        },
      });
    } else {
      throw e;
    }
  }

  // Create children FIRST so hub bookmarks can link to them
  const audit = await createChild(LB_PAGE, "Project Audit — 2026-05-27", "📋", auditBlocks());
  console.log("[ok] audit:", audit.url);
  const roadmap = await createChild(LB_PAGE, "Roadmap — NEXT / NEAR / LONG", "🗺️", roadmapBlocks());
  console.log("[ok] roadmap:", roadmap.url);
  const premise = await createChild(
    LB_PAGE,
    "Premise Data Replacement Plan",
    "🛠",
    premiseBlocks(),
  );
  console.log("[ok] premise:", premise.url);
  const inv = await createChild(LB_PAGE, "Data Sources Inventory", "📊", inventoryBlocks());
  console.log("[ok] inventory:", inv.url);

  // Now append hub content with bookmark cards pointing to children
  await appendBlocks(
    LB_PAGE,
    hubBlocks({
      audit: audit.url,
      roadmap: roadmap.url,
      premise: premise.url,
      inv: inv.url,
    }),
  );
  console.log("[ok] hub rebuilt with child bookmarks");

  console.log("\n=== DONE ===");
  console.log("Hub: https://www.notion.so/" + LB_PAGE.replace(/-/g, ""));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
