# Verified 2026-05-17 against faf.ornl.gov/faf5/ — update when ORNL publishes a new vintage.
FAF5_DOWNLOAD_URL = "https://faf.ornl.gov/faf5/Data/Download_Files/FAF5.7.1.zip"

# All FL FAF5 zone IDs. Ingest rule: keep rows where orig OR dest is in this set.
# Downstream SWFL filter (done in the brain, not here): dms_dest = 129 AND trade_type = 1.
FL_ZONE_IDS: frozenset[int] = frozenset({121, 122, 123, 124, 129})

# Historical years (2017-2024) + forecast years (2030-2050).
# Units: thousand tons, million dollars, million ton-miles.
FAF5_YEARS: list[int] = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2030, 2035, 2040, 2045, 2050]

# FAF5 zone reference data. FL entries are authoritative per API_BLUEPRINTS.md.
# Non-FL entries are representative — expand from the FAF5 zone definition file if needed.
FAF_ZONE_LOOKUP: list[dict] = [
    {"zone_id": 11,  "zone_name": "New England",                "state_abbr": "CT/MA/ME/NH/RI/VT"},
    {"zone_id": 12,  "zone_name": "New York",                   "state_abbr": "NY"},
    {"zone_id": 13,  "zone_name": "Philadelphia",               "state_abbr": "PA/NJ"},
    {"zone_id": 14,  "zone_name": "Baltimore",                  "state_abbr": "MD"},
    {"zone_id": 19,  "zone_name": "Remainder of Mid-Atlantic",  "state_abbr": "DE/MD/PA/VA/WV"},
    {"zone_id": 21,  "zone_name": "Chicago",                    "state_abbr": "IL"},
    {"zone_id": 22,  "zone_name": "Detroit",                    "state_abbr": "MI"},
    {"zone_id": 29,  "zone_name": "Remainder of Great Lakes",   "state_abbr": "IL/IN/MI/MN/OH/WI"},
    {"zone_id": 31,  "zone_name": "Minneapolis",                "state_abbr": "MN"},
    {"zone_id": 39,  "zone_name": "Remainder of Plains",        "state_abbr": "IA/KS/MO/NE/ND/SD"},
    {"zone_id": 41,  "zone_name": "Atlanta",                    "state_abbr": "GA"},
    {"zone_id": 49,  "zone_name": "Remainder of Southeast",     "state_abbr": "AL/GA/MS/SC/TN"},
    {"zone_id": 51,  "zone_name": "Dallas",                     "state_abbr": "TX"},
    {"zone_id": 52,  "zone_name": "Houston",                    "state_abbr": "TX"},
    {"zone_id": 59,  "zone_name": "Remainder of South Central", "state_abbr": "AR/LA/OK/TX"},
    {"zone_id": 61,  "zone_name": "Denver",                     "state_abbr": "CO"},
    {"zone_id": 69,  "zone_name": "Remainder of Mountain",      "state_abbr": "AZ/CO/ID/MT/NM/NV/UT/WY"},
    {"zone_id": 71,  "zone_name": "Los Angeles",                "state_abbr": "CA"},
    {"zone_id": 72,  "zone_name": "San Francisco",              "state_abbr": "CA"},
    {"zone_id": 73,  "zone_name": "Seattle",                    "state_abbr": "WA"},
    {"zone_id": 79,  "zone_name": "Remainder of Pacific",       "state_abbr": "AK/CA/HI/OR/WA"},
    # Florida — all five zones required for FL-zone filtering
    {"zone_id": 121, "zone_name": "Miami",                      "state_abbr": "FL"},
    {"zone_id": 122, "zone_name": "Jacksonville",               "state_abbr": "FL"},
    {"zone_id": 123, "zone_name": "Tampa-St. Petersburg",       "state_abbr": "FL"},
    {"zone_id": 124, "zone_name": "Orlando",                    "state_abbr": "FL"},
    {"zone_id": 129, "zone_name": "Remainder of Florida",       "state_abbr": "FL"},
]

# All 42 SCTG 2-digit commodity codes (code 42 is unused; sequence goes 41 → 43). SWFL targets (12, 31, 32, 33) are noted.
SCTG_LOOKUP: list[dict] = [
    {"sctg_code": 1,  "commodity_name": "Live animals and fish"},
    {"sctg_code": 2,  "commodity_name": "Cereal grains"},
    {"sctg_code": 3,  "commodity_name": "Other agricultural products"},
    {"sctg_code": 4,  "commodity_name": "Animal feed"},
    {"sctg_code": 5,  "commodity_name": "Meat and seafood"},
    {"sctg_code": 6,  "commodity_name": "Milled grain products"},
    {"sctg_code": 7,  "commodity_name": "Other prepared foodstuffs"},
    {"sctg_code": 8,  "commodity_name": "Alcoholic beverages"},
    {"sctg_code": 9,  "commodity_name": "Tobacco products"},
    {"sctg_code": 10, "commodity_name": "Building stone"},
    {"sctg_code": 11, "commodity_name": "Natural sands"},
    {"sctg_code": 12, "commodity_name": "Gravel and crushed stone"},      # SWFL target
    {"sctg_code": 13, "commodity_name": "Nonmetallic minerals"},
    {"sctg_code": 14, "commodity_name": "Metallic ores"},
    {"sctg_code": 15, "commodity_name": "Coal"},
    {"sctg_code": 16, "commodity_name": "Crude petroleum"},
    {"sctg_code": 17, "commodity_name": "Gasoline and aviation fuel"},
    {"sctg_code": 18, "commodity_name": "Fuel oils"},
    {"sctg_code": 19, "commodity_name": "Natural gas and other fuels"},
    {"sctg_code": 20, "commodity_name": "Basic chemicals"},
    {"sctg_code": 21, "commodity_name": "Pharmaceutical products"},
    {"sctg_code": 22, "commodity_name": "Fertilizers"},
    {"sctg_code": 23, "commodity_name": "Chemical products"},
    {"sctg_code": 24, "commodity_name": "Plastics and rubber"},
    {"sctg_code": 25, "commodity_name": "Logs and rough wood"},
    {"sctg_code": 26, "commodity_name": "Wood products"},
    {"sctg_code": 27, "commodity_name": "Pulp and paper"},
    {"sctg_code": 28, "commodity_name": "Paper articles"},
    {"sctg_code": 29, "commodity_name": "Printed products"},
    {"sctg_code": 30, "commodity_name": "Textiles and leather"},
    {"sctg_code": 31, "commodity_name": "Nonmetallic mineral products"},  # SWFL target
    {"sctg_code": 32, "commodity_name": "Base metals"},                   # SWFL target
    {"sctg_code": 33, "commodity_name": "Articles of base metal"},        # SWFL target
    {"sctg_code": 34, "commodity_name": "Machinery"},
    {"sctg_code": 35, "commodity_name": "Electronics"},
    {"sctg_code": 36, "commodity_name": "Motorized vehicles"},
    {"sctg_code": 37, "commodity_name": "Transportation equipment"},
    {"sctg_code": 38, "commodity_name": "Precision instruments"},
    {"sctg_code": 39, "commodity_name": "Furniture"},
    {"sctg_code": 40, "commodity_name": "Miscellaneous manufactured products"},
    {"sctg_code": 41, "commodity_name": "Waste and scrap"},
    {"sctg_code": 43, "commodity_name": "Mixed freight"},
]
