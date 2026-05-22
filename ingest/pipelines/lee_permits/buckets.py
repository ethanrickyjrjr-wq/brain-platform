"""Lee Accela permit-type -> 5-bucket classifier.

Buckets are locked v1 per spec decision #11. The mapping is intentionally
prose-light: every unknown -> "other", every uncertainty -> "other".
"""
from typing import Literal

Bucket = Literal[
    "commercial_new",
    "commercial_alteration",
    "residential",
    "demolition",
    "other",
]


def _has_any(s: str, needles: tuple[str, ...]) -> bool:
    return any(n in s for n in needles)


def classify_permit_type(raw_type: str, raw_description: str) -> Bucket:
    t = (raw_type or "").upper().strip()
    d = (raw_description or "").upper().strip()
    blob = f"{t} {d}"

    if _has_any(blob, ("DEMO", "DEMOLITION")):
        return "demolition"

    is_residential = _has_any(t, ("RES", "RESIDENTIAL", "SFD", "SFR")) or _has_any(
        d, ("SINGLE FAMILY", "SFD", "DWELLING")
    )
    is_commercial = _has_any(t, ("COM", "COMMERCIAL")) or _has_any(
        d, ("OFFICE", "RETAIL", "TENANT", "BUILD-OUT", "BUILDOUT")
    )

    if is_residential:
        return "residential"

    if is_commercial:
        if _has_any(blob, ("NEW CONSTRUCTION", "-NEW", "NEW BUILDING")):
            return "commercial_new"
        if _has_any(blob, ("ALT", "ALTERATION", "REMODEL", "TENANT", "BUILD-OUT", "BUILDOUT", "INTERIOR")):
            return "commercial_alteration"
        # commercial bucket with no clear new/alt signal: default to alteration
        # (TI/build-out is the most common commercial permit class)
        return "commercial_alteration"

    return "other"
