"""SWFL demand seed keywords.

Deterministic seed set = {SWFL places} x {topic templates} + a curated core
list. Same seeds each run, so the upsert is stable. DataForSEO returns volume
for exactly these terms; demand we didn't think to seed is discovered later via
the keywords_for_keywords expansion (Phase-2 of the pipeline, not wired yet).

These are DEMAND-side seeds (what a SWFL searcher would type), not our brain
slugs — kept intentionally in plain-English search phrasing.
"""
from __future__ import annotations

# SWFL towns / places a searcher would name. Lee + Collier core, plus the
# named beaches/islands and the Lehigh Acres growth corridor the roadmap flags.
SWFL_PLACES: list[str] = [
    "fort myers",
    "cape coral",
    "naples",
    "bonita springs",
    "estero",
    "marco island",
    "lehigh acres",
    "fort myers beach",
    "sanibel",
    "north fort myers",
    "punta gorda",
    "immokalee",
    "lee county",
    "collier county",
    "southwest florida",
]

# Topic templates — each maps to a SWFL data domain we hold (or want to hold).
# `{place}` is substituted with each SWFL_PLACES entry.
TOPIC_TEMPLATES: list[str] = [
    "{place} flood insurance",
    "{place} flood zone",
    "{place} hurricane risk",
    "{place} new construction",
    "{place} home prices",
    "{place} real estate market",
    "{place} housing market",
    "{place} homes for sale",
    "{place} rent prices",
    "{place} apartments for rent",
    "{place} commercial real estate",
    "{place} cap rate",
    "{place} office space",
    "{place} retail space for lease",
    "{place} building permits",
    "{place} cost of living",
    "{place} property taxes",
    "{place} job market",
]

# Non-templated core terms (region-level demand phrasing).
CORE_TERMS: list[str] = [
    "swfl real estate",
    "southwest florida flood insurance cost",
    "is fort myers beach a good investment",
    "cape coral vs naples",
    "moving to southwest florida",
]


def build_seeds(max_keywords: int) -> list[str]:
    """Return the deduped, lowercased seed list, capped at `max_keywords`.

    Order is deterministic (places x templates, then core terms) so a cap that
    bites drops the same tail every run rather than shuffling the sample.
    """
    seen: set[str] = set()
    out: list[str] = []
    for place in SWFL_PLACES:
        for template in TOPIC_TEMPLATES:
            kw = template.format(place=place).strip().lower()
            if kw and kw not in seen:
                seen.add(kw)
                out.append(kw)
    for term in CORE_TERMS:
        kw = term.strip().lower()
        if kw and kw not in seen:
            seen.add(kw)
            out.append(kw)
    return out[:max_keywords]
