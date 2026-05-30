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
