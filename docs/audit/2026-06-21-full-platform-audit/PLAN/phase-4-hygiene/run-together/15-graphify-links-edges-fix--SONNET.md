# 15 — graphify: fix the `links[]`/`edges[]` split + resync the stale data plane

**Model: Sonnet.** One file + a regen command. **Priority: P3.**

## The defect (verified)
`graphify-out/graph.json` carries BOTH `links[]` (27,321, networkx-canonical, stale) AND `edges[]` (27,437).
`scripts/graphify-app-nodes.mjs:514-523` writes the merged object with `edges: [...brainEdges, ...newEdges]`
(line 517) but inherits the stale `links` unchanged via `...brainGraph` — so the **+116 app-plane edges land
in `edges[]` only**. A consumer reading `links[]` silently misses the app plane. (Nodes ARE merged into one
canonical array — only the edge plane is split.) Separately, the data plane + `GRAPH_REPORT.md` were 102
commits behind at audit time (`graphify:publish` refreshes only the app overlay).

## Steps
1. **Probe first.** Read `scripts/graphify-app-nodes.mjs` ~490-525 (the merge + write).
2. Fix the split: either (a) write the merged edges to **both** `links` and `edges` (keep networkx
   consumers + app consumers in sync), or (b) drop `links` and standardize on `edges` if nothing depends on
   `links`. **Probe which consumers read `links` vs `edges`** before choosing (grep the ops repo / `/graph`
   page consumer). Recommendation: write both (safest, no consumer audit needed).
3. Resync the data plane: `bun run graphify:update` (regenerates both planes; graphify-out is gitignored so
   this is a local refresh, not a commit). Note in SESSION_LOG that the data plane was stale.

## Done when
- `links[]` and `edges[]` agree on the app-plane edges (or `links` removed with no broken consumer); a fresh
   `graphify query` returns app+data nodes. `bun run graphify:update` runs clean.

## Best-practice fold-in
The knowledge graph is the platform's **Lineage pillar** (data-observability: Lineage/impact is one of the
5 core pillars per `docs/audit/2026-06-21-best-practices-research/round3/q-data-observability-pillars.md`).
Keeping `links[]`/`edges[]` in sync is lineage hygiene — a stale or split edge array means consumers
silently operate on an incomplete dependency graph, undermining the one surface meant to answer "what depends on what."

## Risk
Low. graphify-out is gitignored; this changes the generator + a local artifact.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — not a crawl4ai build)
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round3/q-data-observability-pillars.md` (REPORT observability Lineage row) — lineage/impact is one of the 5 pillars; the graph is our lineage surface
**Verified:** confirmed the links[]/edges[] split; a consumer reading links[] silently misses the app plane — folded into Steps above where applicable.
