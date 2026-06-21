# supercrawl4ai Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** 🧠 Opus — 9 tasks, 9 files, keywords: migration, architecture

**Goal:** Build `supercrawl4ai`, an enhanced in-process crawl layer over `crawl4ai_client.py`, with deterministic table capture, content/scroll/proxy/hardening settings (all default-off), a prove-it benchmark, plus the orthogonal riders (#6 GHA browser preflight, #10 in-process-only docs, the extract_client chunk-overlap fix).

**Architecture:** New `ingest/lib/supercrawl4ai.py` reuses the crawl4ai 0.9.0 in-process SDK and the existing client's browser/strategy pattern. A single `SuperConfig` dataclass drives one config-builder; `SuperConfig()` with no overrides reproduces the old client's plain capture (byte-identical invariant). Old client and all pipelines stay untouched.

**Tech Stack:** Python 3.12/3.13, `crawl4ai==0.9.0` (in-process SDK), `pytest`, `pandas`, `beautifulsoup4` (already deps). No new dependency.

## Global Constraints

- `crawl4ai==0.9.0`, **in-process SDK only**. crawl4ai is the ONLY crawl tool; never Firecrawl/Spider. (verbatim from spec §1)
- **Byte-identical invariant:** `SuperConfig()` default reproduces the old client; every new power is a default-off field. Building this module changes NO existing pipeline output. (spec §1)
- **Vendor-First:** all imports/fields verified live this session (crawl4ai 0.9.0). All symbols are top-level `from crawl4ai import ...`. Re-confirm if the pin moves.
- **Offline-only CI tests.** Pure-unit tests need no browser/network; browser tests use `raw://` HTML (no network) and run locally, mirroring the existing `ingest/tests/lib/test_crawl4ai_client.py` pattern. The benchmark is the **local battle-test, not a CI gate.** (spec §7)
- **Stealth jobs** (doctor preflight + hard-fail patchright smoke): `lee-permits-weekly`, `collier-permits-monthly`, `dbpr-sirs-monthly`, `ingest-crexi-listings`. **Non-stealth jobs** (doctor only): `news-swfl-ingest`, `dbpr-public-notices-weekly`, `marketbeat-pdf-ingest`. Re-confirm each job's classification by reading it before editing. (spec §6)
- **Phase 2 is OUT of scope:** no proof of `virtual_scroll`/`proxy` on a live target, no pipeline migration. Those fields are plumbed but exercised only on `raw://` fixtures here. (spec §5)
- **RULE 1:** lib + YAML additions, no live `/api`/MCP/`data_lake.*` write. Show the diff; **do not push without approval** (operator standing decree). `SESSION_LOG.md` entry required at push time.

## File Structure

- Create `ingest/lib/supercrawl4ai.py` — module: `SuperConfig`, `SuperTable`, `SuperResult`, config builders, `fetch_super`, `fetch_many_super`, `fetch_tables`.
- Create `ingest/tests/lib/test_supercrawl4ai.py` — offline tests (pure-unit + `raw://` browser).
- Create `ingest/lib/supercrawl4ai_bench.py` — prove-it benchmark (tiers 1–3, offline `raw://`).
- Modify `ingest/lib/crawl4ai_client.py` — module docstring only (#10).
- Modify `ingest/lib/extract_client.py` — `_chunk_text` overlap + dedup in `_llm_extract_rows`.
- Modify `ingest/tests/lib/test_extract_client.py` — add chunk-overlap/dedup tests.
- Modify `docs/audit/2026-06-20-crawl4ai/HANDOFF.md` + `research.md` — correcting notes (#10).
- Modify 7 `.github/workflows/*.yml` — browser preflight (#6).

---

### Task 1: Module skeleton + data types

**Files:**
- 🔴 Create: `ingest/lib/supercrawl4ai.py`
- 🔴 Test: `ingest/tests/lib/test_supercrawl4ai.py`

**Interfaces:**
- Produces: `SuperConfig` (dataclass, all fields default-off per spec §2.1), `SuperTable(headers, rows, caption, metadata)` with `.to_dataframe()`, `SuperResult(url, success, html, markdown, fit_markdown, links, tables, error, dispatch)`.

- [ ] **Step 1: Write the failing test**

```python
# ingest/tests/lib/test_supercrawl4ai.py
from ingest.lib.supercrawl4ai import SuperConfig, SuperTable, SuperResult


def test_superconfig_defaults_are_all_off():
    c = SuperConfig()
    assert c.fit_markdown is False and c.tables is False and c.remove_overlays is False
    assert c.scan_full_page is False and c.virtual_scroll is None and c.proxy is None
    assert c.stealth is False and c.jitter == (0.0, 0.0) and c.table_score_threshold == 7


def test_supertable_to_dataframe():
    t = SuperTable(headers=["a", "b"], rows=[["1", "2"], ["3", "4"]], caption="cap")
    df = t.to_dataframe()
    assert list(df.columns) == ["a", "b"]
    assert df.shape == (2, 2)
    assert df.attrs["caption"] == "cap"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingest.lib.supercrawl4ai'`

- [ ] **Step 3: Write minimal implementation** (the module docstring + the three dataclasses)

```python
# ingest/lib/supercrawl4ai.py
"""supercrawl4ai — enhanced in-process crawl layer over crawl4ai_client.py.

The old ingest/lib/crawl4ai_client.py is the STABLE BASE — untouched, the workhorse for every
shipped pipeline. supercrawl4ai is the ENHANCED SURFACE: same crawl4ai 0.9.0 in-process SDK, plus
opt-in powers (deterministic table capture, fit-markdown denoise, virtual-scroll, residential proxy
egress, memory-adaptive hardening, dispatch telemetry).

INVARIANT: SuperConfig() with no overrides reproduces the old client's plain capture. Every new
power is a default-off field. Building this module changes NO existing pipeline's output.

IN-PROCESS ONLY: stealth/interactive crawling can never move to the 0.9.0 remote server (it
400-rejects js_code/proxy/cookies over the network). supercrawl4ai is in-process SDK, like the base.

Phase 1 (this module): fetch_super / fetch_many_super / fetch_tables + the SuperConfig surface.
Phase 2 (separate spec): prove virtual_scroll + proxy on the live Crexi grid, migrate crexi over.
"""
from __future__ import annotations

import asyncio
import inspect
import os
from dataclasses import dataclass, field
from typing import Iterable, Optional

from crawl4ai import (
    AsyncWebCrawler,
    BrowserConfig,
    CacheMode,
    CrawlerMonitor,
    CrawlerRunConfig,
    DefaultMarkdownGenerator,
    MemoryAdaptiveDispatcher,
    ProxyConfig,
    PruningContentFilter,
    RateLimiter,
    UndetectedAdapter,
    VirtualScrollConfig,
)
from crawl4ai.async_crawler_strategy import AsyncPlaywrightCrawlerStrategy

from ingest.lib.crawl4ai_client import Crawl4aiError  # re-export the shared error type


@dataclass
class SuperConfig:
    # content shaping (off => byte-identical capture)
    fit_markdown: bool = False
    tables: bool = False
    remove_overlays: bool = False
    scan_full_page: bool = False
    max_scroll_steps: Optional[int] = None
    scroll_delay: float = 0.2
    virtual_scroll: Optional[VirtualScrollConfig] = None
    # identity / egress  [PROVE: Phase 2]
    stealth: bool = False
    proxy: Optional[str] = None
    # throughput / safety
    concurrency: int = 5
    jitter: tuple[float, float] = (0.0, 0.0)  # (mean_delay, max_range)
    memory_threshold_percent: float = 85.0
    monitor: bool = False
    # fetch tuning
    wait_for: Optional[str] = None
    timeout_ms: int = 60_000
    table_score_threshold: int = 7


@dataclass
class SuperTable:
    headers: list[str]
    rows: list[list]
    caption: str = ""
    metadata: dict = field(default_factory=dict)

    def to_dataframe(self):
        import pandas as pd
        df = pd.DataFrame(self.rows, columns=self.headers or None)
        df.attrs["caption"] = self.caption
        df.attrs["metadata"] = self.metadata
        return df


@dataclass
class SuperResult:
    url: str
    success: bool
    html: str = ""
    markdown: str = ""       # raw_markdown — always present (== old behaviour)
    fit_markdown: str = ""   # only when cfg.fit_markdown
    links: list[str] = field(default_factory=list)
    tables: list[SuperTable] = field(default_factory=list)
    error: Optional[str] = None
    dispatch: Optional[dict] = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add ingest/lib/supercrawl4ai.py ingest/tests/lib/test_supercrawl4ai.py
git commit -m "feat(crawl4ai): supercrawl4ai module skeleton + data types"
```

---

### Task 2: Config builders (the byte-identical heart)

**Files:**
- 🔴 Modify: `ingest/lib/supercrawl4ai.py` (add `_proxy_config`, `_browser_config`, `_run_config`)
- 🔴 Test: `ingest/tests/lib/test_supercrawl4ai.py`

**Interfaces:**
- Consumes: `SuperConfig`.
- Produces: `_run_config(cfg) -> CrawlerRunConfig`, `_browser_config(cfg) -> BrowserConfig`, `_proxy_config(cfg) -> ProxyConfig | None`.

- [ ] **Step 1: Write the failing test**

```python
from ingest.lib.supercrawl4ai import SuperConfig, _run_config, _browser_config


def test_default_run_config_is_neutral():
    cfg = _run_config(SuperConfig())
    assert cfg.scan_full_page is False
    assert cfg.remove_overlay_elements is False
    assert cfg.virtual_scroll_config is None
    assert cfg.markdown_generator is None  # no fit filter by default
    assert cfg.proxy_config is None


def test_fit_markdown_attaches_pruning_filter():
    cfg = _run_config(SuperConfig(fit_markdown=True))
    assert cfg.markdown_generator is not None


def test_jitter_only_set_when_nonzero():
    assert _run_config(SuperConfig()).mean_delay in (0, 0.0)
    j = _run_config(SuperConfig(jitter=(2.0, 1.0)))
    assert j.mean_delay == 2.0 and j.max_range == 1.0


def test_stealth_browser_flag():
    assert _browser_config(SuperConfig()).enable_stealth is False
    assert _browser_config(SuperConfig(stealth=True)).enable_stealth is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py -q -k "run_config or jitter or stealth_browser"`
Expected: FAIL — `ImportError: cannot import name '_run_config'`

- [ ] **Step 3: Write minimal implementation** (append to `supercrawl4ai.py`)

```python
def _proxy_config(cfg: SuperConfig) -> Optional[ProxyConfig]:
    raw = cfg.proxy or os.environ.get("CRAWL4AI_PROXY")
    return ProxyConfig.from_string(raw) if raw else None


def _browser_config(cfg: SuperConfig) -> BrowserConfig:
    return BrowserConfig(headless=True, enable_stealth=cfg.stealth)


def _run_config(cfg: SuperConfig, *, session_id: Optional[str] = None) -> CrawlerRunConfig:
    # Every field below defaults to crawl4ai's own default, so SuperConfig() == the old client's
    # CrawlerRunConfig(cache_mode=BYPASS, delay_before_return_html=1.0). Byte-identical invariant.
    kwargs = dict(
        cache_mode=CacheMode.BYPASS,
        wait_for=cfg.wait_for,
        page_timeout=cfg.timeout_ms,
        delay_before_return_html=1.0,
        scan_full_page=cfg.scan_full_page,
        scroll_delay=cfg.scroll_delay,
        remove_overlay_elements=cfg.remove_overlays,
        table_score_threshold=cfg.table_score_threshold,
    )
    if cfg.max_scroll_steps is not None:
        kwargs["max_scroll_steps"] = cfg.max_scroll_steps
    if cfg.virtual_scroll is not None:
        kwargs["virtual_scroll_config"] = cfg.virtual_scroll
    if cfg.fit_markdown:
        kwargs["markdown_generator"] = DefaultMarkdownGenerator(content_filter=PruningContentFilter())
    mean_delay, max_range = cfg.jitter
    if mean_delay or max_range:
        kwargs["mean_delay"] = mean_delay
        kwargs["max_range"] = max_range
    proxy = _proxy_config(cfg)
    if proxy is not None:
        kwargs["proxy_config"] = proxy
    if session_id:
        kwargs["session_id"] = session_id
    return CrawlerRunConfig(**kwargs)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py -q`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add ingest/lib/supercrawl4ai.py ingest/tests/lib/test_supercrawl4ai.py
git commit -m "feat(crawl4ai): supercrawl4ai config builders (byte-identical default)"
```

---

### Task 3: `fetch_super` + result mapping

**Files:**
- 🔴 Modify: `ingest/lib/supercrawl4ai.py` (add `_to_super_result`, `_fetch_super_async`, `fetch_super`)
- 🔴 Test: `ingest/tests/lib/test_supercrawl4ai.py`

**Interfaces:**
- Consumes: `_run_config`, `_browser_config`, `SuperResult`, `SuperTable`.
- Produces: `fetch_super(url, cfg=None) -> SuperResult`, `_to_super_result(url, r, want_tables, want_fit) -> SuperResult`.

- [ ] **Step 1: Write the failing test** (browser test on `raw://`, mirrors existing client test)

```python
import pytest
from ingest.lib.supercrawl4ai import SuperConfig, fetch_super

_PAGE = "raw://<html><body><h1>Estero</h1><p>retail space</p><a href='https://x.test/1'>more</a></body></html>"


def test_fetch_super_returns_html_and_markdown():
    res = fetch_super(_PAGE)
    assert res.success is True
    assert "Estero" in res.html
    assert "Estero" in res.markdown
    assert res.fit_markdown == ""  # not requested


def test_fetch_super_collects_links_and_tables_when_asked():
    res = fetch_super(_PAGE, SuperConfig(tables=True))
    assert any("x.test/1" in u for u in res.links)
    assert res.tables == []  # no <table> on this page
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py -q -k fetch_super`
Expected: FAIL — `ImportError: cannot import name 'fetch_super'`

- [ ] **Step 3: Write minimal implementation** (append)

```python
def _strategy(cfg: SuperConfig, bc: BrowserConfig) -> AsyncPlaywrightCrawlerStrategy:
    if cfg.stealth:
        return AsyncPlaywrightCrawlerStrategy(browser_adapter=UndetectedAdapter(), browser_config=bc)
    return AsyncPlaywrightCrawlerStrategy(browser_config=bc)


def _to_super_result(url: str, r, want_tables: bool, want_fit: bool) -> SuperResult:
    if not getattr(r, "success", False):
        return SuperResult(url=url, success=False, error=getattr(r, "error_message", "?"))
    md = getattr(r, "markdown", None)
    if md is None:
        raw_md, fit_md = "", ""
    elif hasattr(md, "raw_markdown"):
        raw_md = md.raw_markdown or ""
        fit_md = (getattr(md, "fit_markdown", "") or "") if want_fit else ""
    else:
        raw_md, fit_md = str(md), ""
    links: list[str] = []
    raw_links = getattr(r, "links", None) or {}
    if isinstance(raw_links, dict):
        for group in raw_links.values():
            for item in group or []:
                href = item.get("href") if isinstance(item, dict) else None
                if href:
                    links.append(href)
    tables: list[SuperTable] = []
    if want_tables:
        for t in (getattr(r, "tables", None) or []):
            if isinstance(t, dict):
                tables.append(SuperTable(
                    headers=t.get("headers") or [],
                    rows=t.get("rows") or [],
                    caption=t.get("caption") or "",
                    metadata=t.get("metadata") or {},
                ))
    dispatch = None
    dr = getattr(r, "dispatch_result", None)
    if dr is not None:
        dispatch = {"memory_usage": getattr(dr, "memory_usage", None),
                    "peak_memory": getattr(dr, "peak_memory", None)}
    return SuperResult(url=url, success=True, html=r.html or "", markdown=raw_md,
                       fit_markdown=fit_md, links=links, tables=tables, dispatch=dispatch)


async def _fetch_super_async(url: str, cfg: SuperConfig) -> SuperResult:
    bc = _browser_config(cfg)
    strategy = _strategy(cfg, bc)
    async with AsyncWebCrawler(crawler_strategy=strategy, config=bc) as crawler:
        r = await crawler.arun(url=url, config=_run_config(cfg))
    return _to_super_result(url, r, cfg.tables, cfg.fit_markdown)


def fetch_super(url: str, cfg: Optional[SuperConfig] = None) -> SuperResult:
    """Enhanced single fetch. cfg=None reproduces the old client's plain capture."""
    return asyncio.run(_fetch_super_async(url, cfg or SuperConfig()))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py -q -k fetch_super`
Expected: PASS (2 passed) — requires a local headless Chromium (already installed).

- [ ] **Step 5: Commit**

```bash
git add ingest/lib/supercrawl4ai.py ingest/tests/lib/test_supercrawl4ai.py
git commit -m "feat(crawl4ai): supercrawl4ai fetch_super + result mapping"
```

---

### Task 4: `fetch_tables` (the #9 deterministic helper)

**Files:**
- 🔴 Modify: `ingest/lib/supercrawl4ai.py` (add `fetch_tables`)
- 🔴 Test: `ingest/tests/lib/test_supercrawl4ai.py`

**Interfaces:**
- Consumes: `fetch_super`, `SuperTable`.
- Produces: `fetch_tables(url, *, stealth=False, score_threshold=7, min_rows=1, min_cols=1) -> list[SuperTable]`.

- [ ] **Step 1: Write the failing test** (`raw://` table fixture — deterministic, zero-LLM)

```python
from ingest.lib.supercrawl4ai import fetch_tables

_TABLE_PAGE = (
    "raw://<html><body><table>"
    "<tr><th>City</th><th>PSF</th></tr>"
    "<tr><td>Estero</td><td>28</td></tr>"
    "<tr><td>Fort Myers Beach</td><td>34</td></tr>"
    "</table></body></html>"
)


def test_fetch_tables_parses_headers_and_rows():
    tables = fetch_tables(_TABLE_PAGE, score_threshold=1)
    assert len(tables) >= 1
    t = tables[0]
    assert t.headers == ["City", "PSF"]
    assert ["Estero", "28"] in t.rows
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py -q -k fetch_tables`
Expected: FAIL — `ImportError: cannot import name 'fetch_tables'`

- [ ] **Step 3: Write minimal implementation** (append)

```python
def fetch_tables(url: str, *, stealth: bool = False, score_threshold: int = 7,
                 min_rows: int = 1, min_cols: int = 1) -> list[SuperTable]:
    """Deterministic, zero-LLM HTML table capture. Returns only the tables that clear the floors."""
    res = fetch_super(url, SuperConfig(tables=True, stealth=stealth,
                                       table_score_threshold=score_threshold))
    return [t for t in res.tables if len(t.rows) >= min_rows and len(t.headers) >= min_cols]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py -q -k fetch_tables`
Expected: PASS. If `headers`/`rows` shape differs from the assertion, print one `fetch_super(..., SuperConfig(tables=True))` result to confirm crawl4ai's `result.tables[0]` key names, then adjust the assertion (Vendor-First: trust the live object, not the doc).

- [ ] **Step 5: Commit**

```bash
git add ingest/lib/supercrawl4ai.py ingest/tests/lib/test_supercrawl4ai.py
git commit -m "feat(crawl4ai): fetch_tables — deterministic zero-LLM table capture"
```

---

### Task 5: `fetch_many_super` (hardened parallel)

**Files:**
- 🔴 Modify: `ingest/lib/supercrawl4ai.py` (add `_fetch_many_super_async`, `fetch_many_super`)
- 🔴 Test: `ingest/tests/lib/test_supercrawl4ai.py`

**Interfaces:**
- Consumes: `_run_config`, `_browser_config`, `_strategy`, `_to_super_result`.
- Produces: `fetch_many_super(urls, cfg=None) -> dict[str, SuperResult]`.

- [ ] **Step 1: Write the failing test**

```python
from ingest.lib.supercrawl4ai import fetch_many_super

_P1 = "raw://<html><body><h1>one</h1></body></html>"
_P2 = "raw://<html><body><h1>two</h1></body></html>"


def test_fetch_many_super_returns_result_per_url():
    out = fetch_many_super([_P1, _P2])
    assert set(out.keys()) >= {_P1, _P2}
    assert all(isinstance(v.success, bool) for v in out.values())
    assert any("one" in v.html for v in out.values())


def test_fetch_many_super_empty_input():
    assert fetch_many_super([]) == {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py -q -k fetch_many`
Expected: FAIL — `ImportError: cannot import name 'fetch_many_super'`

- [ ] **Step 3: Write minimal implementation** (append)

```python
async def _fetch_many_super_async(urls: list[str], cfg: SuperConfig) -> dict[str, SuperResult]:
    if not urls:
        return {}
    bc = _browser_config(cfg)
    strategy = _strategy(cfg, bc)
    disp_kwargs = dict(
        max_session_permit=cfg.concurrency,
        memory_threshold_percent=cfg.memory_threshold_percent,
        rate_limiter=RateLimiter(base_delay=(1.0, 3.0), max_delay=60.0, max_retries=3,
                                 rate_limit_codes=[429, 503]),
    )
    if cfg.monitor and "monitor" in inspect.signature(MemoryAdaptiveDispatcher.__init__).parameters:
        disp_kwargs["monitor"] = CrawlerMonitor()
    dispatcher = MemoryAdaptiveDispatcher(**disp_kwargs)
    out: dict[str, SuperResult] = {}
    async with AsyncWebCrawler(crawler_strategy=strategy, config=bc) as crawler:
        results = await crawler.arun_many(urls=urls, config=_run_config(cfg), dispatcher=dispatcher)
        for r in results:
            u = getattr(r, "url", "") or ""
            out[u] = _to_super_result(u, r, cfg.tables, cfg.fit_markdown)
    for u in urls:  # guarantee every requested url is present
        out.setdefault(u, SuperResult(url=u, success=False, error="no result returned"))
    return out


def fetch_many_super(urls: Iterable[str], cfg: Optional[SuperConfig] = None) -> dict[str, SuperResult]:
    """Parallel enhanced fetch via a memory-adaptive dispatcher. Keys by resolved url."""
    return asyncio.run(_fetch_many_super_async(list(urls), cfg or SuperConfig()))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py -q`
Expected: PASS (all). Note: `raw://` urls may be returned by the crawler with a normalized key — the `setdefault` loop guarantees the exact requested keys are present, so `set(out.keys()) >= {_P1,_P2}` holds.

- [ ] **Step 5: Commit**

```bash
git add ingest/lib/supercrawl4ai.py ingest/tests/lib/test_supercrawl4ai.py
git commit -m "feat(crawl4ai): fetch_many_super — dispatcher-hardened parallel fetch"
```

---

### Task 6: Prove-it benchmark (tiers 1–3, offline)

**Files:**
- Create: `ingest/lib/supercrawl4ai_bench.py`

**Interfaces:**
- Consumes: `fetch_tables`, `fetch_super`, `fetch_many_super`, `SuperConfig`.

- [ ] **Step 1: Write the benchmark** (a runnable script; no unit test — it IS the battle-test)

```python
# ingest/lib/supercrawl4ai_bench.py
"""Prove-it benchmark for supercrawl4ai — runs old-vs-super on raw:// fixtures (offline).

Run: python -m ingest.lib.supercrawl4ai_bench
Tiers: (1) deterministic table capture, (2) fit-vs-raw markdown denoise, (3) concurrency safety.
Tier 4 (live Crexi yield A/B from a home IP/VPN) is Phase 2 — not here.
"""
from ingest.lib.supercrawl4ai import SuperConfig, fetch_super, fetch_tables, fetch_many_super

_TABLE = ("raw://<html><body><table><tr><th>City</th><th>PSF</th></tr>"
          "<tr><td>Estero</td><td>28</td></tr><tr><td>FMB</td><td>34</td></tr></table></body></html>")
_NOISY = ("raw://<html><body><nav>HOME ABOUT CONTACT</nav>"
          "<article><h1>SWFL retail</h1><p>Asking rents firmed this quarter.</p>"
          "<a href='https://x.test/a'>read</a></article><footer>(c) 2026 ads ads ads</footer></body></html>")


def tier1_tables():
    t = fetch_tables(_TABLE, score_threshold=1)
    print(f"[tier1] tables={len(t)} headers={t[0].headers if t else None} rows={t[0].rows if t else None}")


def tier2_fit_vs_raw():
    raw = fetch_super(_NOISY)
    fit = fetch_super(_NOISY, SuperConfig(fit_markdown=True))
    print(f"[tier2] raw_md={len(raw.markdown)}ch  fit_md={len(fit.fit_markdown)}ch  "
          f"reduction={1 - len(fit.fit_markdown)/max(1,len(raw.markdown)):.0%}  "
          f"body_kept={'SWFL retail' in (fit.fit_markdown or raw.markdown)}")


def tier3_concurrency():
    out = fetch_many_super([_TABLE, _NOISY, _TABLE], SuperConfig(monitor=True, concurrency=3))
    ok = sum(1 for v in out.values() if v.success)
    peak = [v.dispatch.get("peak_memory") for v in out.values() if v.dispatch]
    print(f"[tier3] urls={len(out)} ok={ok} dispatch_peak_memory={peak}")


if __name__ == "__main__":
    tier1_tables()
    tier2_fit_vs_raw()
    tier3_concurrency()
```

- [ ] **Step 2: Run it**

Run: `python -m ingest.lib.supercrawl4ai_bench`
Expected: three `[tierN]` lines; tier1 shows headers `['City','PSF']`; tier2 shows a reduction % and `body_kept=True`; tier3 shows `ok=3`.

- [ ] **Step 3: Commit**

```bash
git add ingest/lib/supercrawl4ai_bench.py
git commit -m "feat(crawl4ai): supercrawl4ai prove-it benchmark (tiers 1-3, offline)"
```

---

### Task 7: #10 — in-process-only docs + landmine

**Files:**
- Modify: `ingest/lib/crawl4ai_client.py` (module docstring, top of file)
- Modify: `docs/audit/2026-06-20-crawl4ai/HANDOFF.md`, `docs/audit/2026-06-20-crawl4ai/research.md` (correcting notes — append, never delete)

- [ ] **Step 1: Confirm zero live consumers**

Run: `git grep -n "CRAWL4AI_API_URL" -- '*.ts' '*.py' ':!.claude/'`
Expected: no output (the only matches are stale `.claude/worktrees/` copies, excluded).

- [ ] **Step 2: Add the canonical paragraph to `crawl4ai_client.py`** — extend the existing module docstring (after the "Three surfaces" block) with:

```python
# (inside the existing module docstring, appended)
#
# RUNTIME MODE — IN-PROCESS SDK ONLY (verified 2026-06-21). crawl4ai runs here only as the
# in-process Python SDK. There is NO live remote-server consumer: the former email
# data-readiness ladder (CRAWL4AI_API_URL -> /search) was replaced by Anthropic web_search on
# 2026-06-21 (commit 32b4eb5b), and CRAWL4AI_API_URL is now referenced nowhere in the live tree.
# LANDMINE: stealth/interactive crawling can NEVER move to the 0.9.0 remote server. The server
# rejects js_code / js_code_before_wait / proxy / proxy_config / cookies / extra_args /
# simulate_user / magic over the network with HTTP 400 (deploy/docker/MIGRATION.md), and
# Crawl4aiSession.step depends on js_code_before_wait. Do not "consolidate onto the server".
# The enhanced surface (ingest/lib/supercrawl4ai.py) is also in-process SDK — same constraint.
```

- [ ] **Step 3: Append correcting notes to the 06-20 audit docs**

In `docs/audit/2026-06-20-crawl4ai/HANDOFF.md`, append at the bottom:

```markdown
---
## CORRECTION (2026-06-21): the remote-server row is now stale
`CRAWL4AI_API_URL` is consumed NOWHERE in the live tree. The dead `/search` ladder (#1) was
replaced by Anthropic `web_search` (commit 32b4eb5b). crawl4ai here is **in-process SDK only**;
there is no remote-server consumer to document. See `crawl4ai_client.py` module docstring +
`docs/superpowers/specs/2026-06-21-supercrawl4ai-design.md`.
```

In `docs/audit/2026-06-20-crawl4ai/research.md`, append the same correction block at the bottom.

- [ ] **Step 4: Commit**

```bash
git add ingest/lib/crawl4ai_client.py docs/audit/2026-06-20-crawl4ai/HANDOFF.md docs/audit/2026-06-20-crawl4ai/research.md
git commit -m "docs(crawl4ai): record in-process-only runtime + remote-server landmine (#10)"
```

---

### Task 8: extract_client chunk-overlap + dedup (free-win)

**Files:**
- Modify: `ingest/lib/extract_client.py` (`_chunk_text` adds overlap; `_llm_extract_rows` dedups merged rows)
- Test: `ingest/tests/lib/test_extract_client.py`

**Interfaces:**
- Consumes/Produces: `_chunk_text(text, *, size=_CHUNK_CHARS, overlap=...) -> list[str]`, `_dedup_rows(rows) -> list[dict]`.

- [ ] **Step 1: Write the failing test**

```python
# add to ingest/tests/lib/test_extract_client.py
from ingest.lib.extract_client import _chunk_text, _dedup_rows


def test_chunk_text_overlaps_boundary():
    text = "\n".join(f"row {i}" for i in range(4000))  # forces multiple chunks
    chunks = _chunk_text(text, size=2000)
    assert len(chunks) >= 2
    # the tail of chunk 0 reappears at the head of chunk 1 (overlap)
    tail = chunks[0].split("\n")[-1]
    assert tail in chunks[1].split("\n")


def test_dedup_rows_drops_identical_records():
    rows = [{"a": 1}, {"a": 1}, {"a": 2}]
    assert _dedup_rows(rows) == [{"a": 1}, {"a": 2}]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest ingest/tests/lib/test_extract_client.py -q -k "overlap or dedup"`
Expected: FAIL — `ImportError: cannot import name '_dedup_rows'` (and `_chunk_text` signature lacks `overlap`).

- [ ] **Step 3: Write minimal implementation**

Replace `_chunk_text` in `ingest/lib/extract_client.py` with an overlap-aware version, and add `_dedup_rows`:

```python
_OVERLAP_FRAC = 0.1  # carry ~10% of the prior chunk's tail so a boundary-straddling row survives


def _chunk_text(text: str, *, size: int = _CHUNK_CHARS, overlap: float = _OVERLAP_FRAC) -> list[str]:
    """Split on paragraph boundaries; carry an ~overlap tail into the next chunk. No truncation."""
    if len(text) <= size:
        return [text]
    overlap_chars = int(size * overlap)
    chunks: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for para in text.split("\n"):
        if cur and cur_len + len(para) + 1 > size:
            chunks.append("\n".join(cur))
            # seed the next chunk with the trailing paragraphs (~overlap_chars) of the flushed one
            tail: list[str] = []
            tail_len = 0
            for p in reversed(cur):
                if tail_len + len(p) + 1 > overlap_chars:
                    break
                tail.insert(0, p)
                tail_len += len(p) + 1
            cur, cur_len = list(tail), tail_len
        cur.append(para)
        cur_len += len(para) + 1
    if cur:
        chunks.append("\n".join(cur))
    return chunks


def _dedup_rows(rows: list[dict]) -> list[dict]:
    """Drop exact-duplicate row dicts introduced by chunk overlap, preserving order."""
    import json
    seen: set[str] = set()
    out: list[dict] = []
    for r in rows:
        key = json.dumps(r, sort_keys=True, default=str)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out
```

Then in `_llm_extract_rows`, dedup before returning:

```python
        rows.extend(_parse_rows(msg.content[0].text))
    return _dedup_rows(rows)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest ingest/tests/lib/test_extract_client.py -q`
Expected: PASS (all — existing scrape_with_fallback tests still green).

- [ ] **Step 5: Commit**

```bash
git add ingest/lib/extract_client.py ingest/tests/lib/test_extract_client.py
git commit -m "fix(crawl4ai): chunk overlap + row dedup in extract_client (no boundary drops)"
```

---

### Task 9: #6 — browser preflight across the 7 crawl crons

**Files:**
- Modify (stealth — doctor + hard-fail patchright smoke): `.github/workflows/lee-permits-weekly.yml`, `collier-permits-monthly.yml`, `dbpr-sirs-monthly.yml`, `ingest-crexi-listings.yml`
- Modify (non-stealth — doctor only): `.github/workflows/news-swfl-ingest.yml`, `dbpr-public-notices-weekly.yml`, `marketbeat-pdf-ingest.yml`

- [ ] **Step 1: Re-confirm each job's classification**

Run: `git grep -nE "UndetectedAdapter|Crawl4aiSession|patchright install|crawl4ai-setup" -- ingest/pipelines .github/workflows`
Expected: the 4 stealth jobs' pipelines use `Crawl4aiSession`/`UndetectedAdapter` and their YAML installs `patchright`; the 3 non-stealth do not. If a job's classification differs from the list above, follow the evidence, not the list.

- [ ] **Step 2: Insert the preflight in each STEALTH workflow** — after the last browser-install step (e.g. `lee-permits-weekly.yml` after line 42, `ingest-crexi-listings.yml` after line 42), before the "Run …" step:

```yaml
      - name: crawl4ai preflight (advisory)
        continue-on-error: true
        run: crawl4ai-doctor

      - name: patchright stealth smoke (required)
        run: python -c "from patchright.async_api import async_playwright; print('patchright ok')"
```

- [ ] **Step 3: Insert the preflight in each NON-STEALTH workflow** — after its browser-install step (`news-swfl-ingest.yml` after line 34; the dbpr-public-notices/marketbeat `playwright install` step), before "Run …":

```yaml
      - name: crawl4ai preflight (advisory)
        continue-on-error: true
        run: crawl4ai-doctor
```

- [ ] **Step 4: Sanity-check YAML**

Run: `python -c "import yaml,glob; [yaml.safe_load(open(f,encoding='utf-8')) for f in glob.glob('.github/workflows/*.yml')]; print('yaml ok')"`
Expected: `yaml ok` (no parse error).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/lee-permits-weekly.yml .github/workflows/collier-permits-monthly.yml .github/workflows/dbpr-sirs-monthly.yml .github/workflows/ingest-crexi-listings.yml .github/workflows/news-swfl-ingest.yml .github/workflows/dbpr-public-notices-weekly.yml .github/workflows/marketbeat-pdf-ingest.yml
git commit -m "ci(crawl4ai): fail-fast browser preflight + patchright smoke across crawl crons (#6)"
```

---

## Post-implementation (not a task — gates before push)

- Run the full crawl4ai/extract test subset: `python -m pytest ingest/tests/lib/test_supercrawl4ai.py ingest/tests/lib/test_extract_client.py ingest/tests/lib/test_crawl4ai_client.py -q` → all green.
- Run the benchmark once and paste its output into the SESSION_LOG entry (prod-ish evidence).
- Confirm the old client's tests are unchanged + green (byte-identical proof).
- Append a top-of-file `SESSION_LOG.md` entry; reconcile `checks` (`supercrawl4ai_built`, `crawl4ai_doctor_preflight`).
- **Show the diff and get approval before `node scripts/safe-push.mjs`** (operator no-autonomous-push). The doctor `continue-on-error: true` flips to hard-fail only after one green `workflow_dispatch` confirms exit codes on a clean runner.

## Self-Review

- **Spec coverage:** §2 types/builders → T1–T2; `fetch_super`/`fetch_many_super`/`fetch_tables` → T3–T5; §4 benchmark → T6; §6 doctor/patchright → T9; §10 docs/landmine → T7; §6 free-win chunk-overlap → T8. Phase 2 (virtual_scroll/proxy proof, crexi migration) correctly absent. ✓
- **Placeholder scan:** none — every code/test/command step is concrete. The one "verify the live object shape" note in T4 is a Vendor-First fallback with an explicit action, not a TODO. ✓
- **Type consistency:** `SuperConfig`/`SuperResult`/`SuperTable` names + fields identical across T1→T6; `_run_config`/`_browser_config`/`_strategy`/`_to_super_result` signatures consistent T2→T5. ✓

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 1, Task 2, Task 3, Task 4, Task 5 | `ingest/lib/supercrawl4ai.py`, `ingest/tests/lib/test_supercrawl4ai.py` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
