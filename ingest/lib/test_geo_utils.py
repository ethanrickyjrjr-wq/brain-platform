"""Tests for ingest.lib.geo_utils — coord_to_zip centroid-nearest resolution."""
import pytest
from ingest.lib.geo_utils import coord_to_zip


class TestCoordToZip:
    def test_fort_myers_beach_centroid(self):
        # 33931 centroid exactly — should resolve to itself
        result = coord_to_zip(26.4556, -81.938)
        assert result == "33931"

    def test_naples_downtown(self):
        # 34102 / 34101 share the same centroid — either is acceptable
        result = coord_to_zip(26.142, -81.7948)
        assert result in {"34101", "34102"}

    def test_fort_myers_core(self):
        result = coord_to_zip(26.6428, -81.8723)
        assert result == "33901"

    def test_lehigh_acres(self):
        result = coord_to_zip(26.6302, -81.4028)
        assert result == "33936"

    def test_miami_returns_none(self):
        # Miami — outside the 10-mile cutoff from any SWFL centroid
        result = coord_to_zip(25.7617, -80.1918)
        assert result is None

    def test_gulf_of_mexico_returns_none(self):
        # Open water well off the coast
        result = coord_to_zip(26.0, -83.0)
        assert result is None

    def test_returns_string_or_none(self):
        result = coord_to_zip(26.5, -81.9)
        assert result is None or isinstance(result, str)

    def test_result_is_five_digit_zip(self):
        result = coord_to_zip(26.5895, -81.8723)
        assert result is not None
        assert len(result) == 5
        assert result.isdigit()
