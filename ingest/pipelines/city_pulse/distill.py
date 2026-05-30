"""SWFL city pulse — distill step.

Reads a Tier-1 capture record (one city), makes ONE cheap Anthropic call (no
web search — forced tool_use structured output) that turns the captured
citations[] into discrete, citation-backed facts. Each fact is classified into a
volatility `topic` (which sets its TTL), backed by a citation span by 1-based
INDEX (cite field), and given a dedup_key.

Distill contract: the model is shown a NUMBERED list of citation spans
(title + cited_text + url) — not the raw response blob — and each extracted fact
references its backing span by index number (cite: 1, 2, …). Facts whose cite
index is out of range, whose topic is invalid, or whose resolved citation has no
URL are DROPPED — that is the no-unbacked-claim guarantee, enforced before the
row exists. This approach fixes the 0-facts bug (the raw 278k-char response blob
drowned the model) and cuts distill input tokens ~20x.

Writes to data_lake.city_pulse via psycopg with ON CONFLICT (dedup_key) DO NOTHING.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import anthropic

from ingest.lib.tier1_inventory import _get_connection

MODEL = "claude-sonnet-4-6"

TTL_DAYS: dict[str, int] = {
    "breaking": 1,
    "transactions": 7,
    "development": 14,
    "business": 14,
    "structural": 90,
}
VALID_TOPICS: set[str] = set(TTL_DAYS)


def normalize_fact(fact: str) -> str:
    """Lowercase + collapse whitespace + strip trailing punctuation for stable dedup."""
    return re.sub(r"\s+", " ", fact.lower()).strip().rstrip(".")


def dedup_key(city: str, topic: str, fact: str) -> str:
    raw = f"{city}|{topic}|{normalize_fact(fact)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def expires_at_for(topic: str, captured_at: datetime) -> datetime:
    return captured_at + timedelta(days=TTL_DAYS[topic])


EXTRACT_TOOL = {
    "name": "record_city_facts",
    "description": "Record discrete, citation-backed current-events facts for one SWFL city.",
    "input_schema": {
        "type": "object",
        "properties": {
            "facts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string", "enum": sorted(VALID_TOPICS),
                                  "description": "Volatility class. breaking=disaster/sudden closure/major layoff; transactions=sales/big leases/land buys; development=construction/permits/approvals; business=openings/closings/expansions/hiring; structural=ownership/long-run posture."},
                        "fact": {"type": "string", "description": "One concrete claim, numbers and dates verbatim."},
                        "cite": {"type": "integer", "description": "The number of the citation span (from the numbered list) that backs this fact."},
                    },
                    "required": ["topic", "fact", "cite"],
                },
            }
        },
        "required": ["facts"],
    },
}


def rows_from_extraction(capture: dict[str, Any], extraction: dict[str, Any]) -> list[dict[str, Any]]:
    """Turn the model's extraction into city_pulse rows, dropping any fact whose
    cite index is out of range, whose topic is invalid, or whose resolved citation
    has no URL. Index-based lookup carries title + cited_text onto the row."""
    citations = capture.get("citations", [])
    captured_at = datetime.fromisoformat(capture["run_at"].replace("Z", "+00:00"))
    rows: list[dict[str, Any]] = []
    for f in extraction.get("facts", []):
        topic = f.get("topic")
        fact = (f.get("fact") or "").strip()
        if topic not in VALID_TOPICS or not fact:
            continue
        # cite is a 1-based index into citations; coerce and range-check
        try:
            cite_idx = int(f["cite"])
        except (KeyError, TypeError, ValueError):
            continue  # missing or non-integer cite -> dropped (the guarantee)
        if not (1 <= cite_idx <= len(citations)):
            continue  # out of range -> dropped
        c = citations[cite_idx - 1]
        url = c.get("url")
        if not url:
            continue  # no URL on resolved citation -> dropped
        rows.append({
            "city": capture["city"],
            "topic": topic,
            "fact": fact,
            "source_url": url,
            "source_title": c.get("title"),
            "cited_text": c.get("cited_text"),
            "captured_at": captured_at,
            "expires_at": expires_at_for(topic, captured_at),
            "dedup_key": dedup_key(capture["city"], topic, fact),
            "run_at": captured_at,
        })
    return rows


def distill_capture(capture: dict[str, Any]) -> list[dict[str, Any]]:
    """One forced-tool-use call: extract facts from the capture's citation spans,
    then post-process into rows. No web search here.

    The model receives a NUMBERED list of citation spans (not the raw response
    blob) and returns each fact with a cite integer referencing its backing span
    by 1-based index. This avoids the 0-facts bug caused by feeding the model a
    ~278k-char encrypted_content blob and cuts input tokens ~20x."""
    if not capture.get("citations"):
        return []  # nothing citable -> nothing to distill
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    city = capture["city"]
    citations = capture["citations"]
    # Build a numbered list of citation spans for the prompt
    span_lines = []
    for i, c in enumerate(citations, start=1):
        title = c.get("title") or ""
        cited_text = c.get("cited_text") or ""
        url = c.get("url") or ""
        span_lines.append(f'[{i}] {title} — "{cited_text}" ({url})')
    numbered_spans = "\n".join(span_lines)
    n = len(citations)
    prompt = (
        f"Here are {n} cited spans from a web search about {city}, Florida "
        f"(Southwest Florida), covering recent current events:\n\n"
        f"{numbered_spans}\n\n"
        "Extract every concrete, DATED current-events fact from these spans — "
        "business openings/closings, transactions/sales/leases, "
        "construction/permits/approvals, layoffs/hiring, storm/disaster impacts. "
        "Keep numbers, dollar amounts, company names, and dates verbatim. "
        "Skip vague or undated statements. "
        "For each fact set `cite` to the [number] of the span it came from and "
        "classify `topic`. Call record_city_facts."
    )
    msg = client.messages.create(
        model=MODEL,
        # 8192, not 2048: a busy city yields 30-40 facts; at 2048 the forced
        # tool-input JSON truncates mid-array (stop_reason=max_tokens) and parses
        # to ZERO facts. Verified live — Naples returned 33 facts at 8192, 0 at
        # 2048. Headroom is ~3x the observed worst case.
        max_tokens=8192,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "record_city_facts"},
        messages=[{"role": "user", "content": prompt}],
    )
    extraction = next(
        (b.input for b in msg.content if getattr(b, "type", None) == "tool_use"),
        {"facts": []},
    )
    return rows_from_extraction(capture, extraction)


_INSERT_COLUMNS = [
    "city", "topic", "fact", "source_url", "source_title",
    "cited_text", "captured_at", "expires_at", "dedup_key", "run_at",
]


def _insert_sql() -> str:
    cols = ", ".join(_INSERT_COLUMNS)
    placeholders = ", ".join(f"%({c})s" for c in _INSERT_COLUMNS)
    return (
        f"INSERT INTO data_lake.city_pulse ({cols}) VALUES ({placeholders}) "
        "ON CONFLICT (dedup_key) DO NOTHING"
    )


def write_rows(rows: list[dict[str, Any]]) -> int:
    """Upsert rows; returns number of NEW rows inserted (dedup skips count as 0).
    On any error the whole batch is rolled back and the exception re-raised — the
    caller treats the city as failed rather than trusting a partial count."""
    if not rows:
        return 0
    conn = _get_connection()
    inserted = 0
    try:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(_insert_sql(), row)
                inserted += cur.rowcount  # 0 on conflict, 1 on insert
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return inserted


def _prune_sql() -> str:
    # Tier-1 cold storage retains the permanent raw audit, so deleting expired
    # Tier-2 rows loses nothing recoverable. The reader already ignores them.
    return "DELETE FROM data_lake.city_pulse WHERE expires_at < now()"


def prune_expired() -> int:
    """Delete expired Tier-2 rows. Returns the number deleted."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(_prune_sql())
            deleted = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return deleted
