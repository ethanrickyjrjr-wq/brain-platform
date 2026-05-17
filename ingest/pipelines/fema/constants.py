NFHL_LAYERS = [
    {"name": "flood_zones", "url": "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"},
    {"name": "lomr",        "url": "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/1/query"},
    {"name": "loma",        "url": "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/34/query"},
    {"name": "bfe",         "url": "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/16/query"},
]
NFIP_CLAIMS_URL = "https://www.fema.gov/api/open/v2/FimaNfipClaims"
GEOMETRY_BUCKET = "raw-geometry"
TABULAR_BUCKET  = "raw-tabular-cold"
