# Plan: Significance-Weighted Project AI Context + Lazy Refresh + Qualitative Event Intelligence

## Context

Three layered problems discovered from the screenshot (AI said "new data landed" then couldn't see it):

1. **Immediate bug** — `briefcaseDigest` sends only `[kind] title`, no values. `ProjectPageContext` has `freshnessToken` (date string) but never signals that freshness *changed since last visit*. The AI has no idea what the filed metrics actually say or that anything is new.

2. **Significance gap** — `freshnessChangedSinceSeen` fires on ANY brain update, even a rounding-level change. Every refresh produces the same vague nudge: "new data landed." A 0.05% listing count shift fires the same signal as a 50bps fed rate cut. Users will tune it out.

3. **Lazy refresh** — Items are intentional snapshots (correct per product decision). They should refresh *on access* (project open or email send), not on every brain rebuild. Lazy refresh is currently impossible because metric items don't store the grain/scope needed to re-fetch — only `report_id`, `label`, and optional `metric_slug`.

4. **Qualitative event gap** (added 2026-06-18) — The system only tracks numeric brain data changes. It is blind to real-world events that could dwarf any metric shift: a Walmart opening a mile from a strip mall project, a McDonald's closing, a new hospital breaking ground. These aren't numbers — they're signals. And if we're sending a user a notification, the AI needs to know about it too.

---

---

## Phase 0 — The Unified Project Intelligence Root

> **The core problem this solves:** Right now the AI assembles a project view from disconnected sources — briefcase digest (items), freshnessToken (data age), branding from a separate API call, external events not wired at all. Any one of those can be stale or missing. The AI references a name the user changed, uses old branding, doesn't know a deliverable just went out. It looks uninformed. That's the product killer.

**The root:** A single `project_activity` table — append-only log of everything significant that happens to a project. User action, system event, external signal — all go here. The AI always reads from one place. One briefing. One source of truth.

**The rule:** If it's worth the user knowing, it's worth the AI knowing. If the AI should bring it up unprompted, it logs here. If it's too noisy to log, it's too noisy to surface to either.

---

### 0A. project_activity table

**Migration:** `docs/sql/20260619_project_activity.sql`

```sql
CREATE TABLE IF NOT EXISTS project_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  activity_type text NOT NULL,      -- see taxonomy below
  actor         text NOT NULL,      -- "user" | "system" | "ai" | "external"
  summary       text NOT NULL,      -- pre-written for AI: "Branding updated: agent is now 'Jane Smith, Keller Williams'"
  detail        jsonb,              -- structured payload (old/new values, entity names, scores, etc.)
  significance  smallint NOT NULL DEFAULT 5,  -- 1 (noise) → 10 (critical); gate for AI context cap
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_activity_project_id
  ON project_activity(project_id, significance DESC, created_at DESC);
```

**Activity type taxonomy** — every significant action has a type:

| activity_type          | actor    | significance | example summary |
|-----------------------|----------|--------------|-----------------|
| `branding_changed`    | user     | 9            | "Branding updated: agent is now 'Jane Smith · Keller Williams Realty'" |
| `project_renamed`     | user     | 8            | "Project renamed to 'Fort Myers Beach Mixed-Use'" |
| `scope_changed`       | user     | 8            | "Project ZIP changed to 33931 (Fort Myers Beach)" |
| `item_filed`          | user     | 5            | "Filed: median sale price -3.5% YoY" |
| `item_refreshed`      | system   | 4            | "3 metrics refreshed with current brain data (as of 2026-06-18)" |
| `metric_moved`        | system   | 7            | "ALERT: active listings dropped 18% since last visit" |
| `deliverable_built`   | user     | 6            | "Email deliverable built: 'June Market Update'" |
| `email_sent`          | system   | 7            | "Blast sent to 14 contacts (2026-06-18)" |
| `external_event`      | external | varies       | "Walmart permit filed 1.1mi N (score: 15)" |
| `news_clipped`        | user     | 8            | "User clipped: 'McDonald's closes Colonial Blvd location'" |
| `mcp_connected`       | user     | 5            | "MCP connected to SWFL brain" |
| `project_created`     | user     | 10           | "Project created at ZIP 33931 (Fort Myers Beach)" |

**What does NOT log here:** individual brain rebuilds (too frequent), session opens, every mouse click. Signal, not exhaust.

---

### 0B. Branding is always live — never snapshot

**The branding problem:** The AI currently sees branding from whatever was last baked into the context at page load. If the user updates their agent name between sessions, the AI uses the old name until a full reload happens. That's how the AI references the wrong agent on a deliverable.

**Fix:** `describeProject()` in `lib/chat/page-context.ts` always re-reads current branding from the project's `branding` JSONB column (already on the `projects` table — no new column). Never cache branding in the page context snapshot. It's a direct DB read, small, fast.

Branding fields exposed to AI at every message:
```
Agent: Jane Smith
Brokerage: Keller Williams Realty Naples
License: BK3123456
```

Any write to `projects.branding` (via `PATCH /api/projects/[id]` or `PATCH /api/user/brand`) writes a `branding_changed` activity row immediately. The AI sees "Branding updated: agent is now 'Jane Smith · Keller Williams'" on the NEXT message — zero lag.

---

### 0C. Project state document — what the AI receives

**New file:** `lib/project/project-state.ts`

Assembles the canonical AI briefing from all sources. Called once per request in `projectPageContextForPath()`. Replaces the ad-hoc string assembly that currently happens across multiple files.

```typescript
interface ProjectStateDocument {
  // Identity (always live — never snapshot)
  project_name: string;
  location: string;           // "Fort Myers Beach · ZIP 33931 · Lee County"
  project_type: string;       // user-set | AI-inferred | "general project"
  branding: {
    agent_name: string | null;
    brokerage: string | null;
    license: string | null;
  };

  // Filed data summary (from briefcaseDigest — with values, Phase 1A)
  filed_items: string;        // "[metric] Median sale price: -3.5% YoY..."

  // What changed since last visit (top 3, Phase 2)
  significant_changes: string[];  // ["Active listings dropped 18% since last visit"]

  // Recent project activity (top 5 by significance, last 30 days)
  recent_activity: string[];  // ["Branding updated 2 days ago", "Email blast sent to 14 contacts"]

  // Nearby events the AI should know about (top 3 scored, Phase 4)
  nearby_events: string[];    // ["Walmart permit filed 1.1mi N — new supercenter"]

  // AI instruction block (static)
  instructions: string;
}
```

**Output as system prompt section:**
```
PROJECT: Fort Myers Beach Mixed-Use · ZIP 33931 · Lee County
AGENT: Jane Smith · Keller Williams Realty Naples · BK3123456
TYPE: mixed_use (AI-inferred)

FILED DATA:
[metric] Median sale price: -3.5% YoY (as of 2026-06-03)
[answer] Flood risk for 33931: "ZIP 33931 carries $30,074/yr AAL..."

CHANGES SINCE LAST VISIT:
• Active listings dropped 18% (was 312 → 256) — significant move
• Fed funds rate held at 5.25% (no change)

RECENT ACTIVITY:
• Branding updated 2 days ago (agent: Jane Smith · KW Naples)
• Email blast sent to 14 contacts (2026-06-15)
• User filed: flood risk answer (2026-06-12)

NEARBY EVENTS:
• Walmart permit filed 1.1mi N — $12M new supercenter (2026-06-10)
• McDonald's at Colonial Blvd: closed permanently (2026-06-01)

INSTRUCTIONS: Lead with the most significant change when the user opens a conversation.
When branding is set, always use the agent's name and brokerage in deliverable language.
Nearby events with "permit filed" are not confirmed — say "a permit was filed" not "it's opening."
When the user makes a change (renames project, updates branding, files an item), acknowledge it.
```

**This is the one document.** Not five separate context fields stitched together — one structured block that reads like a briefing. The AI knows everything in the order of importance. Nothing stale.

---

### 0D. What writes to project_activity

Every significant write endpoint adds a `project_activity` insert. This is the complete list of writers at launch:

| Endpoint / trigger | activity_type | significance |
|-------------------|---------------|--------------|
| `PATCH /api/projects/[id]` (name change) | `project_renamed` | 8 |
| `PATCH /api/projects/[id]` (ZIP/scope change) | `scope_changed` | 8 |
| `PATCH /api/projects/[id]` (branding) | `branding_changed` | 9 |
| `PATCH /api/user/brand` (global branding save) | `branding_changed` (all active projects) | 9 |
| `POST /api/projects/[id]/items` (file item) | `item_filed` | 5 |
| `POST /api/projects/[id]/refresh` (Phase 3B) | `item_refreshed` | 4 |
| `POST /api/deliverables` (build) | `deliverable_built` | 6 |
| `POST /api/deliverables/[id]/blast` (send) | `email_sent` | 7 |
| `project_events` insert (score ≥ ai_threshold) | `external_event` | derived from score |
| `POST /api/projects/[id]/clip-news` (Phase 5C) | `news_clipped` | 8 |
| Phase 2 significant change detected | `metric_moved` | 7 |
| `POST /api/projects` (create) | `project_created` | 10 |

**Rule:** The activity insert is a fire-and-forget `INSERT` in the same request — never in a background job, never async. If the primary write succeeds, the activity row succeeds. If the activity insert fails, log it but don't fail the primary request. The log is observability, not the transaction.

---

## Phase 1 — Fix the AI context gap (immediate, unblocks the screenshot bug)

### 1A. Briefcase digest with values

**File:** `lib/briefcase/briefcase-digest.ts`

Change `briefcaseDigest()` to include the actual value for metric items and the answer text (first 120 chars) for qa items:

```
[metric] SWFL median sale price: -3.5% YoY (as of 2026-06-03)
[answer] What is the flood risk for 33931? "ZIP 33931 carries $30,074/yr AAL..."
[chart] Price Trends
```

Cap total output at 1500 chars (was 1000). Non-value kinds (chart, note, source, file) keep the title-only format.

### 1B. freshnessChangedSinceSeen in context

**File:** `lib/chat/page-context.ts`

Add `freshnessIsNew?: boolean` to `ProjectPageContext`. Set it from `digest.freshnessChangedSinceSeen` in `projectPageContextForPath()`.

Update `describeProject()`:
- When `freshnessIsNew` is false: `"filed data as of 06/03/2026"` (current)
- When `freshnessIsNew` is true: `"NEW data since your last visit (as of 06/03/2026)"`

This alone fixes the screenshot: AI now knows data is new and can say "your metric shows -3.5% YoY — new data is in, want me to pull the current read?"

---

## Phase 2 — Significance registry + change evaluator

### 2A. Registry file

**New file:** `ingest/significance-registry.yaml`

One entry per brain output slug. Three threshold types:

```yaml
fed_funds_rate:
  threshold_type: absolute_change
  threshold: 0.25        # 25bps
  impact_weight: 10
  unit: "basis points"

median_sale_price_yoy:
  threshold_type: percent_change
  threshold: 3.0
  impact_weight: 8

active_listings_count:
  threshold_type: percent_change
  threshold: 12.0
  impact_weight: 5

listing_status:
  threshold_type: state_change
  monitored_transitions: ["active→pending", "pending→sold", "pending→back_to_active"]
  impact_weight: 9

_default:                # catch-all for unregistered slugs
  threshold_type: percent_change
  threshold: 99999       # never fires — unregistered slugs are silent until registered
  impact_weight: 1
```

Populate with all current slugs from `refinery/vocab/brain-vocabulary.json` slug_index. Unregistered slugs default to silent (no false-positive noise).

### 2B. Change evaluator

**New file:** `lib/signals/change-evaluator.ts`

```typescript
interface SignificantChange {
  slug: string;
  label: string;
  previous_value: string;
  current_value: string;
  delta_description: string;   // "dropped 4.2% YoY" — pre-written for AI
  signal_strength: number;     // 0–1, where 1.0 = exactly at threshold
  impact_weight: number;       // from registry
  priority: number;            // signal_strength × impact_weight — sort key
}

evaluateChange(slug, prev, curr, registry): SignificantChange | null
```

Pure function — same inputs → same output, no DB, directly unit-testable.
- Numeric (percent/absolute): `signal_strength = |delta| / threshold` — returns null if < 1.0
- State change: returns signal if transition is in `monitored_transitions`
- `delta_description` is human-readable: "dropped 50bps" not "-0.5"

**New file:** `lib/signals/types.ts` — exports `SignificantChange` interface.

### 2C. Wire into ProjectDigest

**File:** `lib/project/digest.ts`

Add `significantChanges: SignificantChange[]` to `ProjectDigest`. Computed by:
1. For each metric item, look up its `metric_slug` (or fall back to label-match) in the registry
2. Compare `item.value` (the snapshot) vs. the current brain freshness token's implied value
3. Rank by `priority` desc, take top 5

Note: The comparison is between what's *filed* (snapshot) and what the *current brain holds*. This requires a lookup — see Phase 2D.

### 2D. Brain value lookup for comparison

**New file:** `lib/signals/brain-snapshot.ts`

Re-use the existing `lookupLakeFact(report_id, slug, zip?)` pattern from the reconcile lane. Batch-fetch current values for all metric slugs in a project's items. Cache per-request (don't re-fetch for same slug within one project open).

### 2E. Update prompt engine + context

**File:** `lib/project/prompt-engine.ts`

Replace the vague freshData nudge:
```
// OLD:
"New data landed for SWFL Prices (as of 06/03/2026) — want it in your report?"

// NEW (when significantChanges exists):
"Median sale prices dropped 4.2% YoY since your last visit — want to update your report?"
// or if multiple: "2 of your filed metrics moved significantly — median prices and listing inventory"
```

**File:** `lib/chat/page-context.ts`

Add `significantChanges: SignificantChange[]` to `ProjectPageContext`. Cap at top 3. The AI receives:
> "NEW since your last visit: median sale price dropped 4.2% YoY (was -3.5%), active listings up 14% (was 312→356)"

**File:** `app/api/welcome/chat/route.ts` — `ANALYST_SYSTEM`

Add one sentence: "When the context shows significant changes, lead with what changed and by how much before asking what the user wants to do."

---

## Phase 3 — Lazy refresh on access + email send trigger

### 3A. Schema addition (prerequisite)

**File:** `lib/project/items.ts`

Add two optional fields to the `metric` and `qa` item schemas — generic grain, not zip-only:
```typescript
scope_kind: z.enum(["zip","county","city","state","national","msa"]).optional(),
scope_value: z.string().optional(),  // "33931" | "lee" | "fort-myers-beach" | "florida" | "us"
```

Examples by grain:
- ZIP: `scope_kind:"zip"`, `scope_value:"33931"`
- County: `scope_kind:"county"`, `scope_value:"lee"` (or FIPS "12071")
- City/place: `scope_kind:"city"`, `scope_value:"fort-myers-beach"`
- State: `scope_kind:"state"`, `scope_value:"florida"`
- National: `scope_kind:"national"`, `scope_value:"us"` (fed rate, ZHVI national, etc.)

This matches the existing `ProjectDigest.scope` shape (`{ zip?, place?, topic? }`) and `resolveLocation`'s grain routing — no new grain concepts, just attaching the scope at filing time.

Non-breaking — existing items without scope fields fall back to headline (no-scope) brain fetch.

**Migration:** `docs/sql/20260619_project_items_scope.sql` — two `ALTER TABLE project_items ADD COLUMN IF NOT EXISTS` for `scope_kind text` and `scope_value text` (JSONB payload addition, idempotent).

### 3B. Refresh-on-access logic

**New file:** `lib/project/refresh-on-access.ts`

```typescript
// Called when a project page loads and significantChanges.length > 0
// Returns items that can be auto-refreshed (have scope or report_id for headline)
async function getRefreshableItems(project, significantChanges): RefreshCandidate[]
```

On project open (client-side, after first render):
- If `significantChanges.length > 0` AND user hasn't dismissed → show specific nudge chip
- Chip click → calls `/api/projects/[id]/refresh` with the item ids to refresh
- Server fetches current brain value for each item (using `scope_kind`+`scope_value` if present, else headline)
- Updates item `value` + `freshness_token` in Supabase in place (same item id, no re-filing)
- No LLM call — pure data fetch + write

### 3C. Pre-send data verification + fallback sourcing (email blast)

> **Research basis (2026-06-19 web research):**
> - No major ESP (Mailchimp, Klaviyo, HubSpot, Marketo) has a native data-freshness gate — this is custom work at the integration layer.
> - Data journalism standard: two independent sources + 3σ anomaly detection (Data Journalism Handbook). "2 crawlai sources agree" is stronger than any published standard.
> - AI confirmation accuracy: ~87.3% end-to-end in the best published modular pipeline (OpenFactCheck, COLING 2025) — so AI-only confirmation is the lowest-confidence tier, not a substitute for crawl agreement.
> - Preflight timing: T-60min check → T-15min final gate (derived from Adobe Campaign preparation-phase pattern). Enough lead time for alert + human override before the send window.
> - Category-specific tolerances must be set empirically. Published stats: ±2–3σ from rolling mean for financial series; z≥10 for extreme outlier detection only. Derived reasonable defaults below.

**The problem:** A weekly email is scheduled for 10:00 UTC Monday. A brain rebuild failed silently at 06:00. At 10:00 the blast fires with figures that are 7 days stale. The user's client receives a rate that was superseded by a Fed decision on Thursday. One failed brain metric should never revert the entire email to frozen state — and we should know about the failure at 09:00, not 10:00.

**The fix: a tiered verification cron that fires before any scheduled blast.**

---

#### 3C-1. Data readiness check cron (T-60 before each scheduled send)

**New file:** `lib/email/data-readiness.ts`

A cron that fires 60 minutes before any `email_schedules` row whose `next_run_at` is within the next 75 minutes (75-min window catches scheduling drift). For each upcoming send:

1. Load the project's metric items
2. For each item: check if the brain's current freshness_token is newer than the item's snapshot
3. If brain is fresh → no action (3B's on-access refresh handles the rest)
4. If brain is stale/failed → enter the **verification ladder** for that metric

**Verification ladder (per stale metric item):**

```
TIER 1: 2 independent crawl4ai searches agree within tolerance
   → search "[metric label] [scope] [current month/year] site:*.gov OR site:freddiemac.com OR site:nar.realtor OR site:redfin.com OR site:zillow.com"
   → extract numeric value from each result
   → if both values within category tolerance → USE IT (source: "crawl_consensus")
   → write value + source URLs to a verification_result

TIER 2: 1 crawl4ai result + 1 Haiku confirmation
   → take the single crawl result
   → Haiku prompt: "Does this page confirm [metric label] for [scope] is approximately [value] as of [date]? Answer YES:[value] or NO."
   → if YES and value within tolerance → USE IT (source: "crawl_haiku")
   
TIER 3: 1 Sonnet verification (last resort — ~87% reliable)
   → Sonnet prompt: "What is the current [metric label] for [scope] as of [today]? Cite a reputable source (government data, major real estate platform, or financial institution). Return: value, source name, source URL, as-of date."
   → if within tolerance of last known value → USE IT (source: "sonnet_only")

TIER 4: Use last known value with staleness caveat
   → if the last known value is within max_stale_days for this category → USE IT with caveat
   → if too stale → FLAG for human review; do NOT send this metric; omit from email or replace with "Data currently unavailable"

ALERT: fire at any tier if the ladder runs (brain was stale) — Supabase insert into
  `data_readiness_alerts` table so the operator knows a substitution occurred.
```

---

#### 3C-2. Category-specific tolerances

**New file:** `ingest/data-verification-tolerances.yaml`

Determines when two sources "agree" and when a last-known value is too stale to use:

```yaml
# tolerance_pct: relative tolerance between two crawl values (% of value)
# tolerance_abs: absolute tolerance (for low-variance metrics like rates)
# max_stale_days: max age of last known value before we omit rather than substitute
# z_flag_threshold: z-score vs. 30-day rolling mean that triggers "implausible" flag

mortgage_rate:
  tolerance_abs: 0.15        # 0.15% — "6.80% vs 6.93% = acceptable; 6.80% vs 7.50% = reject"
  tolerance_pct: null
  max_stale_days: 14         # weekly publish cadence; 2 weeks = too stale
  z_flag_threshold: 3.0      # rate jumps >3σ are implausible without a Fed event

median_sale_price:
  tolerance_pct: 5.0         # ±5% relative — prices lag and vary by source methodology
  tolerance_abs: null
  max_stale_days: 45         # monthly publish cadence
  z_flag_threshold: 3.0

active_listings_count:
  tolerance_pct: 10.0        # ±10% — counts vary by scrape timing and de-dup logic
  tolerance_abs: null
  max_stale_days: 14
  z_flag_threshold: 3.0

days_on_market:
  tolerance_pct: 10.0
  tolerance_abs: null
  max_stale_days: 30
  z_flag_threshold: 3.0

unemployment_rate:
  tolerance_abs: 0.30        # BLS rounds to 1 decimal; 0.3% absolute is generous
  tolerance_pct: null
  max_stale_days: 45         # monthly BLS publish
  z_flag_threshold: 2.0

cap_rate:
  tolerance_abs: 0.25        # CRE cap rates in basis points — 25bp tolerance
  tolerance_pct: null
  max_stale_days: 90         # quarterly publish cadence
  z_flag_threshold: 2.5

flood_risk_aal:
  tolerance_pct: 5.0         # FEMA recalculates infrequently; small drift = methodology diff
  tolerance_abs: null
  max_stale_days: 365        # annual NFIP updates
  z_flag_threshold: null     # not a time-series; no rolling mean

_default:
  tolerance_pct: 10.0
  tolerance_abs: null
  max_stale_days: 30
  z_flag_threshold: 3.0
```

**Matching:** Each metric item's `metric_slug` (or label-match fallback) resolves to a tolerance entry. Unknown slugs use `_default`.

---

#### 3C-3. Verification sources (what crawl4ai searches)

**New file:** `lib/email/verification-sources.ts`

Returns a prioritized search query for a given metric slug + scope. Not a hardcoded list — a function that generates the right query for the metric:

```typescript
function verificationQuery(slug: string, scope: { zip?: string; place?: string }, asOf: Date): string {
  // mortgage_rate → "30-year fixed mortgage rate [month year] site:freddiemac.com OR site:bankrate.com OR site:mortgagenewsdaily.com"
  // median_sale_price + zip → "median home sale price [place] [month year] site:redfin.com OR site:zillow.com OR site:realtor.com"
  // unemployment_rate + county → "Lee County unemployment rate [month year] site:bls.gov"
  // active_listings → "homes for sale [place] [month year] site:redfin.com OR site:zillow.com"
}
```

Reputable source domain allowlist (not vendor-specific — any authoritative source):
- Government: `bls.gov`, `census.gov`, `hud.gov`, `federalreserve.gov`, `fhfa.gov`
- Real estate platforms: `redfin.com`, `zillow.com`, `realtor.com`, `costar.com`
- Financial: `freddiemac.com`, `bankrate.com`, `mortgagenewsdaily.com`, `wsj.com/market-data`
- Local news (SWFL): `news-press.com`, `naplesnews.com`, `bizjournals.com/southwest-florida`

Two crawl4ai searches using different queries from this list. Parsed with a lightweight numeric extraction regex (+ optional Haiku-assist for messy HTML).

---

#### 3C-4. Blast route integration

**File:** `app/api/deliverables/[id]/blast/route.ts`

Before `buildEmailDeliverableModel`:

```
1. Load project metric items + their scope
2. For each metric item:
   a. Check brain freshness (reuse refresh-on-access.ts lookupLakeFact pattern)
   b. If brain is fresh → use brain value (applyRefresh in-memory, don't persist here — 3B's cron handles the persistent update)
   c. If brain is stale → check `data_readiness_alerts` for a pre-computed verification result from the T-60 cron
      - If a verification result exists and is <90min old → use it
      - If no pre-computed result → run TIER 1 inline (fast; <3s per metric)
        * If TIER 1 succeeds → use crawl_consensus value
        * If TIER 1 fails → use last known value with staleness caveat in email footer
3. Patch `deliverable.items_snapshot` IN MEMORY with any refreshed values (do not persist the snapshot change — the deliverable remains a frozen historical record, but the SEND uses current figures)
4. Add a `data_freshness_note` to the email footer if any value came from a non-brain source:
   "Data for [Median Sale Price] sourced from Redfin as of [date] (our data pipeline was unavailable at send time)"
5. Log what happened to `data_readiness_alerts` regardless of outcome
```

**Never fail the send over a stale metric.** One metric being unavailable does not cancel the blast. The fallback ladder ensures something always goes out — and the footer note is honest about the source.

---

#### 3C-5. Alert table + operator visibility

**Migration:** `docs/sql/20260619_data_readiness_alerts.sql`

```sql
CREATE TABLE IF NOT EXISTS data_readiness_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  schedule_id     uuid,                     -- the email_schedule that triggered the check
  metric_slug     text NOT NULL,
  metric_label    text NOT NULL,
  scope_kind      text,
  scope_value     text,
  tier_used       text,                     -- "brain_fresh" | "web_consensus" | "web_single" | "model_only" | "last_known" | "omitted"
  value_used      text,
  source_urls     text[],                   -- web_search cited sources (web_consensus/web_single)
  snapshot_value  text,                     -- what the item had before this check
  within_tolerance boolean,
  alert_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,             -- null = still open / human hasn't acknowledged
  send_at         timestamptz              -- when the blast fired (null = cron check only, no send yet)
);
```

The `/ops` dashboard (swfldatagulf-ops repo) reads this table and surfaces a "Data readiness" card: green when all metrics were `brain_fresh`, amber when any used `crawl_*` or `last_known`, red when anything was `omitted`.

---

#### 3C-6. Files summary

| File | Change |
|------|--------|
| `lib/email/data-readiness.ts` | NEW — verification ladder (T-60 cron logic) |
| `lib/email/verification-sources.ts` | NEW — search query generator + source allowlist |
| `ingest/data-verification-tolerances.yaml` | NEW — per-slug tolerances |
| `docs/sql/20260619_data_readiness_alerts.sql` | NEW — alert table migration |
| `app/api/deliverables/[id]/blast/route.ts` | Add in-memory refresh + pre-computed result lookup before render |
| `app/api/cron/data-readiness/route.ts` | NEW — GHA/Vercel cron endpoint, fires T-60 before each upcoming send |
| `ingest/cadence_registry.yaml` | Append `data_readiness_preflight` cron entry |

---

## Phase 4 — Qualitative Event Intelligence

> **Research basis (2026-06-18 web research):**
> - Census Bureau retail tier standard: National (>10 states) / Regional (2-10 states) / Local (1 state) / Independent
> - Anchor tenant theory (Ariadne): anchors draw 5× more visitors than average store; an anchor closing cuts inline tenant footfall 8–25%; shadow anchors (outside the center, close enough to drive traffic) matter too
> - Trade area radii (Placer.ai / SiteSeer): 1–3 mile ring = standard neighborhood retail; 10-15 min drive time = primary trade area for neighborhood; 25–30 min = destination retail
> - Huff Gravity Model: attraction ∝ size / distance² — bigger brands at shorter distance = higher score
> - Alert fatigue (IBM/Palo Alto): aggregate low-fidelity events → one high-fidelity signal; context enrichment before surfacing; cooldown windows; human-in-loop for sensitive ops

The existing system tracks numeric data changes. Phase 4 adds a parallel track for **qualitative real-world events** — business openings, closings, new construction, zoning changes — matched to projects by radius and scored by brand significance before any notification or AI context injection fires.

**Design principle: scaffold now, wire sources as they arrive.** We don't have all data sources today. The schema, scoring engine, and injection logic ship now so that when a source lands (permits today; news crawl, Google Places delta, county filings later), it plugs in with zero schema change.

---

### 4A. Brand tier registry

**New file:** `ingest/brand-tier-registry.yaml`

Classifies known brands by tier (National, Regional, Local, Independent) and category. Used by the event significance evaluator (4C) to score an event's raw impact weight.

```yaml
# Tier 1 — National Anchors (>10 states, box/hypermarket)
# Opening: weight 10 · Closing: weight 10 · Shadow: weight 8
walmart:          { tier: 1, category: general_merchandise, aliases: ["Walmart Supercenter", "Sam's Club"] }
target:           { tier: 1, category: general_merchandise }
home_depot:       { tier: 1, category: home_improvement }
lowes:            { tier: 1, category: home_improvement }
costco:           { tier: 1, category: warehouse_club }
publix:           { tier: 1, category: grocery }       # dominant in FL — regional by census but anchor-tier here
aldi:             { tier: 1, category: grocery }

# Tier 2 — National Chain / QSR / Specialty (>10 states, inline size)
# Opening: weight 8 · Closing: weight 7
mcdonalds:        { tier: 2, category: qsr, aliases: ["McDonald's"] }
starbucks:        { tier: 2, category: qsr }
chick_fil_a:      { tier: 2, category: qsr, aliases: ["Chick-fil-A"] }
dollar_general:   { tier: 2, category: discount }
cvs:              { tier: 2, category: pharmacy }
walgreens:        { tier: 2, category: pharmacy }
7eleven:          { tier: 2, category: convenience, aliases: ["7-Eleven"] }
subway:           { tier: 2, category: qsr }
wawa:             { tier: 2, category: convenience }   # strong FL presence
# ... extend as brands appear in permit/news data

# Tier 3 — Regional Chain (2-10 states or strong regional footprint)
# Opening: weight 5 · Closing: weight 4
# (populate as local SWFL data surfaces them)

# Tier 4 — Local multi-location (1 state, >1 location)
# Opening: weight 2 · Closing: weight 2
# Default for any known business not in tiers 1-3

# Tier 5 — Single-location independent
# Default: weight 0 (SILENT — no notification, no AI injection)
# Override: op-editor can promote to tier 4 if warranted

_unclassified:
  tier: 5
  weight_open: 0
  weight_close: 0
```

**Maintainability:** The operator adds entries as real event data surfaces. The system never needs a complete database upfront — unclassified entities default to silent (tier 5), so the registry is an allowlist, not a blocklist.

---

### 4B. Radius tier config per project type

**New file:** `ingest/event-radius-config.yaml`

Different project types care about different radii. A strip mall cares about a 1-mile Walmart more than a 5-mile one. A mixed-use high-rise may not care about a QSR at all.

```yaml
# radius_bands: list of { radius_miles, weight_multiplier }
# The final event score = brand_weight × weight_multiplier for the smallest band the event falls in.
# If event is outside all bands → score = 0 → silent.

strip_mall:
  radius_bands:
    - { radius_miles: 0.25, weight_multiplier: 2.0 }   # same block / parking lot
    - { radius_miles: 1.0,  weight_multiplier: 1.5 }   # walk / parking-lot spillover
    - { radius_miles: 3.0,  weight_multiplier: 1.0 }   # primary trade area
    - { radius_miles: 5.0,  weight_multiplier: 0.5 }   # secondary — tier 1 only fires here
  min_score_to_notify: 6      # brand_weight × multiplier must exceed this
  min_score_for_ai_context: 4 # lower bar — AI gets more than user notifications

mixed_use:
  radius_bands:
    - { radius_miles: 0.25, weight_multiplier: 2.0 }
    - { radius_miles: 0.5,  weight_multiplier: 1.5 }
    - { radius_miles: 1.0,  weight_multiplier: 0.8 }
  min_score_to_notify: 7
  min_score_for_ai_context: 5

office:
  radius_bands:
    - { radius_miles: 0.5,  weight_multiplier: 1.5 }
    - { radius_miles: 1.0,  weight_multiplier: 1.0 }
  min_score_to_notify: 8
  min_score_for_ai_context: 6

residential_development:
  radius_bands:
    - { radius_miles: 0.5,  weight_multiplier: 2.0 }
    - { radius_miles: 1.0,  weight_multiplier: 1.5 }
    - { radius_miles: 3.0,  weight_multiplier: 1.0 }
  min_score_to_notify: 6
  min_score_for_ai_context: 4

industrial:
  radius_bands:
    - { radius_miles: 1.0,  weight_multiplier: 1.5 }
    - { radius_miles: 3.0,  weight_multiplier: 1.0 }
    - { radius_miles: 5.0,  weight_multiplier: 0.5 }
  min_score_to_notify: 8
  min_score_for_ai_context: 6

_default:   # catch-all for projects with no project_type set or inferred
  radius_bands:
    - { radius_miles: 1.0,  weight_multiplier: 1.0 }
    - { radius_miles: 3.0,  weight_multiplier: 0.5 }
  min_score_to_notify: 8
  min_score_for_ai_context: 5
```

**Project type is optional — never required, AI-inferred over time:**

`project_type` does not need to be filled out. The field is `nullable text` on the projects table. Resolution order:
1. `projects.project_type` if user explicitly set it (e.g., during import or via workspace settings pill)
2. `projects.derived_project_type` — AI-inferred from the project's name, location, filed items, and brief. Stored once inferred so it doesn't re-run every load.
3. `_default` config if neither is set

**AI inference of project type** runs passively on first project_events match attempt when both type fields are null. A lightweight classification call (Haiku) reads the project name + ZIP + up to 5 filed item labels and returns one of: `strip_mall | mixed_use | office | residential_development | industrial | _default`. Result is written to `projects.derived_project_type` and doesn't run again unless the project name/location changes. The inference is never required — if it fails or the project has too little data, `_default` applies with no error.

**Score formula:**
```
final_score = brand_weight(tier, event_type) × radius_band_multiplier(distance_miles, project_type)
notify_user  = final_score >= config.min_score_to_notify
inject_ai    = final_score >= config.min_score_for_ai_context
```

The example from the prompt:
- Walmart (tier 1, weight 10) opening 1 mile from a strip mall → 10 × 1.5 = **15** → notify + inject AI ✓
- McDonald's (tier 2, weight 8) closing 1 mile → 8 × 1.5 = **12** → notify + inject AI ✓
- Carrie's Cheap Clothes (tier 5, weight 0) opening 2 blocks away → **0** → silent ✓

---

### 4C. Qualitative event significance evaluator

**New file:** `lib/signals/event-evaluator.ts`

Pure function — no DB, no side effects, fully unit-testable.

```typescript
interface QualEvent {
  entity_name: string;           // "Walmart", "McDonald's", "Lee County Building Dept"
  entity_brand_key?: string;     // normalized lookup key into brand-tier-registry
  event_type: "opening" | "closing" | "permit_filed" | "construction_start"
            | "zoning_change" | "anchor_announced" | "business_news";
  lat: number;
  lng: number;
  event_date: string;            // ISO
  source: "permits_swfl" | "news_crawl" | "google_places_delta" | "operator_manual";
  headline?: string;             // short description for AI context
  source_url?: string;
}

interface ScoredEvent extends QualEvent {
  brand_tier: number;            // 1-5, from registry (5 = unclassified)
  brand_weight: number;          // from registry
  distance_miles: number;        // computed from project lat/lng
  radius_band: string;           // "0.25mi" | "1mi" | "3mi" | "5mi" | "outside"
  final_score: number;           // brand_weight × radius_multiplier
  notify_user: boolean;
  inject_ai: boolean;
  ai_summary: string;            // pre-written for AI context, e.g. "Walmart (1.1 mi, opening 2026-07-01)"
  suppressed_reason?: string;    // why it was gated: "score_below_threshold" | "cooldown" | "tier_5"
}

scoreEvent(event: QualEvent, project: { lat, lng, project_type }, registries): ScoredEvent
```

**Event type weights** (applied to the brand_weight from the registry):

| event_type           | multiplier | notes |
|---------------------|------------|-------|
| opening             | 1.0        | confirmed open — full weight |
| anchor_announced    | 0.9        | permit + news corroboration before open |
| construction_start  | 0.8        | physical start — more certain than announced |
| closing             | 1.1        | slightly higher — downside risk more urgent |
| zoning_change       | 0.7        | depends on use change |
| business_news       | 0.5        | catch-all; user-clipped from news bar (see Phase 5) |
| permit_filed        | _see below_ | value + permit type determine weight |

**Permit weighting — two-axis score (not a flat multiplier):**

Permits are leading indicators with huge variance. A $10M new-construction permit for a Walmart is a near-certainty signal. A $12k roof repair permit for a McDonald's is noise. The flat 0.6 multiplier can't distinguish them — use value + type axes instead:

```
permit_score = brand_weight
             × permit_type_multiplier
             × permit_value_multiplier
             × radius_band_multiplier
```

**Permit type multiplier:**

| permit_type (from permits_swfl) | multiplier |
|--------------------------------|------------|
| new_construction               | 1.0        |
| addition                       | 0.8        |
| alteration / tenant_buildout   | 0.5        |
| renovation / remodel           | 0.3        |
| repair / maintenance           | 0.1 (effectively silent for all but tier 1) |

**Permit value multiplier** (log-scaled on `declared_value_usd`):

| declared_value_usd | multiplier |
|-------------------|------------|
| < $50k            | 0.2        |
| $50k – $249k      | 0.5        |
| $250k – $999k     | 0.7        |
| $1M – $4.9M       | 0.9        |
| ≥ $5M             | 1.0        |
| null / unknown    | 0.4        | (assume medium; don't fully silence)

**Example:** Walmart ($10M new construction, 1 mi from strip mall) → `10 × 1.0 × 1.0 × 1.5 = 15` — notify + inject AI. McDonald's ($80k renovation, 1 mi) → `8 × 0.3 × 0.5 × 1.5 = 1.8` — silent. McDonald's ($2M buildout, 1 mi) → `8 × 0.5 × 0.9 × 1.5 = 5.4` — inject AI only (below notify threshold of 6).

**Why AI gets a lower threshold than user notifications:**
AI context injection is free to add and cheap to ignore. A user notification that fires unnecessarily trains the user to ignore all notifications. So inject into AI context liberally (it can decide relevance during conversation), but gate user notifications strictly.

---

### 4D. Project event queue (DB schema)

**Migration:** `docs/sql/20260619_project_events.sql`

```sql
CREATE TABLE IF NOT EXISTS project_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_name     text NOT NULL,
  entity_brand_key text,                -- FK-like into brand-tier-registry (nullable)
  event_type      text NOT NULL,        -- opening|closing|permit_filed|construction_start|zoning_change|anchor_announced|business_news
  event_date      date NOT NULL,
  lat             numeric,
  lng             numeric,
  distance_miles  numeric,
  brand_tier      smallint,
  brand_weight    numeric,
  final_score     numeric,
  radius_band     text,
  notify_user     boolean NOT NULL DEFAULT false,
  inject_ai       boolean NOT NULL DEFAULT false,
  ai_summary      text,                 -- pre-written for AI context injection
  headline        text,
  source          text NOT NULL,        -- permits_swfl|news_crawl|google_places_delta|operator_manual
  source_url      text,
  suppressed_reason text,
  notified_at     timestamptz,          -- null = not yet notified
  injected_at     timestamptz,          -- null = not yet in AI context
  dismissed_at    timestamptz,          -- user dismissed
  cooldown_until  timestamptz,          -- don't re-notify about same entity before this
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_events_project_id ON project_events(project_id);
CREATE INDEX IF NOT EXISTS project_events_notify ON project_events(project_id, notify_user, notified_at)
  WHERE notify_user = true AND notified_at IS NULL;
CREATE INDEX IF NOT EXISTS project_events_ai ON project_events(project_id, inject_ai, injected_at)
  WHERE inject_ai = true;
```

**Cooldown rule:** Before inserting a new event, check if an event for the same `(project_id, entity_brand_key, event_type)` has `cooldown_until > now()`. If yes, upsert with suppressed_reason = "cooldown" — don't fire notification or AI injection again. Default cooldown: 30 days for closings, 90 days for openings (stable facts; no need to re-surface).

---

### 4E. Event data sources (current + future scaffold)

**What we have today:**

| Source | Coverage | Event types available |
|--------|----------|----------------------|
| `permits_swfl` | Lee + Collier county permits | `permit_filed`, `construction_start` (from status field) |

**What `permits_swfl` gives us right now:**
- `contractor_name`, `work_description` contain brand names ("MCDONALDS REMODEL", "WALMART EXPANSION")
- `declared_value_usd` + `permit_type` feed the two-axis permit weighting (4C)
- `site_lat` / `site_lng` exist for proximity matching — but geocoding is incomplete

**Geocoding gaps → route through the ZIP machine:**

When a permit row has no `site_lat`/`site_lng` but has a ZIP code (from `site_address` or a `zip_code` column), resolve to the ZIP centroid from `fixtures/swfl-zip-county.json`. This gives ±0.3–0.5 mile precision — good enough for 1-mile+ radius matching, not for 0.25-mile same-block matching (don't use centroid for the 0.25mi band; mark the result `geocode_source: "zip_centroid"` so the evaluator can skip tight-band scoring).

This is a general pattern. **Any pipeline that needs lat/lng and has a ZIP should run through the ZIP machine first before failing silently or skipping rows.** Other candidates: news crawl items with a mentioned address, operator-manual events entered by address, future Google Places delta events.

```typescript
// lib/geo/zip-centroid.ts (scaffold — one function)
function zipToCentroid(zip: string): { lat: number; lng: number; source: "zip_centroid" } | null
// reads fixtures/swfl-zip-county.json; returns null if ZIP not in SWFL coverage
```

**Permit-to-event extraction rule (scaffold, not implemented yet):**
```typescript
// lib/signals/permit-event-extractor.ts (scaffold)
// Runs on new permits_swfl rows; emits QualEvent if brand detected
function extractEventFromPermit(permit): QualEvent | null {
  // 1. Search contractor_name + work_description against brand-tier-registry aliases
  // 2. If tier 1 or 2 match AND declared_value_usd > 50000 → emit event
  // 3. event_type: permit_filed (if status=open) or construction_start (if status=issued/active)
  // 4. source: "permits_swfl"
}
```

**Planned future sources (scaffold slots in schema, no code yet):**

| Source | How to wire | Notes |
|--------|-------------|-------|
| Google Places delta | Periodic scrape of Places API for ZIP → detect open/closed changes | Needs Places API key; changes are reliable |
| News crawl (Spider/crawl4ai) | Keyword crawl of local news for ZIP + brand name | `source: "news_crawl"` — lower confidence, use event_type `business_news` |
| County commercial permit portals | Already have Lee Accela via crawl4ai; extend to detect brand names | Extension of existing pipeline |
| Operator manual entry | `/api/projects/[id]/events` POST — operator adds an event directly | Immediate AI context injection + notification |
| CoStar / LoopNet delta | Future paid data source; same schema | `source: "costar_delta"` |

**The schema is the scaffold.** Every future source speaks `QualEvent` → `scoreEvent()` → `project_events` table. No schema changes required when a new source lands.

---

### 4F. AI context injection

**File:** `lib/chat/page-context.ts`

Add `activeEvents: ScoredEventSummary[]` to `ProjectPageContext`:

```typescript
interface ScoredEventSummary {
  ai_summary: string;       // "Walmart (1.1 mi): opening 2026-07-01 [permits_swfl]"
  event_type: string;
  event_date: string;
  brand_tier: number;
  final_score: number;
}
```

Fetch from `project_events` where `inject_ai = true AND dismissed_at IS NULL` ordered by `final_score desc` — cap at **3 events** in context (more events = more distraction; the AI can mention it received 3, not all 7).

**File:** `lib/project/prompt-engine.ts`

When `activeEvents.length > 0`, inject into the system prompt section:

```
NEARBY EVENTS (scored by proximity + brand significance):
• Walmart (1.1 mi N): permit filed 2026-06-10 for new supercenter [score: 15/20, source: permits_swfl]
• McDonald's (0.8 mi): closed permanently 2026-06-01 [score: 12/20, source: operator_manual]
```

**Instruction to AI (added to `ANALYST_SYSTEM` / project chat system prompt):**
> "When NEARBY EVENTS are listed, weave the most significant ones naturally into your analysis — e.g., 'A Walmart supercenter permit just filed 1.1 miles north; that's a potential traffic driver for the strip mall' or 'The McDonald's closure 0.8 miles away removes a traffic anchor — worth noting in the report.' Do not list all events mechanically; lead with the highest-score event and mention others only if directly relevant to the user's question."

**What the AI must NOT do:**
- Mention events that were dismissed by the user
- Surface events from the project_events table that have `final_score < min_score_for_ai_context`
- Treat a `permit_filed` event with the same certainty as an `opening` event — the AI should hedge: "a permit was filed" ≠ "it's opening"

---

### 4G. Notification gating rules

**Anti-fatigue rules (baked into the scoring + DB layer, not an afterthought):**

1. **Score gate:** `final_score >= min_score_to_notify` (per project type). Anything below is stored in `project_events` with `notify_user = false` — it exists in the record but never fires.

2. **Tier 5 silence:** Unclassified or single-location independent businesses never notify and never inject into AI context. The brand-tier-registry is an allowlist — if it's not in there, it's silent.

3. **Cooldown window:** Same entity + same event type within cooldown period → upsert, no re-fire. An opening permit for Walmart fires once; a follow-up article about the same Walmart doesn't fire again for 90 days.

4. **Event type confidence discount:** `permit_filed` at 0.6× means even a Walmart permit (10 × 0.6 = 6) only clears the `min_score_for_ai_context` bar on a strip mall (≥4), but doesn't hit `min_score_to_notify` (≥6) — so the AI knows about it but the user isn't pinged until construction starts or opening is confirmed.

5. **Batching:** Never fire more than 1 user notification per project per 48 hours. If 3 events score above threshold in the same window, batch them: "2 significant nearby events since your last visit." The `notified_at` timestamp on the first event marks the window.

6. **User dismissal:** `dismissed_at` on the event row — dismissed events are excluded from AI context on the next load. The AI should not keep bringing up what the user said they know about.

7. **Stale event cutoff:** Events older than 180 days don't inject into AI context (they're history, not current intelligence). They stay in the DB for record-keeping.

---

## Build order (all phases)

0. **Phase 0A** — `docs/sql/20260619_project_activity.sql` migration — apply to prod first (all other phases write here)
0. **Phase 0B** — branding live-read in `describeProject()` (one-line fix; stops the "wrong agent name" embarrassment immediately)
0. **Phase 0C** — `lib/project/project-state.ts` — assembles the unified state document; replaces ad-hoc context assembly in `lib/chat/page-context.ts`
0. **Phase 0D** — wire activity inserts into all write endpoints (list in 0D above)
1. **Phase 1A + 1B** — briefcase values + `freshnessIsNew` signal → fixes screenshot bug immediately. No new files, no schema change.
2. **Phase 2A** — `ingest/significance-registry.yaml` populated from vocab slug_index. No code yet.
3. **Phase 2B** — `lib/signals/change-evaluator.ts` + `lib/signals/types.ts` — pure, fully unit-testable before wiring anything
4. **Phase 2C + 2D** — wire into `ProjectDigest` (requires brain lookup; add cache guard)
5. **Phase 2E** — prompt engine + `ProjectPageContext` + `ANALYST_SYSTEM` update
6. **Phase 3A** — `items.ts` scope fields (SHIPPED `e4d927d`). Non-breaking — JSONB, no DDL.
7. **Phase 3B** — `lib/project/refresh-on-access.ts` + `POST /api/projects/[id]/refresh` + ProjectWorkspace nudge chip (SHIPPED `e4d927d`).
8. **Phase 3C** — Data readiness verification ladder before email blast. Build order:
   - `ingest/data-verification-tolerances.yaml` (data file, zero risk)
   - `docs/sql/20260619_data_readiness_alerts.sql` migration → apply to prod
   - `lib/email/verification-sources.ts` — query generator + source allowlist (pure)
   - `lib/email/data-readiness.ts` — verification ladder (crawl4ai → Haiku → Sonnet → last-known)
   - `app/api/cron/data-readiness/route.ts` — T-60 preflight cron endpoint
   - `app/api/deliverables/[id]/blast/route.ts` — in-memory refresh + pre-computed result lookup before render
9. **Phase 4A** — `ingest/brand-tier-registry.yaml` (data file, no code)
10. **Phase 4B** — `ingest/event-radius-config.yaml` (data file, no code)
11. **Phase 4C** — `lib/signals/event-evaluator.ts` + extend `lib/signals/types.ts` — pure, unit-testable (includes permit two-axis scoring)
12. **Phase 4C.geo** — `lib/geo/zip-centroid.ts` — ZIP machine lookup for geocoding gaps
13. **Phase 4D** — `docs/sql/20260619_project_events.sql` migration + `ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type text, ADD COLUMN IF NOT EXISTS derived_project_type text` — apply to prod
14. **Phase 4E** — `lib/signals/permit-event-extractor.ts`; connect permits_swfl as first live source via zip-centroid fallback
15. **Phase 4F** — `activeEvents` in `ProjectPageContext` + prompt injection + `ANALYST_SYSTEM` event instruction
16. **Phase 4G** — gating logic + cooldown + batching wired into event insert path
17. **Phase 4B.infer** — AI project-type inference (Haiku call on first event-match when both type fields null); write to `derived_project_type`
18. **Phase 5A** — `ingest/pipelines/news_swfl.py` + cadence_registry entry
19. **Phase 5B** — `NewsBar.tsx` + `NewsArticleDrawer.tsx` in project workspace
20. **Phase 5C** — `/api/projects/[id]/clip-news` route; highlighter clip → source item + event upgrade

**Steps 9-11 (YAML registries + pure evaluator) are cheap and zero-risk. Do them before any schema change.**

---

## Files changed summary

| File | Change |
|------|--------|
| `docs/sql/20260619_project_activity.sql` | **NEW** — project_activity table (the unified root) |
| `lib/project/project-state.ts` | **NEW** — assembles canonical AI state document from all sources |
| `lib/briefcase/briefcase-digest.ts` | Include values in digest string |
| `lib/chat/page-context.ts` | Replace ad-hoc context assembly with `buildProjectState()`; branding always live-read |
| `app/api/projects/[id]/route.ts` | Write `branding_changed` / `project_renamed` / `scope_changed` activity on PATCH |
| `app/api/user/brand/route.ts` | Write `branding_changed` activity on PATCH (all active projects) |
| `app/api/projects/[id]/items/route.ts` | Write `item_filed` activity on POST |
| `app/api/deliverables/route.ts` | Write `deliverable_built` activity on POST |
| `lib/project/digest.ts` | Add `significantChanges: SignificantChange[]` |
| `lib/project/prompt-engine.ts` | Specific change descriptions + nearby event injection |
| `lib/project/items.ts` | Add optional `scope_kind`, `scope_value` fields |
| `app/api/welcome/chat/route.ts` | `ANALYST_SYSTEM` significant-change + event instruction |
| `app/api/mcp/project-tools.ts` | Pass `scope_kind`+`scope_value` when filing metric items |
| `app/api/deliverables/[id]/blast/route.ts` | Pre-refresh items before email build |
| `ingest/significance-registry.yaml` | **NEW** — per-slug numeric thresholds |
| `ingest/brand-tier-registry.yaml` | **NEW** — brand tier + weights for qualitative events |
| `ingest/event-radius-config.yaml` | **NEW** — radius bands + score thresholds per project type |
| `lib/signals/types.ts` | **NEW** — `SignificantChange` + `QualEvent` + `ScoredEvent` interfaces |
| `lib/signals/change-evaluator.ts` | **NEW** — pure numeric significance evaluator |
| `lib/signals/event-evaluator.ts` | **NEW** — pure qualitative event scorer |
| `lib/signals/brain-snapshot.ts` | **NEW** — batch current-value lookup |
| `lib/signals/permit-event-extractor.ts` | **NEW (scaffold)** — permits_swfl → QualEvent extraction |
| `lib/project/refresh-on-access.ts` | **NEW** — on-access refresh logic |
| `app/api/projects/[id]/refresh/route.ts` | **NEW** — refresh endpoint |
| `docs/sql/20260619_project_items_scope.sql` | **NEW** — scope_kind + scope_value migration |
| `docs/sql/20260619_project_events.sql` | **NEW** — project_events table + indexes + cooldown logic + project_type/derived_project_type columns |
| `lib/geo/zip-centroid.ts` | **NEW** — ZIP → centroid lookup via fixtures/swfl-zip-county.json |
| `ingest/pipelines/news_swfl.py` | **NEW** — daily SWFL news crawl → QualEvent emit |
| `components/workspace/NewsBar.tsx` | **NEW** — horizontal scored-news strip in project workspace |
| `components/workspace/NewsArticleDrawer.tsx` | **NEW** — article panel with text highlighter |
| `app/api/projects/[id]/clip-news/route.ts` | **NEW** — highlight clip → source item + event upgrade |

---

## Verification

**Phase 0 (unified root):**
1. Update branding (agent name) → next AI message opens with the new name, not the old one
2. Rename a project → `project_activity` row appears with `activity_type: project_renamed`; AI state document shows updated name
3. Send an email blast → `email_sent` activity row written; next AI session: "RECENT ACTIVITY: Email blast sent to 14 contacts (2026-06-18)"
4. Open a project → AI system prompt contains the full PROJECT STATE block (not ad-hoc fragments); branding fields present even if no deliverable has been built yet
5. File a new item → `item_filed` activity row; AI next message: "I see you just filed the flood risk answer — want to add it to the deliverable?"
6. `bun test lib/project/project-state` → state document assembles correctly with missing fields gracefully degraded

**Phases 1-3 (numeric):**
1. Open a project → briefcase digest in network tab shows values, not just titles
2. Open a project where brain refreshed since last visit → AI context includes `freshnessIsNew: true` and AI says specifically what changed
3. Click nudge chip → specific change description, not "new data landed"
4. Change a slug's threshold in `significance-registry.yaml` → nudge only fires if delta exceeds new threshold
5. Email blast → verify `email_blasts` row + refreshed item values in the built HTML
6. `bun test lib/signals` → evaluator tests cover percent/absolute/state_change cases

**Phase 4 (qualitative events):**
7. Insert a tier-1 opening event 0.8 mi from a strip_mall project → `final_score = 10 × 1.5 = 15`, `notify_user = true`, `inject_ai = true`
8. Insert a tier-5 event at any distance → `final_score = 0`, `notify_user = false`, `inject_ai = false`
9. Insert same entity twice within cooldown → second row has `suppressed_reason = "cooldown"`, `notified_at` stays null
10. Open a project with `inject_ai = true` events → AI system prompt contains NEARBY EVENTS block, AI references the Walmart permit in conversation
11. Dismiss an event → next project open excludes it from AI context
12. `permit_filed` for Walmart on strip_mall → `final_score = 10 × 0.6 × 1.5 = 9` → `inject_ai = true` (≥4) but `notify_user = false` (< 6 after event_type discount? — re-check: 9 ≥ 6, so notify fires; if you want permit alone to not notify, raise `min_score_to_notify` to 10 for strip_mall or lower event_type multiplier to 0.5)
13. `bun test lib/signals/event-evaluator` → tests cover each tier × event_type × radius_band combination

---

---

## Phase 5 — News Crawl System + NewsBar UI

News is its own first-class pipeline — not a side feature of permits, not an afterthought. It has its own crawl schedule, its own source registry entry, its own scored event type (`business_news`), and its own UI surface (the NewsBar). It plugs into the same `project_events` table and `scoreEvent()` evaluator as every other source.

### 5A. News crawl pipeline

**New file:** `ingest/pipelines/news_swfl.py` (or `.mts` — match the pattern of the nearest existing pipeline)

Crawl cadence: **daily**, per ZIP cluster (not per project — crawl once, match to all projects).

Sources (in priority order):
1. **Local SWFL news outlets** — Bonita Springs/Naples Daily News, Fort Myers News-Press, Gulfshore Business, WINK News — scraped via crawl4ai for business section
2. **Google News search** — `site:naplesnews.com OR site:news-press.com "opens" OR "closes" OR "breaks ground" OR "new location"` — structured search, not full crawl
3. **County press releases** — Lee County and Collier County `.gov` news pages (static, crawl4ai works)
4. **Future:** paid wire (GlobeNewswire / PR Newswire with SWFL geo filter)

Each article → attempt brand extraction (match against brand-tier-registry aliases) + address/ZIP extraction → emit `QualEvent` with `event_type: "business_news"` and `source: "news_crawl"` → run through `scoreEvent()` → insert into `project_events` for any project within the scored radius.

**Deduplication:** articles about the same entity within 14 days are collapsed by `(entity_brand_key, event_type)` cooldown — same as all other sources.

**Confidence:** `business_news` carries the 0.5 event_type multiplier. A news article alone can inject into AI context but rarely clears the user notification bar — it needs corroboration from a permit or a second news hit within the cooldown window to upgrade to `anchor_announced` or `opening`.

### 5B. NewsBar UI component

**New file:** `components/workspace/NewsBar.tsx`

A horizontal scrollable strip pinned below the project workspace toolbar (above the item board). Renders scored `business_news` events for the project — not all news, only events that cleared `min_score_for_ai_context` for this project type. Quiet projects with no scored news show nothing (component returns null).

```
[ Walmart files $12M permit for new supercenter 1.1mi north  ·  McDonald's at Colonial closes permanently  ·  Publix announces second Naples location  → ]
```

- Each pill: entity name + short headline + distance badge + date
- Color: green tint for openings/permits, red tint for closings, neutral for general news
- Pills are ordered by `final_score desc` — highest signal left-most
- Clicking a pill → opens `NewsArticleDrawer`

**New file:** `components/workspace/NewsArticleDrawer.tsx`

Slide-in drawer (right side) showing:
- Article headline + source attribution + publication date
- Full article text (fetched from `source_url` if available; else the extracted headline + lead paragraph stored in `project_events.headline`)
- **Highlighter:** user selects text in the article body → "Add to Project" button appears inline. No separate button to hunt for.
- Dismiss button: marks `project_events.dismissed_at` → pill disappears from NewsBar + event excluded from AI context on next load

### 5C. Clip-to-project (highlighter → project item)

When user selects text in `NewsArticleDrawer` and clicks "Add to Project":

1. Selected text + article headline + source URL → sent to `/api/projects/[id]/clip-news`
2. Server creates a `source` item in the project: `{ kind: "source", label: article_headline, url: source_url, note: selected_text }`
3. Server also upgrades the `project_events` row: if the event was `business_news` and a human explicitly clipped it, set `event_type = "anchor_announced"` (human confirmation), recalculate score, update `inject_ai = true` — this user action is a strong signal
4. Response: workspace refreshes item board, new source item appears in the Sources lane. AI context on next message includes the clipped text as a confirmed signal.

**This is the "add info to project with highlighter" flow.** No manual form. Select → click → it's in the project.

### 5D. New files for Phase 5

| File | Purpose |
|------|---------|
| `ingest/pipelines/news_swfl.py` | Daily crawl + brand/address extraction + QualEvent emit |
| `ingest/cadence_registry.yaml` (append) | `news_swfl` entry: daily, SWFL geo filter |
| `components/workspace/NewsBar.tsx` | Horizontal news strip in project workspace |
| `components/workspace/NewsArticleDrawer.tsx` | Article panel with highlighter |
| `app/api/projects/[id]/clip-news/route.ts` | Clip handler: source item + event upgrade |

---

## Resolved decisions (baked in, not open questions)

| Topic | Decision |
|-------|---------|
| Permit weighting | Two-axis: permit_type multiplier × value_multiplier (log-scaled on declared_value_usd) — see 4C |
| Project type | Optional / never required. Resolution order: user-set → AI-inferred (`derived_project_type`) → `_default` |
| AI type inference | Passive, Haiku, on first event-match attempt when both type fields null. Stored to avoid re-runs |
| Geocoding gaps | Route through ZIP machine (`lib/geo/zip-centroid.ts`) → ZIP centroid; skip 0.25mi band; tag `geocode_source: "zip_centroid"`. General pattern for any pipeline with ZIP but no lat/lng |
| News crawl | Own first-class pipeline (`news_swfl`), own cadence entry, `business_news` event type; UI = NewsBar strip + article drawer + highlighter clip-to-project |
