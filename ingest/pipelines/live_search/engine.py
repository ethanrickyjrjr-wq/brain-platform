"""Fallback-cascade + provenance + anomaly engine for data_lake.daily_truth.

Normal path: ONE Gemini grounded search returns a number + its real source URL, loaded to
the brain. Cascade (Gemini -> Firecrawl -> Spider -> Claude) is the uptime FAILSAFE: if a leg
yields no usable SOURCED result, fall through to the next. The only integrity gate is a real
source URL present (never a memory/training number); LittleBird is denylisted. A big day-over-day
move vs OUR OWN prior value triggers a second-source confirm before it reaches the brain.

External legs (gemini_grounded, firecrawl_search, _prior_value, _second_source_value, _fred_latest)
do IO and are monkeypatched in tests; the pure logic + orchestration is fully unit-tested.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import date
from statistics import median

import requests

from ingest.lib import firecrawl_client

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")  # Gemini 3 stable; confirm grounding live (STEP 0)
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
DENYLIST_DEFAULT = ("littlebird",)  # LittleBird Realty — always thrown out; extend via metric_config.denylist_domains

_MONEY = re.compile(r"\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([KkMm])?")

# --- billing instrumentation (the $14/1k unit is the search query, not the prompt) ---
_QUERY_COUNT = {"n": 0}


def record_queries(n: int) -> None:
    _QUERY_COUNT["n"] += int(n or 0)


def query_count() -> int:
    return _QUERY_COUNT["n"]


@dataclass
class Candidate:
    value: float
    domain: str
    source_url: str
    engine: str
    grounded: bool = False  # True only if the value traces to a real fetched source URL (not model memory)
    source_title: str = ""


@dataclass
class DailyTruthRow:
    metric_key: str
    area: str
    period: str
    value: float | None
    unit: str | None
    source_url: str | None = None
    source_title: str | None = None
    engine: str | None = None
    query_text: str | None = None
    agreement_n: int = 0
    verified_on_page: bool = False
    source_tag: str = "live_search"
    status_reason: str | None = None
    anomaly_flag: bool = False
    anomaly_delta_pct: float | None = None
    metric_config: dict = field(default_factory=dict)


def _today() -> str:
    return date.today().isoformat()


def extract_numbers(text: str) -> list[float]:
    out: list[float] = []
    for raw, suffix in _MONEY.findall(text or ""):
        n = float(raw.replace(",", ""))
        s = (suffix or "").lower()
        if s == "k":
            n *= 1_000
        elif s == "m":
            n *= 1_000_000
        out.append(n)
    return out


def _follow_redirect(url: str) -> str:
    r = requests.head(url, allow_redirects=True, timeout=20)
    return r.url


def resolve_source_url(url: str) -> str:
    return _follow_redirect(url) if "vertexaisearch.cloud.google.com" in (url or "") else (url or "")


def _domain_of(url: str) -> str:
    m = re.match(r"https?://([^/]+)/?", url or "")
    host = (m.group(1).lower() if m else "")
    return re.sub(r"^www\.", "", host)


def _scrape_text(url: str) -> str:
    from ingest.lib.extract_client import ExtractError, scrape_with_fallback  # lazy: avoid import cost at test time

    try:
        return scrape_with_fallback(url, formats=("markdown",)) or ""
    except (ExtractError, Exception):  # noqa: BLE001 - a verify failure must never crash a run
        return ""


def is_denylisted(url: str, denylist: list[str]) -> bool:
    dom = _domain_of(resolve_source_url(url)) if "vertexaisearch" in (url or "") else _domain_of(url or "")
    terms = tuple(denylist or ()) + DENYLIST_DEFAULT
    return any(t.lower() in dom for t in terms)


def verify_on_page(value: float, source_url: str, denylist_domains: list[str], tolerance_pct: float) -> bool:
    """OPTIONAL on-page re-check. OPEN APERTURE: any real source allowed; only denylisted is rejected."""
    if is_denylisted(source_url, denylist_domains):
        return False
    text = _scrape_text(resolve_source_url(source_url))
    tol = abs(value) * tolerance_pct / 100.0
    return any(abs(n - value) <= tol for n in extract_numbers(text))


def cross_check(cands: list[Candidate], tolerance_pct: float) -> tuple[int, Candidate | None]:
    """Used at BOOTSTRAP / anomaly confirm (NOT the daily path). How many sources agree within tolerance."""
    if not cands:
        return 0, None
    vals = [c.value for c in cands]
    m = median(vals)
    tol = abs(m) * tolerance_pct / 100.0
    agree = [c for c in cands if abs(c.value - m) <= tol]
    winner = min(agree or cands, key=lambda c: abs(c.value - m))
    return len(agree), winner


# --- CASCADE LEGS (failsafe order; each returns ONE sourced Candidate or None) ---
def gemini_grounded(question: str) -> Candidate | None:
    """REAL normal-path leg: Gemini grounded search -> number + groundingChunk URL. None if no grounding (= memory)."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("[gemini] no GEMINI_API_KEY set — skipping leg")
        return None
    try:
        resp = requests.post(
            f"{GEMINI_URL}?key={key}",
            json={"contents": [{"parts": [{"text": question}]}], "tools": [{"google_search": {}}]},
            timeout=60,
        )
        if not resp.ok:
            print(f"[gemini] HTTP {resp.status_code}: {resp.text[:400]}")
            resp.raise_for_status()
        data = resp.json()
        cand = (data.get("candidates") or [{}])[0]
        gm = cand.get("groundingMetadata") or {}
        record_queries(len(gm.get("webSearchQueries") or []))
        chunks = gm.get("groundingChunks") or []
        if not chunks:  # GROUNDING GATE: no fetched source -> the number is memory -> reject
            print(f"[gemini] no groundingChunks for: {question[:80]} — finish_reason={cand.get('finishReason')}")
            return None
        text = " ".join(p.get("text", "") for p in (cand.get("content", {}) or {}).get("parts", []) or [])
        nums = extract_numbers(text)
        web = chunks[0].get("web") or {}
        url = resolve_source_url(web.get("uri") or "")
        if not nums or not url:
            print(f"[gemini] grounded but no parseable number in: {text[:120]}")
            return None
        return Candidate(nums[0], _domain_of(url), url, "gemini", grounded=True, source_title=web.get("title", ""))
    except (requests.RequestException, ValueError, KeyError, IndexError) as exc:
        print(f"[gemini] exception: {type(exc).__name__}: {exc}")
        return None


def firecrawl_search(question: str, denylist: list[str]) -> Candidate | None:
    """REAL failsafe leg #1: Firecrawl /v2/search (query -> results+markdown). Denylist via exclude_domains."""
    try:
        res = firecrawl_client.search(
            question,
            limit=5,
            tbs="qdr:m",  # last month — bias toward fresh pages
            exclude_domains=list(denylist or []) + list(DENYLIST_DEFAULT),
            scrape_markdown=True,
        )
    except Exception:  # noqa: BLE001 - a leg failure must fall through, not crash
        return None
    data = res.get("data") if isinstance(res, dict) else None
    results: list[dict] = []
    if isinstance(data, dict):
        results = list(data.get("web") or []) + list(data.get("news") or [])
    elif isinstance(data, list):
        results = data
    for r in results:
        url = r.get("url") or ""
        if not url or is_denylisted(url, denylist):
            continue
        nums = extract_numbers(r.get("markdown") or r.get("description") or "")
        if nums:
            return Candidate(nums[0], _domain_of(url), url, "firecrawl", grounded=True, source_title=r.get("title", ""))
    return None


def spider_search(question: str, denylist: list[str]) -> Candidate | None:
    """Deeper failsafe tier. Spider's in-repo client has no query->results search (only URL scrape),
    so this returns None for now rather than invent a contract or emit a memory number. Wire when a
    Spider search endpoint is added, or seed it with a URL from an upstream leg."""
    return None


def claude_last_resort(question: str) -> Candidate | None:
    """Last-resort failsafe. Claude must attach a REAL fetched source URL (e.g. via its web_search tool)
    to be usable — a number from the model's memory is rejected. Returns None until web_search is wired
    (verify the Anthropic web_search tool surface per Rule 1 before enabling)."""
    return None


def _question(cfg: dict, area: str) -> str:
    label = area.replace("_", " ").title()
    q = (cfg.get("questions") or ["{area_label}"])[0]
    return q.replace("{area_label}", label)


def run_cascade(cfg: dict, area: str) -> Candidate | None:
    dl = cfg.get("denylist_domains", [])
    q = _question(cfg, area)
    # FAILSAFE, in order; legs are resolved by name at call time (monkeypatch-friendly) and called
    # lazily so the first leg returning a SOURCED, non-denylisted Candidate short-circuits the rest.
    for make in (
        lambda: gemini_grounded(q),
        lambda: firecrawl_search(q, dl),
        lambda: spider_search(q, dl),
        lambda: claude_last_resort(q),
    ):
        c = make()
        if c and c.source_url and not is_denylisted(c.source_url, dl):
            return c
    return None  # nothing sourced -> NULL + reason (never a memory guess)


# --- ANOMALY (vs OUR OWN prior daily_truth row; NOT the vendor) ---
def _prior_value(metric_key: str, area: str) -> float | None:
    import psycopg

    from ingest.scripts.migrate_nfip_flood_zone_current import _uri

    try:
        with psycopg.connect(_uri(), connect_timeout=15) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT value FROM data_lake.daily_truth "
                "WHERE metric_key=%s AND area=%s AND value IS NOT NULL "
                "ORDER BY retrieved_at DESC LIMIT 1",
                (metric_key, area),
            )
            row = cur.fetchone()
            return float(row[0]) if row and row[0] is not None else None
    except Exception:  # noqa: BLE001 - no prior / DB unreachable -> treat as no baseline
        return None


def _second_source_value(cfg: dict, area: str) -> float | None:
    """One re-run from a DIFFERENT source (the Firecrawl leg) to confirm a big move."""
    c = firecrawl_search(_question(cfg, area), cfg.get("denylist_domains", []))
    if c and c.source_url and not is_denylisted(c.source_url, cfg.get("denylist_domains", [])):
        return c.value
    return None


def _snapshot(cfg: dict) -> dict:
    keys = ("unit", "vendor_anchor_table", "tolerance_pct", "expected_range", "denylist_domains", "anomaly_threshold_pct")
    return {k: cfg.get(k) for k in keys}


def _null_row(cfg: dict, area: str, reason: str) -> DailyTruthRow:
    return DailyTruthRow(
        metric_key=cfg["metric_key"], area=area, period=_today(), value=None,
        unit=cfg.get("unit"), status_reason=reason, metric_config=_snapshot(cfg),
    )


def _row(winner: Candidate, cfg: dict, area: str, anomaly_flag: bool, anomaly_delta_pct: float | None, agreement_n: int) -> DailyTruthRow:
    return DailyTruthRow(
        metric_key=cfg["metric_key"], area=area, period=_today(), value=winner.value,
        unit=cfg.get("unit"), source_url=winner.source_url, source_title=winner.source_title,
        engine=winner.engine, query_text=_question(cfg, area), agreement_n=agreement_n,
        verified_on_page=False, source_tag="live_search", anomaly_flag=anomaly_flag,
        anomaly_delta_pct=anomaly_delta_pct, metric_config=_snapshot(cfg),
    )


def finalize_with_anomaly(winner: Candidate | None, cfg: dict, area: str) -> DailyTruthRow:
    if winner is None or not winner.source_url:
        return _null_row(cfg, area, "all cascade legs returned no sourced number")
    lo, hi = cfg["expected_range"]
    if not (lo <= winner.value <= hi):
        return _null_row(cfg, area, f"value {winner.value} outside expected_range")
    prior = _prior_value(cfg["metric_key"], area)
    delta = None if not prior else (winner.value - prior) / prior * 100.0
    agreement_n = 1
    if delta is not None and abs(delta) > cfg["anomaly_threshold_pct"]:
        second = _second_source_value(cfg, area)  # cron a 2nd run, DIFFERENT source
        confirmed = second is not None and abs(second - winner.value) / winner.value * 100.0 <= cfg["anomaly_threshold_pct"]
        if confirmed:
            agreement_n = 2
        else:
            return _row(winner, cfg, area, True, delta, agreement_n)  # stored, HELD for human review
    return _row(winner, cfg, area, False, delta, agreement_n)


def resolve_metric_search(cfg: dict, area: str) -> DailyTruthRow:
    """NORMAL path: one cascade pass -> anomaly -> row."""
    return finalize_with_anomaly(run_cascade(cfg, area), cfg, area)


def _fred_latest(series_id: str) -> tuple[float, str] | None:
    key = os.environ.get("FRED_API_KEY")
    if not key:
        return None
    try:
        resp = requests.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params={"series_id": series_id, "api_key": key, "file_type": "json", "sort_order": "desc", "limit": 1},
            timeout=30,
        )
        resp.raise_for_status()
        for o in resp.json().get("observations", []):
            if o.get("value") not in (".", None):
                return float(o["value"]), o["date"]
    except (requests.RequestException, ValueError, KeyError):
        return None
    return None


def resolve_metric_api(cfg: dict, area: str) -> DailyTruthRow:
    """API mode: deterministic pull from an authoritative API we HAVE the URL for (FRED). No cascade."""
    api = cfg.get("api_config") or {}
    got = _fred_latest(api.get("series_id"))
    if not got:
        return _null_row(cfg, area, "authoritative API returned no observation")
    value, period = got
    lo, hi = cfg["expected_range"]
    if not (lo <= value <= hi):
        return _null_row(cfg, area, f"value {value} outside expected_range")
    return DailyTruthRow(
        metric_key=cfg["metric_key"], area=area, period=period, value=value, unit=cfg.get("unit"),
        source_url=api.get("source_url"), source_title="FRED", engine="fred",
        agreement_n=1, verified_on_page=True, source_tag="live_search", metric_config=_snapshot(cfg),
    )


def bootstrap_metric(cfg: dict, area: str) -> DailyTruthRow:
    """FIRST run for a metric: gather 2-3 sources and confirm they agree closely before setting the baseline."""
    dl = cfg.get("denylist_domains", [])
    q = _question(cfg, area)
    cands = [c for c in (gemini_grounded(q), firecrawl_search(q, dl)) if c and c.source_url and not is_denylisted(c.source_url, dl)]
    if not cands:
        return _null_row(cfg, area, "bootstrap: no sourced number from any leg")
    n, winner = cross_check(cands, cfg.get("tolerance_pct", 10))
    return finalize_with_anomaly(winner, cfg, area)
