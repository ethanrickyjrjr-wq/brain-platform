from ingest.lib.geo_utils import FL_BBOX, FL_FIPS_STATE, geometry_hash


class TestGeoUtils:
    def test_fl_bbox_is_four_floats(self):
        assert len(FL_BBOX) == 4
        assert all(isinstance(v, float) for v in FL_BBOX)

    def test_fl_bbox_covers_florida(self):
        min_lon, min_lat, max_lon, max_lat = FL_BBOX
        # Miami is roughly -80.2, 25.8 — must be inside
        assert min_lon < -80.2 < max_lon
        assert min_lat < 25.8 < max_lat

    def test_fl_fips_state(self):
        assert FL_FIPS_STATE == "12"

    def test_geometry_hash_deterministic(self):
        g = {"type": "Point", "coordinates": [-81.5, 26.3]}
        assert geometry_hash(g) == geometry_hash(g)

    def test_geometry_hash_different_on_change(self):
        g1 = {"type": "Point", "coordinates": [-81.5, 26.3]}
        g2 = {"type": "Point", "coordinates": [-82.0, 26.0]}
        assert geometry_hash(g1) != geometry_hash(g2)

    def test_geometry_hash_returns_32_char_hex(self):
        h = geometry_hash({"type": "Point", "coordinates": [0, 0]})
        assert isinstance(h, str) and len(h) == 32
