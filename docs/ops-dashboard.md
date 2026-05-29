# /ops live operations dashboard — where the code lives

The private operations ledger ("/ops") is **not** in this repo. It lives in its own
repository and deploys as its own Vercel project.

- **Repo:** https://github.com/ethanrickyjrjr-wq/swfldatagulf-ops
- **Live (gated):** https://swfldatagulf-ops.vercel.app
- **Local sibling clone:** `../swfldatagulf-ops` (next to `brain-platform`)

## Why it's a separate repo, not `brain-platform/ops/`

The dashboard is a **consumer** of this platform's data layer, not a module of it. It
reads from Supabase (`data_lake._dlt_loads` freshness) and the GitHub API (workflow
runs, raw files); it imports **nothing** from `brain-platform` at build time. Keeping it
in-repo bought no atomic type-safety (it doesn't share types) and fought Vercel's
root-directory deploy config. It independently evolved away from the in-repo copy
(dropped the custom auth middleware that crashed on Vercel — now relies on Vercel
Deployment Protection — added `vercel.json`, declared the framework), which confirmed
it's a peer service, not a peer module.

`brain-platform/ops/` was the original scaffold (commit `9180955`); it was **retired**
once the standalone repo became the deployed source of truth, so the two can't drift.

## What it shows

Categorized GREEN/YELLOW/RED status derived from live signals (brains' freshness
tokens, `cadence_registry.yaml` × `_dlt_loads`, GitHub Actions runs, service pings),
plus a build-queue page. The **one** hand-maintained input is
`_AUDIT_AND_ROADMAP/build-queue.md` in **this** repo, which /ops reads to order the
REDs and flag YELLOWs.
