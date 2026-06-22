# Phase 7 — best-practices hardening (shared contract + sequencing)

**Added 2026-06-22.** These seven builds (22–28) come from the `docs/audit/2026-06-21-best-practices-research/REPORT.md`
fix list — the authoritative answers (Google SRE, dlt, dbt/Monte Carlo observability, Anthropic) for
**how to build/operate what we built**, which were **not folded into the original 21-build plan**. Each is a
1:1 transcription of an authoritative recommendation into an executable build, not net-new invention.

They split into three tracks:

| # | Build | Model | Track | Owns / touches | Depends on | Vendor-first? |
|---|---|---|---|---|---|---|
| 22 | dlt `schema_contract` (evolve/freeze + `schema_update` alert) | Opus | data-reliability | per-pipeline `pipeline.py` dlt config (start news_swfl) | **01** (generalizes its one-off ALTER) | dlt |
| 23 | dlt `merge`+`primary_key` / `refresh="drop_data"` vs blind `replace` | Opus | data-reliability | per-pipeline `write_disposition`; Gate 4 | Gate 4 (audit-first: stable key?) | dlt |
| 24 | freshness as an **SLA that can ERROR** (`warn_after`/`error_after`) | Sonnet | data-reliability | `check_freshness.py` + `cadence_registry.yaml` | **03** (the guard) + **19** (the registry) | — |
| 25 | value-level data tests (Quality) + column-type-change detector (Schema) | Opus | data-reliability | mostly NEW probe/test files | complements **22** (write) / **24** (volume) | — |
| 26 | Structured Outputs `strict:true` (kill fence-stripping) | Opus | ai-layer | `extract_client.py` + refinery JSON path + crexi | **06** + coordinate **11** | **Anthropic API** |
| 27 | Citations API + retract-if-no-quote on conversation path | Opus | ai-layer | `conversation-path.ts` + `grounded-answer.ts` | **20** (charts must cite rows) | **Anthropic API** |
| 28 | cron ledger → real postmortem record; alert on significant only | Sonnet | ops | `cron-rebuild-failures.md` + `log-cron-incident`/`ledger-flap`/`classify` | **02** (reason echo) + **04** (classifier) | — |

## Sequencing / file-conflicts (why these are mostly SOLO, not a clean run-together group)

- **24 serializes after 03 + 19** — it shares `check_freshness.py` (03) and `cadence_registry.yaml` (19).
  03 keeps the *always-exit-0* contract for ungated sources; 24 only adds loud-fail where a source
  **opts in**. Never run 24 concurrently with 03 or 19.
- **22 serializes after 01** — 01 aligns the live `news_swfl.published_date` column NOW; 22 is the durable
  recurrence-prevention (schema contract) and may touch the same `pipeline.py`.
- **26 after 06, coordinate with 11** — it rewrites the JSON-parse path that 06 (extract_client) and 11
  (crexi fence logic) also touch.
- **27 after 20** — both touch `conversation-path.ts` + `grounded-answer.ts`.
- **28 after 02 + 04** — it consumes the reason-echo (02) and the classifier rules (04) and extends the
  same cron-incident `.mjs` scripts.
- **23 and 25** are largely independent (per-pipeline write-disposition; new test files) — they can run any
  time after their audit-first probe.

## The two binding guardrails (do NOT violate)

1. **RULE 3 C2 — extend the seam, never erect a new mandatory pre-materialization gate.** Builds 22–25 are
   **data-pipeline** changes. Each is framed as **per-pipeline / opt-in**, EXTENDING an existing seam
   (`cadence_registry`, Gate 4, `check_freshness`, the view-liveness probe) — **not** a new global gate
   everything must pass through. The five-facet "Source Contract as spine" bundled-governance design was
   **already rejected on evidence** (dbt warns against early bundled governance; ODCS is descriptive, not a
   gate). Do not re-erect it here. (Build 28 is ops-tooling — it gates the agent's record, not the
   materialization path, so C2 does not constrain it.)
2. **RULE 1 — Vendor-First on 22/23/26/27.** dlt (`schema_contract`/`merge`/`refresh`) and the Anthropic
   API (`strict:true` Structured Outputs, Citations API) are **vendor surfaces whose exact shape + GA status
   drift**. Each of these builds MUST `WebFetch` the **live** vendor docs **in-session at build time** to
   confirm the request shape / model-id support before coding. The round captures under
   `best-practices-research/` are starting pointers, **not** authority for verbatim values.

## Provenance
Every build here traces to a numbered item in `REPORT.md`'s "THE FIX LIST": 22←P0#1/row1, 23←P1#6/row2,
24←P2#7, 25←P2#8, 26←P3#10, 27←P3#11, 28←HEADLINE#2/P1#5. The original 21 builds remain the priority
spine (daily reds first); Phase 7 is the **durable hardening** that stops the recurring classes from
coming back — run after the Phase-1 reds are green.
