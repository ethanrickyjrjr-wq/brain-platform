"""SWFL city pulse — daily current-events capture -> Tier-1 cold + Tier-2 distilled.

Per city: one Anthropic web_search_20250305 call captures current signals
(openings, layoffs, construction starts, major sales, disasters). The raw
response + flattened citations[] is written to Tier-1 cold storage; distill.py
then turns it into citation-backed rows in data_lake.city_pulse.

Tool version: web_search_20250305 — NOT web_search_20260209. The 20260209
dynamic filtering suppresses per-claim citations[] (repo A/B 2026-05-26:
9 vs 0 cited_text spans). Per-claim citations are the no-hallucination spine.
See ingest/pipelines/corridor_grounded/pipeline.py and
docs/vendor-notes/anthropic-web-search-wire-up.md.

Env: ANTHROPIC_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_KEY +
DESTINATION__POSTGRES__CREDENTIALS.

CLI:
  python -m ingest.pipelines.city_pulse.pipeline
  python -m ingest.pipelines.city_pulse.pipeline --dry-run
  python -m ingest.pipelines.city_pulse.pipeline --city "Naples"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import anthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env.local")

from ingest.lib.storage_uploader import _upload_bytes  # noqa: E402
from ingest.lib.tier1_inventory import upsert_inventory_row  # noqa: E402

CITIES = [
    "Lehigh Acres", "Cape Coral", "Fort Myers", "Naples",
    "Estero", "Bonita Springs", "Fort Myers Beach",
]

MODEL = "claude-sonnet-4-6"
SEARCH_TOOL_VERSION = "web_search_20250305"
BUCKET = "lake-tier1"

# Audited domains. naplesnews.com + news-press.com BLOCK Anthropic's crawler
# (verified in corridor_grounded), so SWFL news comes from the publishers below
# plus county/gov/state primary sources. Do NOT add the blocked papers.
ALLOWED_DOMAINS = [
    "gulfshorebusiness.com",
    "businessobserverfl.com",
    "winknews.com",
    "leegov.com",
    "colliercountyfl.gov",
    "capecoral.gov",
    "cityftmyers.com",
    "leepa.org",
    "collierappraiser.com",
    "floridajobs.org",
    "bls.gov",
    "census.gov",
]


def slug(city: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", city.lower()).strip("-")
