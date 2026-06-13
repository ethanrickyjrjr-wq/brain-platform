"""Tests for the FL DBPR applicant resource: 15-col layout, ingest-side county
filter, and the volume guard (total + per-county floors + city anchors).

The applicant layout + county scheme were verified live 2026-06-13 against
constr_app.csv (103,291 rows, ALL 15 cols; SWFL = 8,727 → Lee 6,031 / Collier 2,696).
"""
from unittest.mock import patch

import pytest

from ingest.lib.guards import VolumeGuardError
from ingest.pipelines.fl_dbpr_licenses import resources as R


# constr_app.csv column order (0-indexed, 15 cols):
# occ_code, occ_desc, first, mid, last, suffix, addr1, addr2, addr3,
# city, state, zip, county_code, phone, ext
def _app_row(occ="0605", first="JANE", last="DOE", city="FORT MYERS",
             state="FL", zipc="33901", county="46", phone="239-555-0100"):
    return [
        occ, "Certified General Contractor", first, "", last, "",
        "123 MAIN ST", "", "", city, state, zipc, county, phone, "",
    ]


def _stream(rows):
    """Patch _stream_csv to return the given raw rows."""
    return patch.object(R, "_stream_csv", return_value=rows)


# ─────────────────────────────────────────────────────────────────────────────
# Layout + ingest-side county filter
# ─────────────────────────────────────────────────────────────────────────────
class TestApplicantLayoutAndFilter:
    def _bypass_floors(self, monkeypatch):
        # Keep the anchor invariant live (rows below include Fort Myers/Naples),
        # but drop the count floors so a tiny fixture exercises field mapping.
        monkeypatch.setattr(R, "APP_FLOOR_TOTAL", 1)
        monkeypatch.setattr(R, "APP_FLOOR_LEE", 1)
        monkeypatch.setattr(R, "APP_FLOOR_COLLIER", 1)

    def test_filters_to_lee_and_collier_only(self, monkeypatch):
        self._bypass_floors(monkeypatch)
        raw = [
            _app_row(city="FORT MYERS", county="46"),
            _app_row(city="NAPLES", county="21", first="CARLOS", last="RIVERA"),
            _app_row(city="SARASOTA", county="68"),   # non-SWFL → dropped
            _app_row(city="MIAMI", county="13"),       # non-SWFL → dropped
        ]
        with _stream(raw):
            out = list(R.dbpr_applicants_resource())
        assert len(out) == 2
        assert {r["county_code"] for r in out} == {"46", "21"}

    def test_splits_city_state_zip_and_sets_county(self, monkeypatch):
        self._bypass_floors(monkeypatch)
        raw = [_app_row(city="FORT MYERS", state="FL", zipc="33901", county="46"),
               _app_row(city="NAPLES", county="21")]
        with _stream(raw):
            out = list(R.dbpr_applicants_resource())
        lee = next(r for r in out if r["county_code"] == "46")
        assert lee["city"] == "FORT MYERS"
        assert lee["state"] == "FL"
        assert lee["zip"] == "33901"
        assert lee["county"] == "Lee"
        assert lee["county_code"] == "46"          # byte-exact for the consumer .in()
        assert lee["occupation_code"] == "0605"
        assert lee["first_name"] == "JANE"
        assert lee["phone"] == "239-555-0100"

    def test_county_code_is_byte_exact_string(self, monkeypatch):
        self._bypass_floors(monkeypatch)
        raw = [_app_row(county="46", city="CAPE CORAL"),
               _app_row(county="21", city="NAPLES")]
        with _stream(raw):
            out = list(R.dbpr_applicants_resource())
        for r in out:
            assert r["county_code"] in ("46", "21")
            assert isinstance(r["county_code"], str)

    def test_applicant_header_row_dropped(self, monkeypatch):
        self._bypass_floors(monkeypatch)
        header = ["Occ Number", "Occ Description", "First Name", "Second Name",
                  "Last Name", "Suffix", "Address 1", "Address 2", "Address 3",
                  "City", "State", "Zip", "County", "Phone Number", "Ext"]
        raw = [header, _app_row(county="46", city="FORT MYERS"),
               _app_row(county="21", city="NAPLES")]
        with _stream(raw):
            out = list(R.dbpr_applicants_resource())
        assert len(out) == 2  # header excluded


# ─────────────────────────────────────────────────────────────────────────────
# Volume guard — must FIRE on collapse / partial drift / scheme swap
# ─────────────────────────────────────────────────────────────────────────────
class TestApplicantVolumeGuard:
    """_assert_applicant_volume uses the real production floors (4000 / 3000 / 1300)."""

    def _rows(self, county, city, n):
        return [{"county_code": county, "city": city} for _ in range(n)]

    def test_empty_collapse_raises_total_floor(self):
        """HTML/empty pull → 0 rows → catastrophic total floor aborts."""
        with pytest.raises(VolumeGuardError) as ei:
            R._assert_applicant_volume([])
        assert "fl_dbpr_applicants" in str(ei.value)

    def test_collier_dropout_raises_per_county_floor(self):
        """Lee survives (> 4000 total) but Collier silently → 0; the total floor
        passes — only the per-county Collier floor catches the partial drift."""
        rows = self._rows("46", "FORT MYERS", 6031)  # total 6031 > 4000, lee ok, collier 0
        with pytest.raises(VolumeGuardError) as ei:
            R._assert_applicant_volume(rows)
        assert "collier_21" in str(ei.value)

    def test_lee_dropout_raises_per_county_floor(self):
        rows = self._rows("21", "NAPLES", 2696)  # total 2696 < 4000 → total fires first
        with pytest.raises(VolumeGuardError):
            R._assert_applicant_volume(rows)

    def test_scheme_swap_raises_city_anchor(self):
        """Counts pass all floors, but the canonical Lee cities no longer map to
        '46' (a FIPS swap / col shift) → the city-anchor invariant aborts."""
        rows = (self._rows("46", "TALLAHASSEE", 6031)
                + self._rows("21", "MIAMI", 2696))
        with pytest.raises(VolumeGuardError) as ei:
            R._assert_applicant_volume(rows)
        assert "Lee city anchors county_code 46" in str(ei.value)

    def test_healthy_distribution_passes(self):
        """The real probed distribution (Lee 6,031 / Collier 2,696 with canonical
        anchor cities) must NOT raise."""
        rows = (self._rows("46", "FORT MYERS", 6031)
                + self._rows("21", "NAPLES", 2696))
        R._assert_applicant_volume(rows)  # no raise

    def test_resource_aborts_before_yield_on_empty_stream(self):
        """End-to-end: an empty/HTML stream aborts inside the dlt resource before
        any row is yielded. dlt may rewrap VolumeGuardError — assert on the message."""
        with _stream([]):
            with pytest.raises(Exception) as ei:
                list(R.dbpr_applicants_resource())
        assert "volume-guard" in str(ei.value)
