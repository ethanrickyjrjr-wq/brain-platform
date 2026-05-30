import os

# CareerSource Florida LMI homepage — canonical attribution source
SOURCE_URL = (
    "https://www.careersourceflorida.com/workforce-professionals/"
    "labor-market-information/"
)

# Florida DEO / LMI OSPA portal — where the actual tabular job posting data lives
OSPA_URL = "https://lmsresources.labormarketinfo.com/Applications/OJP/JobPostings.aspx"

BUCKET = "lake-tier1"
TIER1_PATH_PREFIX = "labor/fl_deo_job_postings"

# Lee + Collier only (SWFL core market)
AREA_FIPS: dict[str, str] = {
    "lee": "12071",
    "collier": "12021",
}

COUNTY_NAMES: dict[str, str] = {
    "12071": "Lee",
    "12021": "Collier",
}

# 2-digit NAICS supersectors (BLS NAICS 2022)
# Ranges 31-33 and 44-45 and 48-49 normalised to their first code below.
NAICS_SECTORS: dict[str, str] = {
    "11": "Agriculture, Forestry, Fishing and Hunting",
    "21": "Mining, Quarrying, and Oil and Gas Extraction",
    "22": "Utilities",
    "23": "Construction",
    "31": "Manufacturing",
    "42": "Wholesale Trade",
    "44": "Retail Trade",
    "48": "Transportation and Warehousing",
    "51": "Information",
    "52": "Finance and Insurance",
    "53": "Real Estate and Rental and Leasing",
    "54": "Professional, Scientific, and Technical Services",
    "55": "Management of Companies and Enterprises",
    "56": "Administrative and Support Services",
    "61": "Educational Services",
    "62": "Health Care and Social Assistance",
    "71": "Arts, Entertainment, and Recreation",
    "72": "Accommodation and Food Services",
    "81": "Other Services (except Public Administration)",
    "92": "Public Administration",
}

# Reverse label → code for normalisation when the scraper returns labels only
NAICS_LABEL_TO_CODE: dict[str, str] = {
    label.lower(): code for code, label in NAICS_SECTORS.items()
}
