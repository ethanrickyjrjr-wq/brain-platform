"""address_key — the property identity.

A relisting gets a NEW listing id; keying on the id reads a relist as two unrelated events. We key on
the normalized street address + ZIP so a relist reads as two events on ONE property (spec finding #3).
The unit is part of the key (a condo's #301 and #414 are different properties). `sale_or_rent` is NOT
here — it's a separate column in the table key, because one address can be live for sale AND rent.

Open risk (measure on the first real scan): if the string-normalized collision/miss rate is high,
add a geocode-backed fallback. Start simple; the first pull tells us if it's enough.

Hardening (2026-06-30): added directional and street-suffix canonicalization (long<->short) so a seed
row written "1403 Northeast 19th Ter" collapses to the SAME key as the SteadyAPI sweep's "1403 NE 19th
Ter" (SteadyAPI emits the short directional form; the seed may carry either). Directionals normalize
long->short but NEVER merge distinct quadrants (Cape Coral's SE/SW/NE/NW 1st St are four streets).

DEFERRED — unmarked-trailing-unit smush ("Westwind Ln 202" / "Westwindln202"): SteadyAPI's permalink
emits units WITH a marker (`-apt-202`), which _UNIT already catches, so the smush is not a sweep-to-
sweep concern. It would only matter for the seed<->sweep catch-up; per the docstring's own "start
simple, measure first" intent, defer until the catch-up's first real scan reports a mismatch rate.

CATCH-UP RE-KEY WARNING: this change alters the key FORMAT, so the 10,459 lifecycle_seed rows carry
OLD-format keys in their stored `address_key` column. distill.upsert_state MERGEs on
(source_name, address_key, sale_or_rent) — when the catch-up runs the hardened function it produces
NEW keys, so it must re-key the seed rows (UPDATE address_key) or match on lat/lon, else it INSERTs
duplicates instead of stamping property_id/photo onto the existing rows. The api_feed table is empty
now, so no live path is affected; the risk is the future catch-up only."""
from __future__ import annotations

import re

# Canonicalize street suffixes (long->short) AND directionals (long->short) so the same physical
# street collapses to one key regardless of how the source spelled it. Directionals map each long
# form to its OWN abbreviation (NORTHEAST->NE, not -> N) so distinct quadrants never merge. Short
# forms (WAY/LOOP/RUN/PASS, and bare NE/SE/...) need no entry: an unmapped token passes through
# unchanged, and the no-separator join below keeps the key stable across spacing variants.
_CANON = {
    # street suffix
    "AVENUE": "AVE", "STREET": "ST", "BOULEVARD": "BLVD", "DRIVE": "DR", "ROAD": "RD",
    "LANE": "LN", "COURT": "CT", "PLACE": "PL", "TERRACE": "TER", "CIRCLE": "CIR",
    "PARKWAY": "PKWY", "HIGHWAY": "HWY", "TRAIL": "TRL", "POINT": "PT", "COVE": "CV",
    # directional (long -> short; one-to-one with the eight compass abbreviations)
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
    "NORTHEAST": "NE", "NORTHWEST": "NW", "SOUTHEAST": "SE", "SOUTHWEST": "SW",
}
_UNIT = re.compile(r"\b(?:UNIT|APT|APARTMENT|STE|SUITE|#)\s*([A-Z0-9-]+)", re.I)


def address_key(street: str, zip_code: str) -> str:
    """Deterministic, collision-resistant-within-a-ZIP, stable-across-relists property key."""
    s = (street or "").upper()
    unit = ""
    m = _UNIT.search(s)
    if m:
        unit = "UNIT" + re.sub(r"[^A-Z0-9]", "", m.group(1))
        s = _UNIT.sub("", s)
    s = re.sub(r"[^A-Z0-9 ]", " ", s)               # drop punctuation
    toks = [_CANON.get(t, t) for t in s.split()]    # canonicalize suffixes + directionals
    core = "".join(toks)
    z = re.sub(r"[^0-9]", "", zip_code or "")[:5]    # 5-digit ZIP only (ZIP gate G1)
    return f"{core}{unit}:{z}"
