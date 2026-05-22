"""Bucket classifier tests — maps Lee Accela raw permit_type strings to the 5 v1 buckets."""
import pytest
from .buckets import classify_permit_type, Bucket


@pytest.mark.parametrize(
    "raw_type,raw_description,expected",
    [
        # commercial_new
        ("BLDG-COMMERCIAL", "NEW CONSTRUCTION", "commercial_new"),
        ("BLDG-COM-NEW", "Office building, 12000 sqft", "commercial_new"),
        # commercial_alteration (TI / build-out — the highest-leverage bucket for cre-swfl)
        ("BLDG-COMMERCIAL", "INTERIOR REMODEL", "commercial_alteration"),
        ("BLDG-COM-ALT", "Tenant build-out", "commercial_alteration"),
        ("BLDG-COMMERCIAL", "ALTERATION", "commercial_alteration"),
        # residential
        ("BLDG-RES-NEW", "Single family dwelling", "residential"),
        ("BLDG-RESIDENTIAL", "New SFD", "residential"),
        ("BLDG-RES-ALT", "Kitchen remodel", "residential"),
        # demolition
        ("DEMO", "Full structure demo", "demolition"),
        ("BLDG-DEMO", "Partial demo", "demolition"),
        # other (signs, fences, pools, mech-only, etc.)
        ("SIGN", "Wall sign", "other"),
        ("POOL", "In-ground pool", "other"),
        ("MECH-ONLY", "AC replacement", "other"),
        ("FENCE", "6ft privacy fence", "other"),
        # unknown / empty -> other
        ("", "", "other"),
        ("WEIRDCODE-XYZ", "", "other"),
    ],
)
def test_classify_permit_type(raw_type: str, raw_description: str, expected: Bucket) -> None:
    assert classify_permit_type(raw_type, raw_description) == expected
