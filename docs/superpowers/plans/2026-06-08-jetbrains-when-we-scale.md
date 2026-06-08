# JetBrains / PyCharm — revisit-when brief (parked tool decision)

**Status:** PARKED. Repo is made PyCharm-safe now (gitignore), but we are **not** adopting
JetBrains today. This doc is the trigger + the analysis so a future session (or the operator)
can pull the trigger fast when one of the conditions below fires — without re-running the
evaluation from scratch.

**Authored:** 2026-06-08 (Opus 4.8) at operator request: "put this in the plans for when we
are about to launch / when we have more data than we can handle / when we're having issues
with these things. wire up the pycharm so it doesn't break anything."

---

## REVISIT WHEN (any one of these)

1. **About to launch.** Public launch / paid traffic is imminent and migration-quality + lake
   integrity need to be airtight — a real DB IDE de-risks the SQL/lake work right when mistakes
   are most expensive.
2. **More data than we can handle.** Lake volume (Postgres `data_lake.*`, DuckDB/Parquet) grows
   past what ad-hoc psql / DuckDB CLI / VS Code comfortably introspect — you're hand-writing
   queries blind to the live schema and it's slowing you down.
3. **Having issues with "these things."** Recurring friction specifically in: SQL migrations,
   schema drift, lake querying, or the Python ingest layer (dlt / psycopg pipelines) — i.e. the
   places where JetBrains' DB console + Python debugger actually beat the current setup.

If none of these is true, **do nothing** — VS Code + Claude Code is the right tool and switching
editors mid-flight is a poor trade.

---

## THE ANALYSIS (why JetBrains, mapped to OUR stack)

Stack context: Next.js/TS (`.mts` refinery) + Python ingest (dlt, psycopg, pdfplumber) +
Supabase Postgres (`data_lake.*`) + DuckDB/Parquet lake. Solo operator. **Claude Code is the
primary driver** and runs as a JetBrains plugin too — so adopting a JetBrains editor costs us
**nothing** in Claude Code workflow.

### Where JetBrains genuinely beats VS Code here

- **Database tooling — the one real win.** IntelliJ Ultimate / PyCharm / DataGrip share the
  DataGrip engine: live-schema autocomplete, result grids, explain plans, one console that
  speaks **both Postgres (Supabase) AND DuckDB**. This maps directly onto our "run idempotent
  SQL migrations directly, verify row count" workflow and lake querying. Catches schema
  mismatches *before* the migration runs.
- **Python ingest layer.** Real step-through debugger into dlt pipelines / psycopg calls is
  stronger than VS Code + Pylance for our non-trivial ingest code.
- **Polyglot monorepo in one window.** `.mts` TS + Python + SQL + JSON vocab, cross-language nav.

### Where it does NOT move the needle

- TS/React/Next.js — WebStorm is excellent but VS Code is already very good; marginal gain for
  real switching cost.
- **AI — skip JetBrains AI entirely.** We're committed to Claude Code (which runs in JetBrains).
  Do not pay for JetBrains AI Assistant / Junie.

---

## BUDGET (verified 2026-06-08 against jetbrains.com; re-verify at adoption — pricing drifts)

- **PyCharm** unified Community + Pro in 2025 into one app with a **genuinely usable free tier**
  (debugger, completion, Jupyter, core Python + basic DB tools). Closest to "free and useful"
  for us → this is what we "wire up" now.
- **DataGrip** standalone: ~$89–99/yr first yr (free for *non-commercial* only — swfldatagulf is
  commercial, so the free tier does NOT cover our real work).
- **IntelliJ IDEA Ultimate:** ~$200 first yr → ~$119 yr 3.
- **All Products Pack** (10 IDEs + DataGrip): ~$289 first yr, continuation discounts yrs 2–3.
- Continuation discounts ~20% yr 2, ~40% yr 3.

Sources: jetbrains.com/store, /datagrip/buy, /idea/buy, /all.

---

## RECOMMENDATION (the call to execute when a trigger fires)

Don't rip out VS Code. ROI is "nice-to-have" until a trigger above makes the DB/ingest pain real.
When it does:

1. Start with **free PyCharm** — gets the Python debugger + DB console to evaluate at $0.
2. Point its DB console at Supabase Postgres + the DuckDB/Parquet lake; run a real migration +
   a lake query through it.
3. Only escalate to paid **DataGrip** (~$90/yr) — or **IntelliJ Ultimate** for one-window
   polyglot — if the SQL/lake workflow proves it earns the line item.
4. **Never** pay for JetBrains AI; keep Claude Code as the driver.

Net: a ~$90 DataGrip line item for faster/safer lake migrations is defensible. A full editor
migration is not.

---

## WHAT'S ALREADY WIRED (done 2026-06-08, "doesn't break anything")

- **`.gitignore`:** added `.idea/` and `*.iml`. PyCharm writes per-machine project files into
  `.idea/` (interpreter paths, run configs, indexes). Ignoring them means PyCharm can open the
  repo today and **never** pollute the tree, conflict on another checkout, or fight the
  prettier/pre-commit hooks. This is the "doesn't break anything" guarantee.

### To actually open it in PyCharm later (zero-code graduation)

1. Open the repo folder in PyCharm.
2. Set the Python interpreter to a venv with `ingest/requirements.txt` installed
   (`pip install -r ingest/requirements.txt` — dlt, psycopg, duckdb, pyarrow, pdfplumber, …).
3. Mark `node_modules`, `.next`, `.refinery-cache`, `data/` as **Excluded** so indexing stays fast.
4. DB console: add a Postgres data source (Supabase URI from `.dlt/secrets.toml` — never commit
   it; it's already gitignored) and a DuckDB data source pointed at the lake Parquet.
5. JS/TS lives in VS Code + Claude Code; use PyCharm for Python + DB only unless you go Ultimate.
