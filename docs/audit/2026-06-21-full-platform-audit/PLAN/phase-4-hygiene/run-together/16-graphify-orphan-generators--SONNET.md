# 16 — retire the 2 orphaned graphify Python generators

**Model: Sonnet.** Delete/document two files. **Priority: P3.**

## The defect (verified)
`scripts/graphify/build-graph.py` (8564 B) and `scripts/graphify/export-ops-graph.py` (3621 B) exist but are
referenced by **NO** npm script / hook / doc (the only "references" are byte-identical copies inside
`.claude/worktrees/agent-*/` scratch checkouts — not callers). Superseded by the `graphify` CLI +
`scripts/graphify-app-nodes.mjs` + `graphify:publish`. They're dead weight that misleads the next reader.

## Steps
1. **Probe first.** Confirm zero callers: grep `package.json`, `.claude/hooks/`, `docs/` (excluding
   `docs/audit/` and `.claude/worktrees/`) for `build-graph.py` and `export-ops-graph.py`. Confirm
   `graphify:publish` (the live path) replaces what `export-ops-graph.py` once did (writes to
   `../swfldatagulf-ops`).
2. Delete both files. (If there's any lingering value in `export-ops-graph.py`'s ops-repo write that
   `graphify:publish` doesn't cover, fold it into the `.mjs` first — but the audit found it fully
   superseded, so default is delete.)

## Done when
- Both files gone; `bun run graphify:update` + `graphify:publish` still work; no broken reference anywhere.

## Best-practice fold-in
SRE toil-elimination principle: dead weight that misleads readers is operational toil — it wastes the next
engineer's probe time every session. Deleting superseded generators (not archiving, not commenting out) is the
correct posture; archive only if the logic is genuinely unreproducible from the CLI replacement.

## Risk
Low. Pure dead-code removal. (RULE 1: trivial revert — just commit.)

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — not a crawl4ai build)
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round2/rootcause-sre-eliminating-toil.md` — remove dead/superseded weight (toil) rather than carrying it
**Verified:** confirmed 2 orphaned .py generators — folded into Steps above where applicable.
