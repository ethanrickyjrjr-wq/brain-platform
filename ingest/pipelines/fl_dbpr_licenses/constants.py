"""Constants for the FL DBPR Contractor Licenses ingest pipeline."""

# DBPR bulk data portal CSV URLs (comma-delimited with double-quoted fields).
# NOTE: the extracts are comma-delimited (NOT pipe-delimited as older DBPR docs suggest).
# Confirmed: dry-run run 26737961975 showed first raw row with 1 pipe-col / many comma-cols.
# Published by the Florida Department of Business & Professional Regulation (DBPR).
# Source portal: https://www2.myfloridalicense.com/instant-public-records/
#
# ⛔ DO NOT add CONSTRUCTIONLICENSE_2.csv / _3.csv here. They are FROZEN 2019 legacy files,
#    NOT current chunks — verified live 2026-06-13 three ways: (1) last-modified 2019-10-12
#    (vs _1 refreshed daily); (2) different 20-col format with county as a NAME ("Broward")
#    not the 46/21 code, all licenses expired 08/31/2020; (3) DBPR's page links only _1.
#    Adding them would misread the layout, match ZERO Lee/Collier rows, and inject expired
#    dead licenses — a regression, not a fix. _1 alone (267k rows) is the complete current
#    set. The "3-chunk undercount" alarm was a phantom. Full proof + the one genuinely-open
#    cilb question: docs/handoff/2026-06-13-dbpr-license-chunk-undercount.md
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
# Construction Applicants file (the only file under "Applicant Files" on the DBPR
# construction-industry public-records page; verified live 2026-06-13: 200 text/csv,
# ~14.9 MB, 103,291 rows). The old CONSTRUCTIONAPPLICANT_1.csv 301-redirects to an HTML
# homepage (file does not exist) → _stream_csv returned [] → table never landed.
APPLICANTS_URL = "https://www2.myfloridalicense.com/sto/file_download/extracts/constr_app.csv"

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

# ── Applicant CSV column positions (0-indexed, constr_app.csv)
# VERIFIED live 2026-06-13 against the actual file: 103,291 rows, ALL 15 columns.
# CAUTION: DBPR's *published* layout doc lists only 11 fields with a combined
# "City, State, Zip" and NO county column — that stale doc is exactly what the old
# code coded to (the root cause of this bug). The real file splits address into 3,
# splits city/state/zip, and carries a DBPR 2-digit county_code at col 12.
# Trust the probed file, not the published doc.
COL_APP_OCC_CODE = 0     # Occupation Number (e.g. "0605")
COL_APP_OCC_DESC = 1     # Occupation Description
COL_APP_FIRST = 2        # First Name
COL_APP_MID = 3          # Second / Middle Name
COL_APP_LAST = 4         # Last Name
COL_APP_SUFFIX = 5       # Suffix
COL_APP_ADDR1 = 6        # Address 1
COL_APP_ADDR2 = 7        # Address 2
COL_APP_ADDR3 = 8        # Address 3
COL_APP_CITY = 9         # City
COL_APP_STATE = 10       # State
COL_APP_ZIP = 11         # Zip
COL_APP_COUNTY = 12      # county_code — DBPR 2-digit; filter "46" (Lee) / "21" (Collier)
COL_APP_PHONE = 13       # Phone Number
COL_APP_EXT = 14         # Phone Number Extension

# Minimum row length for applicant rows (must have through COL_APP_EXT)
MIN_APP_ROW_LEN = COL_APP_EXT + 1
