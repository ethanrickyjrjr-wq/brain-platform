"""Constants for the FL DBPR Contractor Licenses ingest pipeline."""

# DBPR bulk data portal CSV URLs (comma-delimited with double-quoted fields).
# NOTE: the extracts are comma-delimited (NOT pipe-delimited as older DBPR docs suggest).
# Confirmed: dry-run run 26737961975 showed first raw row with 1 pipe-col / many comma-cols.
# Published by the Florida Department of Business & Professional Regulation (DBPR).
# Source portal: https://www2.myfloridalicense.com/instant-public-records/
LICENSES_URLS = [
    (
        "https://www2.myfloridalicense.com/sto/file_download/extracts//CONSTRUCTIONLICENSE_1.csv",
        "06",  # Construction Board
    ),
    (
        "https://www2.myfloridalicense.com/sto/file_download/extracts/lic08el.csv",
        "08",  # Electrical Contractors Board
    ),
]
APPLICANTS_URL = "https://www2.myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONAPPLICANT_1.csv"

# Human-readable citation URL for provenance
DBPR_CITATION_URL = "https://www2.myfloridalicense.com/instant-public-records/"

# County filter: Collier = "21", Lee = "46"
COUNTY_FILTER = {"21": "Collier", "46": "Lee"}

# ── License CSV column positions (0-indexed, CONSTRUCTIONLICENSE_1.csv / lic08el.csv)
# Verified column layout from DBPR bulk extract spec.
COL_BOARD = 0       # board_number (06=Construction, 08=Electrical)
COL_OCC_CODE = 1    # occupation_code (CGC, CBC, CRC, EC, etc.)
COL_LICENSEE = 2    # licensee_name
COL_DBA = 3         # dba_name
COL_COUNTY = 11     # county_code — filter: "21" (Collier) or "46" (Lee)
COL_LICENSE_NO = 12  # license_number — primary key
COL_PRI_STATUS = 13  # primary_status (C=Current, P=Probation, S=Suspended)
COL_SEC_STATUS = 14  # secondary_status (A=Active, I=Inactive)
COL_ORIG_DATE = 15  # original_licensure_date
COL_EFF_DATE = 16   # effective_date
COL_EXP_DATE = 17   # expiration_date

# Minimum row length (must have at least through COL_EXP_DATE)
MIN_ROW_LEN = COL_EXP_DATE + 1

# ── Applicant CSV column positions (0-indexed, CONSTRUCTIONAPPLICANT_1.csv)
# Known public-records layout:
# Occ Number | Occ Description | First Name | Second Name | Last Name | Suffix
# | Address 1 | Address 2 | City/State/Zip | Phone | Extension
COL_APP_OCC_CODE = 0     # Occupation Number (e.g. "CBC")
COL_APP_OCC_DESC = 1     # Occupation Description
COL_APP_FIRST = 2        # First Name
COL_APP_SECOND = 3       # Second Name / Middle
COL_APP_LAST = 4         # Last Name
COL_APP_SUFFIX = 5       # Suffix
COL_APP_ADDR1 = 6        # Address 1
COL_APP_ADDR2 = 7        # Address 2
COL_APP_CITY_ST_ZIP = 8  # "City, State Zip" combined field — stored raw in city; state/zip = None
COL_APP_PHONE = 9        # Phone
COL_APP_EXT = 10         # Extension

# Minimum row length for applicant rows
MIN_APP_ROW_LEN = COL_APP_PHONE + 1
