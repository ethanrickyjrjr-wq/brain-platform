# Build #1 — city_pulse `story_key` content-aware supersession

**Status:** READY TO BUILD (audited against live code 2026-05-31)
**Check:** `city_pulse_story_key` (`public.checks`, due 2026-06-15 UTC) — resolves `docs/sql/20260530_checks.sql:36`
**Precedes / hands the contract to:** Build #2 — weekly corridor trigger (`city_pulse_weekly_corridor`, same due date)

This supersedes the original pasted plan. Every line ref below was verified against the
files on `main`. Changes from the original plan are called out as **[Δ]** with the reason.

---

## What this does (and what it deliberately does not)

`data_lake.city_pulse` today kills exact duplicates only (`dedup_key = sha256(city|normalize_url(source_url))`,
`ON CONFLICT (dedup_key) DO NOTHING`) and ages rows out by per-topic TTL. It has no notion of a
**story moving**: "Amazon announced a $60M land buy" and "Amazon broke ground on the Lehigh site"
are different articles → different `source_url` → different `dedup_key` → two live rows that
compete until each independently TTL-expires.

`story_key` retires what `dedup_key` structurally cannot: the **same story told by a different
article**. The `superseded_by` column already exists (reserved v2, FK to `id`, `NO ACTION`);
`story_key` does not.

**Invisible hygiene.** Output _shape_ is unchanged. Superseded rows stop appearing; the reader
filters `superseded_by IS NULL` and the existing topic→recency sort floats the surviving head.
No `spec-validator` / output-shape churn, zero downstream blast radius (master / speaker / MCP
unchanged). The _counts_ in the brain naturally drop as stale story-versions collapse — that's the
point.

### Stability mechanism — grounded reuse only (no string-distance heuristic) **[Δ]**

Before distilling a city, read its live `story_key`s and inject them into the distill prompt; the
LLM reuses an **exact** existing slug when a fact continues that story, mints a new kebab slug only
when none fits. Forced-tool structured output makes the slug an exact string.

**The original plan's deterministic fuzzy-catch (`canonical_story_key`, "snap on ≥2 shared
tokens") is REMOVED. [Δ — operator decision 2026-05-31]** Rationale: a net that can _silently
merge unrelated stories_ (e.g. `amazon-lehigh-distribution` vs `fedex-lehigh-distribution` share
`lehigh`+`distribution` → wrong snap), where the merge re-fires every run and is invisible except a
log line, is worse than no net. A cosmetic story-split (two slugs for one story) is harmless — both
stay visible, and the next grounded run can converge. A silent merge is data-loss-in-product
recoverable only by manual audit. Grounded reuse + forced-tool exact strings are the real stability
lever; if they're not enough, the fix is a better prompt, not a fragile heuristic.

**Same-run consistency is handled by the prompt, not a working set. [Δ — resolves P2]** All facts
for a city come back in ONE distill call, so a mutable within-batch set has no live consumer once
the fuzzy snap is gone (`slugify` already collapses exact matches). Instead, one prompt line tells
the model to use the same slug for every fact in the response about the same story. No dead code.

Accepted v1 edges (operator-acknowledged, do NOT over-engineer): sticky early slugs (operator can
`UPDATE` a polluting slug by hand); occasional cosmetic split that survives until the next grounded
run collapses it.

---

## A. Migration — `docs/sql/20260531_city_pulse_story_key.sql` (run directly via psycopg, idempotent)

```sql
ALTER TABLE data_lake.city_pulse ADD COLUMN IF NOT EXISTS story_key TEXT;

-- Serves the grounding read (WHERE city=? AND superseded_by IS NULL AND story_key IS NOT NULL)
-- and the reader filter. Partial: only live, keyed rows. NOTE: the reconcile head CTE also reads
-- superseded rows, so it will NOT use this partial index — fine at this table's size.
CREATE INDEX IF NOT EXISTS city_pulse_story_live_idx
  ON data_lake.city_pulse (city, story_key)
  WHERE superseded_by IS NULL AND story_key IS NOT NULL;
```

After apply: `SELECT count(*) FROM data_lake.city_pulse WHERE story_key IS NOT NULL;` (expect 0 —
backfill happens organically as the daily cron re-captures; legacy rows never participate, which is
fine). Confirm with `\d+ data_lake.city_pulse` that `superseded_by` FK action is **NO ACTION**
(verified in `docs/sql/2026-05-30_city_pulse.sql:16` — `REFERENCES data_lake.city_pulse(id)` with
no `ON DELETE` clause).

**Optional same-file fix:** the comment at `2026-05-30_city_pulse.sql:15` says
`sha256(city|topic|normalized-fact)` — that is **stale**; the code (`distill.py:54-61`) hashes
`city|normalize_url(source_url)`. Correct the comment while you're here (low priority).

---

## B. `ingest/pipelines/city_pulse/distill.py`

### B1. Tool schema — `EXTRACT_TOOL` (line 68). Add the property + mark it required.

Add to the per-fact `properties` (`distill.py:78-83`):

```python
"story_key": {"type": "string",
    "description": "Stable lowercase-kebab slug naming the underlying story/entity/deal this "
    "fact is about (e.g. 'amazon-lehigh-distribution-center'). If this fact continues one of the "
    "already-tracked stories listed in the prompt, return that EXACT slug. Otherwise mint a new "
    "concise kebab slug from the core entity + place. Use the SAME slug for every fact in THIS "
    "response that is about the same story. Never paraphrase an existing slug."},
```

Add `"story_key"` to the item `required` list (`distill.py:84`): `["topic", "fact", "cite", "story_key"]`.

> Forced tool_use means the model must supply it, but Anthropic does not hard-validate input
> against the schema — the code-side default in B4 is what actually protects you. Keep both.

### B2. `slugify_story_key` — KEEP. `canonical_story_key` — DO NOT WRITE. **[Δ]**

```python
def slugify_story_key(s: str) -> str:
    """Lowercase, collapse non-alphanumerics to single hyphens, strip edges."""
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)
```

(No `canonical_story_key`. No within-batch working set. Grounded reuse + exact slugify only.)

### B3. Grounding read — new best-effort helper (wrapped → `[]` so dry-run / no-DB / pre-migration degrade gracefully).

```python
def live_story_keys(city: str) -> list[str]:
    """Active (non-retired) story_keys for one city — injected into the distill prompt so the
    LLM reuses an existing slug when a fact continues that story. Best-effort: any failure
    (pre-migration column missing, dry-run, no DB) yields [] and grounding is simply unavailable."""
    try:
        conn = _get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT DISTINCT story_key FROM data_lake.city_pulse "
                    "WHERE city = %(city)s AND superseded_by IS NULL "
                    "AND story_key IS NOT NULL AND expires_at > now()",
                    {"city": city})
                return [r[0] for r in cur.fetchall()]
        finally:
            conn.close()
    except Exception:
        return []
```

(`_get_connection` is already imported at `distill.py:30` from `ingest.lib.tier1_inventory`.)

### B4. `rows_from_extraction` (line 93) — slugify the LLM's slug onto the row. **[Δ — no `known` param, no fuzzy]**

Inside the per-fact loop, after the existing citation-resolution block, when building the row dict
(`distill.py:116-127`) add one entry:

```python
"story_key": slugify_story_key(f.get("story_key") or "") or None,
```

A null `story_key` is fine — the row is still written (citation-backed), it just never
participates in supersession, exactly like a legacy row. **Do NOT drop a cited fact for an empty
slug.** No new function parameter is needed (grounding lives in the prompt, B5).

### B5. `distill_capture` (line 131) — fetch known slugs, inject grounding block.

Near the top, after `city = capture["city"]`:

```python
known = live_story_keys(city)
```

When `known` is non-empty, prepend this block to `prompt` (before the "Extract every concrete…"
instruction):

```
Stories already being tracked for {city} (reuse the EXACT slug if a new fact continues one of these):
- <slug>
...
```

And add one sentence to the instruction text:
`"Set story_key for each fact — reuse an exact slug from the tracked list above when the fact continues that story, otherwise mint a new kebab slug."`

> `distill_capture` runs in `--dry-run` too (called at `pipeline.py:290`, before the dry-run guard
> at 297). `live_story_keys` is wrapped, so dry-run without DB access still works; with DB access it
> issues one read-only SELECT — harmless.

### B6. `_INSERT_COLUMNS` (line 190) — append `"story_key"`.

`_insert_sql()` (196) picks it up automatically; rows already carry the key.

### B7. Reconcile — SINGLE end-of-run pass, all cities, `DISTINCT ON (city, story_key)`. **[Δ — was per-city]**

This mirrors `prune_expired` (one pass at the end, its own connection) instead of running inside the
per-city persist `try`. Three reasons (P3): (1) a per-city reconcile failure would append the city
to `errors` and, if it failed for all 7, raise `RuntimeError("all cities failed")` and red the cron
— even though `write_rows` already committed; (2) far fewer connections; (3) the `(city, story_key)`
shape generalizes cleanly to Build #2's `(corridor, story_key)` — **this is the contract #2 inherits.**

```python
def _reconcile_sql() -> str:
    return """
    WITH head AS (
      SELECT DISTINCT ON (city, story_key)
             city, story_key, id AS keep_id, expires_at AS keep_expires
      FROM data_lake.city_pulse
      WHERE story_key IS NOT NULL AND expires_at > now()
      ORDER BY city, story_key, captured_at DESC, id DESC
    )
    UPDATE data_lake.city_pulse cp
    SET superseded_by = head.keep_id,
        expires_at    = LEAST(cp.expires_at, head.keep_expires)
    FROM head
    WHERE cp.city = head.city
      AND cp.story_key = head.story_key
      AND cp.id <> head.keep_id
      AND cp.superseded_by IS DISTINCT FROM head.keep_id
    """

def reconcile_supersession() -> int:
    """End-of-run pass: retire every non-head live row of each (city, story_key) to point at that
    story's newest live row, capping its expires_at to the head's. Returns rows retired.

    City-scoped via the join (cp.city = head.city), so same slug in two cities never merges.
    Idempotent: `superseded_by IS DISTINCT FROM head.keep_id` skips already-pointed rows; a newer
    head re-collapses the chain flat (children point at the head, not at each other).

    FK-safe under NO ACTION: LEAST(...) caps every child's expires_at <= its head's, so when a head
    expires its children are already expired — a single `DELETE WHERE expires_at < now()` removes
    parent+children together; no dangling reference.

    Head selection caveat (P4): within ONE run all facts share captured_at (= run_at), so the head
    ties on `id DESC` = LLM array order, NOT event recency. Across runs the later capture wins (the
    realistic follow-up path). Supersession only fires while the older row is still inside its topic
    TTL (transactions 7d, development/business 14d, structural 90d); past that it's pruned anyway."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(_reconcile_sql())
            n = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return n
```

---

## C. `ingest/pipelines/city_pulse/pipeline.py`

**C1.** Extend the distill import (line 41):

```python
from ingest.pipelines.city_pulse.distill import (  # noqa: E402
    distill_capture, write_rows, prune_expired, reconcile_supersession,
)
```

**C2.** The per-city persist block (303-314) is **unchanged** — do NOT add a reconcile call inside
the loop, and leave the line-314 print as-is. **[Δ]**

**C3.** Reconcile + prune once after the loop. Replace the post-loop block (320-322) with:

```python
    if not args.dry_run:
        try:
            retired = reconcile_supersession()
            print(f"city_pulse: superseded {retired} non-head rows into story heads.")
        except Exception as exc:
            # Writes already committed; a reconcile failure must not red the cron or block prune.
            print(f"  -> WARNING (reconcile skipped this run): {exc!r}")
        pruned = prune_expired()
        print(f"city_pulse: pruned {pruned} expired Tier-2 rows (raw audit retained in Tier-1).")
```

Order is reconcile → prune so freshly-capped expired children are cleaned in the same run. The
dry-run path (297-301) is untouched.

---

## D. `refinery/sources/city-pulse-source.mts` (the only file that knows the schema)

**D1. Live query** (`fetchRows`, 118-124): add the superseded filter after `.gt("expires_at", nowIso)`:

```ts
.gt("expires_at", nowIso)
.is("superseded_by", null);
```

**Do NOT add `story_key` or `superseded_by` to `.select(...)`. [Δ]** The `.is()` filter is
server-side and `normalizeRow` ignores both columns — selecting them is dead weight. Leave the
`.select(...)` list (121-123) exactly as it is.

**D2. Fixture parity** — `.is()` only applies to the live PostgREST query, so mirror the hide in
the fixture branch (replace line 115):

```ts
if (env.source === "fixture") {
  const rows = await loadFixtureRows();
  return rows.filter((r) => r.superseded_by == null); // == null matches null AND undefined (rows w/o the key)
}
```

**D3. Docs** — update the schema doc-comment (24-29) to list `story_key` and `superseded_by` as
columns that now exist on the table. Leave the `citationMeta` parenthetical (177) describing the
**selected** columns accurate — since neither new column is selected, don't add them there (or note
they exist but are unread). `normalizeRow` / `CityPulseNormalized` stay unchanged (invisible hygiene).

---

## E. Fixture — `refinery/__fixtures__/city-pulse.sample.json`

- Add `"story_key"` to the existing 2 rows (for realism; the reader doesn't read it, so this is
  documentation only).
- Add a **3rd row that is superseded**: an older Naples row sharing a `story_key` with row 1,
  `"superseded_by": 1`, far-future `expires_at`. The existing 2 rows keep `superseded_by`
  absent/null. This is the row the fixture test asserts is hidden.

---

## F. Tests **[Δ — fuzzy tests removed, per-city reconcile test dropped]**

**`ingest/pipelines/city_pulse/test_distill.py`:**

- `slugify_story_key`: kebab-cases, collapses runs of separators, strips edges, lowercases.
- `rows_from_extraction` carries a slugified `story_key`; an empty/missing slug → `story_key is None`
  but the cited fact is **still kept**.
- `_INSERT_COLUMNS` contains `"story_key"`.
- `_reconcile_sql()` string shape: contains `DISTINCT ON (city, story_key)`, `LEAST`,
  `superseded_by`, `IS DISTINCT FROM`. (Mirrors the existing `_insert_sql`/`_prune_sql` string tests
  — the repo has no live DB in CI, so string-shape is the established pattern.)
- **Do NOT** write `canonical_story_key` tests — the function no longer exists.

**`ingest/pipelines/city_pulse/test_pipeline.py`:**

- **No reconcile-invocation test. [Δ]** There is no existing `main()`/`write_rows` harness to mirror
  (the file only covers `capture`/auto-fallback), and reconcile is now a single end-of-run call.
  Building a full `main()` mock isn't worth the brittleness; the `_reconcile_sql()` string test +
  the live single-city verify (below) cover it.

**`refinery/packs/city-pulse-swfl.test.mts`:**

- Add a fixture-mode test: `await cityPulseSource.fetch()` → feed to `corpusSummary` →
  `outputProducer`, and assert no `key_metric` references the superseded fixture row's fact/url
  (head-only). The existing `frag()`-based tests bypass the source, so this new test must go through
  `cityPulseSource.fetch()` to exercise the D2 filter.

---

## G. Close the check (after DB-verified, psycopg per RULE 1)

```sql
UPDATE public.checks SET state='done', resolved_at=now(), resolved_by='claude', updated_at=now()
WHERE check_key='city_pulse_story_key';
```

(`public.checks` has `state ∈ {open,done,dropped}`, `resolved_at`, `resolved_by`, `updated_at` —
verified `20260530_checks.sql:7-23`.)

---

## H. SESSION_LOG + push

Append a top-of-file `SESSION_LOG.md` entry (migration + grounding read + slugify + end-of-run
reconcile + reader filter + check closed), commit, push. **Brain-first gate / vocab-contract: not
triggered** (no new Tier-2 ingest, no new metric slug, output shape unchanged).

---

## Verification (end-to-end) **[Δ — bun, not vitest]**

1. **Migration:** apply SQL; `\d+ data_lake.city_pulse` shows `story_key` + the partial index; FK is NO ACTION.
2. **Python units:** `pytest ingest/pipelines/city_pulse/ -q` green.
3. **TS units:** `bun test refinery/packs/city-pulse-swfl.test.mts` green; superseded fixture row
   hidden. (Repo runner is bun — `package.json` `"test": "bun test"`; the file imports `bun:test`.
   `npx vitest` would fail to resolve `bun:test`.)
4. **Dry run:** `python -m ingest.pipelines.city_pulse.pipeline --city Naples --dry-run` — prints
   distilled facts; no crash when the grounding read is unavailable.
5. **Live single-city** (`--city Naples`), then in DB confirm: (a) new rows carry `story_key`;
   (b) a re-run capturing a continuation sets `superseded_by` on the older row and caps its
   `expires_at`; (c) `SELECT count(*) ... WHERE superseded_by IS NOT NULL > 0`;
   (d) the reader query (`expires_at > now() AND superseded_by IS NULL`) returns head-only.
6. **Reader:** rebuild `city-pulse-swfl` (fixture mode at minimum); `--- OUTPUT ---` shape identical
   to before (only superseded rows missing).

---

## Handoff — Build #2 (weekly corridor trigger), for the other Claude

- **Inherit this contract:** `story_key` + `superseded_by` + the end-of-run reconcile from day one.
  The reconcile `DISTINCT ON (city, story_key)` becomes `DISTINCT ON (corridor, story_key)` — same shape.
- **Grain:** 25 CRE corridors (16 Lee, 9 Collier). Build-time list: `fixtures/corridor-centroids.json`
  (verified exists); runtime authority is `corridor_profiles` (`WHERE deleted_at IS NULL AND
verification_status='verified'` — see `ingest/pipelines/corridor_grounded/pipeline.py:183`, verified).
- **Structure:** separate entrypoint `ingest/pipelines/city_pulse_corridors/` reusing capture/distill
  helpers, writing to a new `data_lake.city_pulse_corridors` table — do NOT retrofit the daily city
  script (hardcoded 7-city `CITIES`).
- **Batch API is GREENFIELD (0 uses in repo). VERIFY against live Anthropic docs in-session
  (Vendor-First):** `/v1/messages/batches` shape, model id, polling/retrieval, result parsing.
- **Plumbing:** new weekly GHA workflow (daily city-pulse is `0 9 * * *`, verified — pick a free
  slot); `ingest/cadence_registry.yaml` entry (lane: tier-1, cadence_days: 7,
  inventory_id: `lake-tier1/city_pulse_corridors/`, inventory_key_type: prefix).
- **Brain-first gate:** a Tier-2 ingest needs its consuming pack in the same PR — extend `cre-swfl`
  to read corridor-pulse rows or add a dedicated corridor-pulse pack.
- **Close** `city_pulse_weekly_corridor` when shipped.
