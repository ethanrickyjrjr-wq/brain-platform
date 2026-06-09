"""
Firecrawl agent extraction of active commercial listings from Crexi.

Coverage: Estero FL and Fort Myers Beach FL — two SWFL submarkets with
no MarketBeat broker-survey coverage. The agent browses Crexi's lease
search filtered to each city, extracts per-listing data, and returns
a flat list of raw listing dicts.

Why Firecrawl agent (not scrape): Crexi renders listing grids in JS;
the /v2/agent autonomous-browser mode handles the dynamic content and
pagination without needing explicit selectors.
"""
from __future__ import annotations

from typing import Any

from ingest.lib.firecrawl_client import agent, extract_agent_rows, FirecrawlError

# One entry per search target. `city` matches the city column we write to DB.
# `label` is a human-readable name for logs.
SEARCH_TARGETS: list[dict[str, str]] = [
    {
        "city": "Estero",
        "label": "Estero FL",
        "prompt_city": "Estero, FL 33928",
    },
    {
        "city": "Fort Myers Beach",
        "label": "Fort Myers Beach FL",
        "prompt_city": "Fort Myers Beach, FL 33931",
    },
]

# Extraction schema — one item per listing.
_LISTING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "address": {"type": "string"},
                    "city": {"type": "string"},
                    "property_type": {"type": "string"},
                    "sqft": {"type": "number"},
                    "asking_price_psf": {"type": "number"},
                    "status": {
                        "type": "string",
                        "description": "available | leased | sale",
                    },
                    "listed_date": {
                        "type": "string",
                        "description": "ISO date or month/year if exact date unknown",
                    },
                    "source_url": {"type": "string"},
                },
                "required": ["address", "status"],
            },
        }
    },
    "required": ["rows"],
}


def fetch_listings_for_city(city_meta: dict[str, str]) -> list[dict[str, Any]]:
    """Run a Firecrawl agent search for one city. Returns raw listing rows."""
    prompt = (
        f"Go to crexi.com and search for available commercial real estate listings "
        f"for lease in {city_meta['prompt_city']}. "
        f"Extract every listing you find: address, city, property type "
        f"(retail/industrial/office/mixed), square footage, asking price per sqft, "
        f"listing status (available, leased, or for sale), date listed, and the "
        f"URL for each individual listing page. "
        f"Include all property types. "
        f"If a field is not shown on the listing card, omit it."
    )
    try:
        response = agent(
            prompt=prompt,
            urls=["https://www.crexi.com/lease"],
            schema=_LISTING_SCHEMA,
            model="spark-1-mini",
            max_credits=2000,
        )
        rows = extract_agent_rows(response)
        # Tag city from metadata in case the agent omits it on some rows
        for row in rows:
            if not row.get("city"):
                row["city"] = city_meta["city"]
        return rows
    except FirecrawlError as exc:
        # Non-fatal: log and return empty so the pipeline continues with other cities.
        print(f"[warn] Crexi agent error for {city_meta['label']}: {exc}", flush=True)
        return []
