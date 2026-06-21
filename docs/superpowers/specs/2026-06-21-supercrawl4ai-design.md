# supercrawl4ai — enhanced crawl layer (design)

**Date:** 2026-06-21 · **Status:** approved (brainstorm), pending implementation plan
**Author:** session 2026-06-21 · **Source brief:** `docs/audit/2026-06-21-supercrawl4ai/BRIEF.md`
**Supersedes nothing.** Additive. The existing `ingest/lib/crawl4ai_client.py` is untouched.

---

## 1. Goal & shape

Build a new crawl surface, **`supercrawl4ai`**, that **reuses the proven browser/session core**
in `crawl4ai_client.py` and adds every catalogued capability (deterministic tables, content
filtering, virtual-scroll, proxy egress, hardening, telemetry). It **proves itself** against the old
crawler with a benchmark, then pipelines migrate onto it one at a time — reversibly, because the old
client stays the stable base.

**Cardinal invariant:** `supercrawl4ai` with **default settings behaves identically to the old
client**. Every new power is an explicit, default-off setting. No existing pipeline's output, and no
scheduled rebuild, changes as a result of *building* this module. Output only changes when a pipeline
is deliberately migrated, and each migration is validated on its own.

crawl4ai remains the **only** crawl tool (operator decree 2026-06-16); Firecrawl/Spider stay dormant
key-gated fallbacks. `supercrawl4ai` is still crawl4ai — a richer in-process wrapper, not a new vendor.

### Why a layer, not a fork
We just consolidated duplicate test trees (#5) to cut sprawl; two from-scratch crawlers would
re-introduce exactly that (every `crawl4ai` bump fixes twice). So `supercrawl4ai` **imports and
delegates to** the existing primitives where they already do the job, and only adds new code for new
capability. One browser/strategy setup, two surfaces.

### Honest scope: throughput vs. capability
A second crawler does not by itself "run more at once." Throughput is gated by (a) the **datacenter-IP
wall** — GitHub Actions egress IPs are blocked outright by some targets (Census 403'd a live WebFetch
this session; Crexi runs active anti-bot) and (b) **crash-safety at concurrency**. This design tackles
(b) directly (the hardening lets us safely raise concurrency) and exposes the *escape* for (a) as the
`proxy` setting — **"scrape from your IP / a VPN / a residential proxy" is the first-class answer**,
not a workaround. It does **not** make a blocked site reachable by magic.

---

## 2. Architecture

New files:
- `ingest/lib/supercrawl4ai.py` — the module.
- `ingest/tests/lib/test_supercrawl4ai.py` — offline fixture tests (canonical `ingest/tests/lib/` home).
- `ingest/lib/supercrawl4ai_bench.py` — the prove-it benchmark (runnable via `python -m`).

Reused from `crawl4ai_client.py` (no edits to it beyond the #10 docstring): `Crawl4aiError`,
`AsyncWebCrawler`/`BrowserConfig`/`CrawlerRunConfig`/`CacheMode`/`UndetectedAdapter`/
`AsyncPlaywrightCrawlerStrategy`, the `MemoryAdaptiveDispatcher`+`RateLimiter` pattern, and the
markdown-unwrap helper logic.

### 2.1 `SuperConfig` (one options bundle; every default == current behavior)

```python
@dataclass
class SuperConfig:
    # — content shaping (off => byte-identical capture) —
    fit_markdown: bool = False         # PruningContentFilter -> result.markdown.fit_markdown
    tables: bool = False               # collect result.tables
    remove_overlays: bool = False      # remove_overlay_elements (cookie/consent/modal)
    scan_full_page: bool = False       # append-style auto-scroll
    max_scroll_steps: int | None = None
    scroll_delay: float = 0.2
    virtual_scroll: VirtualScrollConfig | None = None   # replaced-DOM capture  [PROVE: Phase 2]
    # — identity / egress —
    stealth: bool = False              # UndetectedAdapter + enable_stealth
    proxy: str | None = None           # CRAWL4AI_PROXY -> ProxyConfig.from_string  [PROVE: Phase 2]
    # — throughput / safety —
    concurrency: int = 5
    jitter: tuple[float, float] = (0.0, 0.0)     # (mean_delay, max_range)
    memory_threshold_percent: float = 85.0
    monitor: bool = False              # read result.dispatch_result (memory/timing) into logs
    # — fetch tuning —
    wait_for: str | None = None
    timeout_ms: int = 60_000
    table_score_threshold: int = 7
```

A `SuperConfig()` with no overrides + `stealth=False` reproduces `fetch_page_*`; with `stealth=True`
it reproduces the `Crawl4aiSession`/`fetch_many` capture path. This is the contract the byte-identical
test pins.

### 2.2 Functions

- `fetch_super(url, cfg=SuperConfig()) -> SuperResult` — the workhorse single fetch. Builds
  `BrowserConfig` (stealth?) + one `CrawlerRunConfig` from `cfg` (fit `markdown_generator`,
  `virtual_scroll_config`, `scan_full_page`/`scroll_delay`/`max_scroll_steps`, `remove_overlay_elements`,
  `proxy_config`, table threshold) and runs a single `arun`. Returns a `SuperResult`.
- `fetch_many_super(urls, cfg=SuperConfig()) -> dict[str, SuperResult]` — parallel fan-out via
  `arun_many` + a fully-parametrised `MemoryAdaptiveDispatcher` (memory ceiling + `RateLimiter` +
  jitter) and optional `monitor`. Keys by resolved url; failed urls map to a `SuperResult(success=False)`.
- `fetch_tables(url, *, stealth=False, score_threshold=7, min_rows=1, min_cols=1) -> list[SuperTable]`
  — thin convenience over `fetch_super(cfg with tables=True)` returning only the tables. **The #9 star.**

### 2.3 Result types

```python
@dataclass
class SuperTable:
    headers: list[str]
    rows: list[list[str]]
    caption: str = ""
    metadata: dict = field(default_factory=dict)
    def to_dataframe(self) -> "pd.DataFrame":   # pd.DataFrame(rows, columns=headers); df.attrs carries caption+metadata

@dataclass
class SuperResult:
    url: str
    success: bool
    html: str = ""
    markdown: str = ""          # raw_markdown (always present, == old behaviour)
    fit_markdown: str = ""      # only populated when cfg.fit_markdown
    links: list[str] = field(default_factory=list)
    tables: list[SuperTable] = field(default_factory=list)
    error: str | None = None
    dispatch: dict | None = None   # memory/timing from result.dispatch_result when cfg.monitor
```

---

## 3. Capability surface — verbatim vendor signatures

All vendor-verified live on the pinned `crawl4ai==0.9.0` (in-process) during the 2026-06-21 sweep;
**re-confirm against the installed package at implementation time** (Vendor-First). Each carries its URL.

| Setting | Verbatim signature | Vendor URL |
|---|---|---|
| tables | `for t in result.tables: t['headers'], t['rows'], t['metadata']`; `CrawlerRunConfig(table_score_threshold=7)`; `DefaultTableExtraction(table_score_threshold=7, min_rows=2, min_cols=2)`; `pd.DataFrame(t['rows'], columns=t['headers'])` | https://docs.crawl4ai.com/core/table_extraction/ |
| fit_markdown | `PruningContentFilter(...)` -> `DefaultMarkdownGenerator(content_filter=...)` -> `result.markdown.fit_markdown` | https://docs.crawl4ai.com/core/fit-markdown/ |
| virtual_scroll | `VirtualScrollConfig(container_selector="#feed", scroll_count=20, scroll_by="container_height", wait_after_scroll=0.5)`; `CrawlerRunConfig(virtual_scroll_config=...)` | https://docs.crawl4ai.com/advanced/virtual-scroll/ |
| scan_full_page | `CrawlerRunConfig(scan_full_page=True, scroll_delay=0.2, max_scroll_steps=N)` | https://docs.crawl4ai.com/api/parameters/ |
| remove_overlays | `CrawlerRunConfig(remove_overlay_elements=True)` | https://docs.crawl4ai.com/api/parameters/ |
| proxy | `ProxyConfig(server=..., username=..., password=...)` / `ProxyConfig.from_string("ip:port:user:pass")`; `CrawlerRunConfig(proxy_config=...)` (per-request; legacy `BrowserConfig.proxy` deprecated) | https://docs.crawl4ai.com/advanced/proxy-security/ |
| dispatcher | `MemoryAdaptiveDispatcher(memory_threshold_percent=90.0, check_interval=1.0, max_session_permit=10, rate_limiter=RateLimiter(base_delay=(1.0,3.0), max_delay=60.0, max_retries=3, rate_limit_codes=[429,503]))` | https://docs.crawl4ai.com/advanced/multi-url-crawling/ |
| jitter | `CrawlerRunConfig(mean_delay=..., max_range=...)` (jitters *before* the first block; complements RateLimiter, which backs off *after* a 429/503) | https://docs.crawl4ai.com/api/parameters/ |
| monitor | `result.dispatch_result` (memory_usage/peak_memory/start_time/end_time) | https://docs.crawl4ai.com/advanced/multi-url-crawling/ |

---

## 4. The prove-it benchmark (`supercrawl4ai_bench.py`)

Runs old-vs-super on the same input and reports **yield** + **concurrency-safety**. Three tiers, all
local (no anti-bot needed) except the opt-in Crexi A/B:

1. **Tables (deterministic):** `fetch_tables()` against a stable public HTML table (or a `raw://`
   fixture) → print headers/row-count; assert reproducible across two runs (zero-LLM, zero drift).
2. **fit vs raw:** `fetch_super(fit_markdown=False)` vs `(fit_markdown=True)` on a known content page →
   print byte-length reduction and confirm in-body links survive (the news/dbpr-parser safety check).
3. **Concurrency safety:** `fetch_many_super(N urls, monitor=True)` → print per-url + peak memory and
   wall-time from `dispatch`; demonstrates how high `concurrency` can safely go on this runner.
4. **[opt-in, Phase 2] Crexi yield A/B:** old `crexi/extract.py` scrape vs
   `fetch_super(stealth=True, virtual_scroll=...)` → **row-count A/B, run from a home IP or VPN.**
   This is the marquee "did super actually capture more?" proof; gated on the Crexi DOM-shape probe.

The benchmark prints a small table; it is a tool, not a CI gate.

---

## 5. Phasing

**Phase 1 — now (fully provable, zero anti-bot dependency):**
- `SuperConfig`, `SuperResult`, `SuperTable`.
- `fetch_super` (static + stealth paths), `fetch_many_super` (hardened dispatcher + jitter + monitor),
  `fetch_tables`.
- `fit_markdown`, `tables`, `remove_overlays`, `scan_full_page` wired as settings and proven on safe pages.
- `virtual_scroll` + `proxy` + `stealth` are **fields in `SuperConfig`, plumbed into the configs**, but
  their *proof* and any pipeline wiring is Phase 2 (designed-in now to avoid a later refactor).
- Offline fixture tests + the benchmark (tiers 1–3).
- **No pipeline migrations.** Super is built and proven; nothing moves onto it yet.

**Phase 2 — after the Crexi home-IP/VPN probe clears (separate, probe-gated):**
- Prove `virtual_scroll` + `proxy` on the live Crexi grid (benchmark tier 4) from your IP/VPN.
- Migrate `crexi/extract.py` onto `fetch_super`; delete its single-scroll + `[:28000]` cut.
- This phase is out of scope for the current implementation plan; it gets its own spec once the probe
  result (virtualized vs accumulating; reachable vs IP-blocked) is known.

---

## 6. Riding along (orthogonal, no module dependency, no probe)

These ship in the same effort but touch different files; sequence them as independent commits.

### #6 — fail-fast browser preflight across the 7 crawl crons
Add, after each job's install step:
- a non-fatal `crawl4ai-doctor` preflight (catches a missing/broken Playwright stack in <30s);
- for the **stealth jobs only** (`lee-permits-weekly`, `collier-permits-monthly`, `dbpr-sirs-monthly`,
  `ingest-crexi-listings` — UndetectedAdapter/patchright), an additional **hard-fail patchright smoke**
  `python -c "from patchright.async_api import async_playwright"` — because `crawl4ai-doctor` verifies
  Playwright only, **not** patchright (vendor caveat). Non-stealth jobs (`news-swfl-ingest`,
  `dbpr-public-notices-weekly`, `marketbeat-pdf-ingest`) get doctor only.
- Ship doctor `continue-on-error: true` for one cycle, then flip to hard-fail once a green dispatch
  confirms exit codes on a clean runner. **Re-confirm each job's stealth/non-stealth classification by
  reading its pipeline during implementation** (verified live in the 06-21 sweep; re-check before edit).
- Do **not** standardize on `crawl4ai-setup` everywhere — it would strip patchright from stealth jobs.

### #10 — record the in-process-only reality + the landmine
- Re-grep `CRAWL4AI_API_URL` at implementation (must be zero live consumers).
- Add a short canonical paragraph to `crawl4ai_client.py`'s module docstring: crawl4ai runs
  **in-process SDK only** here; there is no live remote-server consumer (the email ladder moved to
  Anthropic `web_search`, `32b4eb5b`); and **stealth/interactive crawling can never move to the 0.9.0
  remote server** — it rejects `js_code` / `js_code_before_wait` / `proxy` / `cookies` / `extra_args` /
  `simulate_user` / `magic` over the network with **HTTP 400** (https://github.com/unclecode/crawl4ai/blob/main/deploy/docker/MIGRATION.md);
  `Crawl4aiSession.step` depends on `js_code_before_wait` (`crawl4ai_client.py:84`).
- Append **correcting notes** (do not delete) to the now-stale `docs/audit/2026-06-20-crawl4ai/HANDOFF.md`
  (the `CRAWL4AI_API_URL` row) and `research.md` so the next reader isn't misled.
- The new `supercrawl4ai.py` docstring states the old-vs-super split (stable base vs enhanced surface).

### Small free-win (extract_client, no module dependency)
- Port a ~10% **chunk overlap** into `extract_client._chunk_text` (`extract_client.py:64-79`) so a row
  straddling a 24k boundary isn't dropped; dedup on a row key at merge. `extract()` has zero production
  callers today, so this is safe and isolated. (Keep our own engine; do **not** adopt
  `LLMExtractionStrategy` — the litellm/model-drift cost was already rejected in the 06-20 audit.)

---

## 7. Testing

- **Offline fixtures only** for CI-safe tests (mirror the existing `raw://<html>` pattern in
  `ingest/tests/lib/test_crawl4ai_client.py`): `fetch_tables` parses a fixture `<table>` into exact
  headers/rows; `SuperConfig()` default produces no `fit_markdown`/no overlay removal (byte-identical
  contract); `fetch_many_super` returns the `{url: SuperResult}` contract with a failed-url placeholder.
- **Benchmark** is the battle-test; it is **not** a CI gate (needs a live browser). Run it locally
  before trusting the module (`public.checks` = prod evidence, not "code looks right").
- The old client's own tests must stay green and unchanged (proves byte-identical).

---

## 8. Rules, gates, and out-of-scope

**Gates that apply:**
- **RULE 3.5** — satisfied by this brainstorm.
- **RULE 1** — lib + GHA-YAML additions; does **not** touch a live `/api/*` response, the MCP surface,
  or any `data_lake.*` write. Still: **show the diff and get approval before pushing** (operator
  no-autonomous-push standing decree). The 7-file GHA change alone crosses the >5-file diff-review line.
- **Vendor-First** — re-verify each signature against the installed `crawl4ai==0.9.0` before use.
- **Pre-push gate** — no `package.json`/`bun.lock` change (pure Python + YAML); no `refinery/packs/**`
  touch (Gate 5 N/A); no destructive ingest write (Gate 4 N/A). `SESSION_LOG.md` entry required.
- **Checks ledger** — open `supercrawl4ai_built` (close on a green local benchmark) and
  `crawl4ai_doctor_preflight` (close on a green stealth + non-stealth `workflow_dispatch`).

**Explicitly out of scope (YAGNI / phase boundary):**
- Any pipeline migration onto `supercrawl4ai` (Phase 2; crexi first, its own spec).
- Acquiring a proxy vendor / standing one up — the `proxy` knob is wired; *using* it needs your
  IP/VPN/credential and only matters at a blocked-target migration.
- Adopting `LLMExtractionStrategy`, `JsonCssExtractionStrategy.generate_schema` caching,
  `capture_network_requests`, `AdaptiveCrawler` for news (#11) — all deferred to their own work.
- Touching the daily rebuild, the MCP surface, or any refinery pack/vocab.

---

## 9. Success criteria

1. `supercrawl4ai` exists; `SuperConfig()` default is byte-identical to the old client (test-proven).
2. `fetch_tables()` returns deterministic, header-keyed rows from a fixture table (zero LLM).
3. The benchmark runs locally and prints yield (tables, fit-vs-raw) + concurrency-safety stats.
4. All 7 crawl crons fail fast on a broken browser; stealth jobs additionally hard-fail without patchright.
5. The in-process-only reality + the 400-reject landmine are documented where a future session will see them.
6. Every existing pipeline's output and the daily rebuild are unchanged.
