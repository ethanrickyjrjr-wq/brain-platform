"""Offline tests for dbpr_sirs row mapping (the deterministic QIX-matrix -> row-dict logic).

No network / no Qlik — the websocket pull is integration-tested live. These lock the column
mapping per app schema and the county filter, which is what the brain depends on.
"""
from ingest.pipelines.dbpr_sirs.pipeline import (
    map_rows,
    normalize_county,
    row_hash,
    SWFL_COUNTIES,
)

# pre-July: Project Type | Project Name | Association Name | City | Zip | County | ID
PRE_JULY_APP = {"period": "pre_july_2025", "has_id": True}
# July+: Project Name | Association Name | City | Zip Code | County
JULY_PLUS_APP = {"period": "july_2025_plus", "has_id": False}


def test_pre_july_maps_seven_columns_and_keeps_condo_coop():
    matrix = [
        ["CONDOMINIUM", "SEA DUNES", "SEA DUNES VILLAS", "AMELIA ISLAND", "32034-5423", "NASSAU", "226495"],
        ["COOPERATIVE", "BAY COOP", "BAY COOP ASSN", "FORT MYERS", "33901", "LEE", "270065"],
    ]
    rows = map_rows(matrix, PRE_JULY_APP)
    assert len(rows) == 2
    assert rows[0] == {
        "project_type": "CONDOMINIUM", "project_name": "SEA DUNES",
        "association_name": "SEA DUNES VILLAS", "city": "AMELIA ISLAND",
        "zip": "32034-5423", "county": "NASSAU", "dbpr_id": "226495",
    }
    assert rows[1]["county"] == "LEE" and rows[1]["dbpr_id"] == "270065"


def test_pre_july_drops_non_project_rows():
    # A stray non-CONDOMINIUM/COOPERATIVE row (e.g. a header artifact) is excluded.
    matrix = [
        ["Project Type", "Project Name", "Association Name", "City", "Zip", "County", "ID"],
        ["TIMESHARE", "X", "Y", "Z", "1", "LEE", "9"],
        ["CONDOMINIUM", "REAL", "REAL ASSN", "NAPLES", "34113", "COLLIER", "1"],
    ]
    rows = map_rows(matrix, PRE_JULY_APP)
    assert len(rows) == 1
    assert rows[0]["project_name"] == "REAL"


def test_july_plus_maps_five_columns_no_type_no_id():
    matrix = [
        ["3 ISLAND CONDO", "3 ISLAND CONDO ASSN", "Miami Beach", "33139", "Dade"],
        ["500 LA PENINSULA", "500 LA PENINSULA ASSN", "Naples", "34113", "Collier"],
    ]
    rows = map_rows(matrix, JULY_PLUS_APP)
    assert len(rows) == 2
    assert rows[0]["project_type"] is None and rows[0]["dbpr_id"] is None
    assert rows[1] == {
        "project_type": None, "project_name": "500 LA PENINSULA",
        "association_name": "500 LA PENINSULA ASSN", "city": "Naples",
        "zip": "34113", "county": "Collier", "dbpr_id": None,
    }


def test_july_plus_tolerates_short_rows():
    rows = map_rows([["ONLY NAME"]], JULY_PLUS_APP)
    assert rows[0]["project_name"] == "ONLY NAME"
    assert rows[0]["county"] is None  # missing cells -> None, never IndexError


def test_county_filter_and_normalize():
    assert normalize_county("Collier") == "COLLIER"
    assert normalize_county("  lee ") == "LEE"
    assert normalize_county(None) is None
    assert normalize_county("Collier") in SWFL_COUNTIES
    assert normalize_county("Dade") not in SWFL_COUNTIES


def test_row_hash_stable_and_case_insensitive():
    a = row_hash("Bay", "Bay Assn", "33901", "Lee")
    b = row_hash("BAY", "BAY ASSN", "33901", "LEE")
    assert a == b  # name/county uppercased before hashing
    assert a != row_hash("Bay", "Bay Assn", "33902", "Lee")
