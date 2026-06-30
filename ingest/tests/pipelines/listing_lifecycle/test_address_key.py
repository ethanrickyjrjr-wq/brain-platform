"""Deterministic tests for the address_key normalizer (no network, no DB).

address_key is the property identity: a relisting gets a NEW listing id, so keying on the id reads a
relist as two unrelated events. We key on the normalized street address + ZIP instead."""
from __future__ import annotations

from ingest.pipelines.listing_lifecycle.address_key import address_key


def test_relist_same_address_same_key():
    # 11145 2nd Ave under two listing ids must collapse to one property (spec finding #3).
    assert address_key("11145 2nd Ave", "33971") == address_key("11145 2nd Avenue", "33971")


def test_case_and_punctuation_insensitive():
    assert address_key("14150 OSTROM AVE.", "33971") == address_key("14150 ostrom ave", "33971")


def test_unit_is_part_of_condo_identity():
    a = address_key("3006 Caring Way Unit 301", "33990")
    b = address_key("3006 Caring Way Unit 414", "33990")
    assert a != b
    assert "UNIT301" in a


def test_same_street_different_zip_is_distinct():
    assert address_key("100 Main St", "33901") != address_key("100 Main St", "33902")


def test_zip_normalized_to_five_digits():
    assert address_key("100 Main St", "33901-1234") == address_key("100 Main St", "33901")


def test_empty_inputs_are_deterministic_not_crash():
    assert address_key("", "") == address_key("", "")


# ── Hardening (2026-06-30): directionals + suffix canonicalization ───────────────────────────
# Why: the catch-up match keys the 10,459 seed rows against the SteadyAPI sweep by address_key. A seed
# row written "1403 Northeast 19th Ter" must collapse to the SAME key as the sweep's "1403 NE 19th Ter".

def test_directional_long_and_short_forms_collapse():
    # Cape Coral / Lehigh grids write directionals both ways; long form must normalize to the short abbr.
    assert address_key("1403 Northeast 19th Ter", "33909") == address_key("1403 NE 19th Ter", "33909")
    assert address_key("100 Southwest 5th St", "33991") == address_key("100 SW 5th St", "33991")
    assert address_key("200 North Cleveland Ave", "33901") == address_key("200 N Cleveland Ave", "33901")


def test_directional_quadrants_never_merge():
    # SE/SW/NE/NW 1st St are FOUR DIFFERENT streets in Cape Coral — normalization must NEVER collapse them.
    z = "33990"
    quads = {address_key(f"123 {d} 1st St", z) for d in ("SE", "SW", "NE", "NW")}
    assert len(quads) == 4
    # ...and the long form lands on its OWN quadrant, not a neighbor.
    assert address_key("123 Southeast 1st St", z) == address_key("123 SE 1st St", z)
    assert address_key("123 Southeast 1st St", z) != address_key("123 SW 1st St", z)


def test_suffix_long_and_short_forms_collapse():
    assert address_key("100 Pelican Cove", "34104") == address_key("100 Pelican Cv", "34104")
    assert address_key("200 Sunset Point", "33957") == address_key("200 Sunset Pt", "33957")


def test_ordinal_street_collapses_regardless_of_spacing_or_suffix_form():
    # Plan step-1 requirement: 4th street / 4th st. / 4th ST / 4thST all collapse to one key.
    z = "33901"
    keys = {
        address_key("700 4th street", z),
        address_key("700 4th st.", z),
        address_key("700 4th ST", z),
        address_key("700 4thST", z),
    }
    assert len(keys) == 1
