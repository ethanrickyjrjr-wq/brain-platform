"""Constants for the Collier County parcel ingest (FDOR Statewide Cadastral).

Source is the Florida Department of Revenue statewide cadastral (the annual
tax roll in GIS form), served as a public ArcGIS FeatureServer — the auto-
ingestable equivalent of Lee's LeePA appraiser feed. Free, no auth, no scraping.

Verified live 2026-06-06:
  - FeatureServer layer 0 "FDOR Cadastral 2025", maxRecordCount 2000, pagination on.
  - where=CO_NO=21 -> 364,827 parcels, cities NAPLES / MARCO ISLAND.
  - CO_NO=21 is EMPIRICALLY Collier in THIS layer (FIPS-style). It is NOT the FDOR
    tax-roll county code 11 (that numbering names the NAL flat file). Cross-check:
    CO_NO=71 returns O'Brien/Suwannee, so the scheme is non-obvious — DO NOT
    "correct" 21 to 11. The 21 is verified by the returned city names + count.
  - Fields present: PARCEL_ID, JV, JV_HMSTD, AV_HMSTD, AV_SD, AV_NSD, TV_NSD,
    SALE_YR1, SALE_MO1, QUAL_CD1, VI_CD1, PHY_ZIPCD, DOR_UC, PA_UC.
"""

COLLIER_CADASTRAL_URL = (
    "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services"
    "/Florida_Statewide_Cadastral/FeatureServer/0/query"
)

# EMPIRICALLY verified Collier filter for THIS layer — do not change to 11.
COLLIER_CO_NO_WHERE = "CO_NO=21"

# FDOR qualified arms-length sale code (verified: code 01 carries realistic prices;
# nominal $100 transfers carry disqualified codes 11/17/30/37).
QUALIFIED_SALE_CODE = "01"

OUT_FIELDS = (
    "PARCEL_ID,JV,JV_HMSTD,AV_HMSTD,AV_SD,AV_NSD,TV_NSD,"
    "SALE_YR1,SALE_MO1,QUAL_CD1,VI_CD1,PHY_ZIPCD,DOR_UC,PA_UC"
)

PAGE_SIZE = 2000  # = layer maxRecordCount
