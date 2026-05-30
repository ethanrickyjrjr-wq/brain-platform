"""SWFL city pulse — distill step.

Reads a Tier-1 capture record (one city), makes ONE cheap Anthropic call (no
web search — forced tool_use structured output) that turns the captured prose +
citations[] into discrete, citation-backed facts. Each fact is classified into a
volatility `topic` (which sets its TTL), backed by one of the supplied citation
URLs, and given a dedup_key. Facts with no backing citation are DROPPED — that is
the no-unbacked-claim guarantee, enforced before the row exists.

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
                        "source_url": {"type": "string", "description": "MUST be one of the URLs from the provided citations — the source that backs this fact."},
                    },
                    "required": ["topic", "fact", "source_url"],
                },
            }
        },
        "required": ["facts"],
    },
}


def rows_from_extraction(capture: dict[str, Any], extraction: dict[str, Any]) -> list[dict[str, Any]]:
    """Turn the model's extraction into city_pulse rows, dropping any fact whose
    source_url is not in the capture's citations or whose topic is invalid.
    citation lookup carries title + cited_text onto the row."""
    by_url = {c.get("url"): c for c in capture.get("citations", []) if c.get("url")}
    captured_at = datetime.fromisoformat(capture["run_at"].replace("Z", "+00:00"))
    rows: list[dict[str, Any]] = []
    for f in extraction.get("facts", []):
        topic = f.get("topic")
        fact = (f.get("fact") or "").strip()
        url = f.get("source_url")
        if topic not in VALID_TOPICS or not fact:
            continue
        cite = by_url.get(url)
        if cite is None:  # uncited -> dropped (the guarantee)
            continue
        rows.append({
            "city": capture["city"],
            "topic": topic,
            "fact": fact,
            "source_url": url,
            "source_title": cite.get("title"),
            "cited_text": cite.get("cited_text"),
            "captured_at": captured_at,
            "expires_at": expires_at_for(topic, captured_at),
            "dedup_key": dedup_key(capture["city"], topic, fact),
            "run_at": captured_at,
        })
    return rows


def distill_capture(capture: dict[str, Any]) -> list[dict[str, Any]]:
    """One forced-tool-use call: extract facts from the capture's response text +
    citations, then post-process into rows. No web search here."""
    if not capture.get("citations"):
        return []  # nothing citable -> nothing to distill
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response_text = json.dumps(capture["response"].get("content", []), ensure_ascii=False)
    citations_block = json.dumps(capture["citations"], ensure_ascii=False)
    prompt = (
        f"City: {capture['city']}.\n\n"
        f"Captured web_search response content:\n{response_text}\n\n"
        f"Available citations (you MUST set each fact's source_url to one of these URLs):\n{citations_block}\n\n"
        "Extract every concrete, dated current-events fact. Numbers and company "
        "names verbatim. Skip vague or undated statements. Call record_city_facts."
    )
    msg = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "record_city_facts"},
        messages=[{"role": "user", "content": prompt}],
    )
    extraction = next(
        (b.input for b in msg.content if getattr(b, "type", None) == "tool_use"),
        {"facts": []},
    )
    return rows_from_extraction(capture, extraction)
