"""Shared SWFL MSA filter — single source of truth for ZIP-level ingest pipelines.

Used by every Tier 1 pipeline that filters a national dataset down to the
Southwest Florida footprint via a `Metro` / `PARENT_METRO_REGION` substring
match. Centralized here so the four MSAs don't drift across pipelines.

Coverage:
  - Cape Coral-Fort Myers MSA (Lee County)
  - Naples-Marco Island MSA (Collier County)
  - Punta Gorda MSA (Charlotte County)
  - North Port-Sarasota-Bradenton MSA (Sarasota County)

Glades and Hendry counties are intentionally omitted — they are not covered by
any MSA in the BEA / OMB delineations that the public data feeds use, so any
substring match against them would silently return zero rows. Document the gap
rather than paper over it.
"""

SWFL_METRO_SUBSTRINGS: list[str] = [
    "Cape Coral",
    "Naples",
    "Punta Gorda",
    "North Port",
]
