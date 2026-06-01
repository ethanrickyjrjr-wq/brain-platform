import re
from dateutil.parser import parse as parse_date

SWFL_COUNTIES = {'lee', 'collier', 'charlotte', 'sarasota', 'manatee', 'hendry', 'monroe'}

# Maps BEFORE THE [BOARD] text → industry slug.
# Match is case-insensitive substring search; first match wins.
BOARD_INDUSTRY_MAP = [
    ('REAL ESTATE',              'real_estate'),
    ('CONSTRUCTION INDUSTRY',    'construction'),
    ('ELECTRICAL CONTRACTORS',   'electrical'),
    ('COSMETOLOGY',              'cosmetology'),
    ('PHARMACY',                 'pharmacy'),
    ('PROFESSIONAL ENGINEERS',   'engineering'),
    ('LANDSCAPE ARCHITECTS',     'landscape'),
    ('ARCHITECTS',               'architecture'),
    ('ACCOUNTANCY',              'accounting'),
    ('MEDICAL',                  'medical'),
    ('NURSING',                  'nursing'),
    ('VETERINARY',               'veterinary'),
    ('GENERAL CONTRACTORS',      'construction'),
]


def parse_pdf_markdown(text: str, pdf_url: str, respondent_hint: str = '') -> dict:
    """Parse PDF markdown from Firecrawl into structured notice fields.

    respondent_hint: name from the index page link text (pre-parsed, used as fallback).
    Returns a dict matching the dbpr_public_notices columns (excluding id, created_at).
    """
    result = {
        'pdf_url': pdf_url,
        'respondent_name': respondent_hint or None,
        'county': None,
        'case_number': None,
        'all_case_numbers': [],
        'violation_type': None,
        'industry': None,
        'pdf_summary': None,   # filled by summarize.py
        'response_deadline': None,
    }

    # County — first ## header ending in COUNTY
    county_m = re.search(r'^## (.+?) COUNTY', text, re.MULTILINE | re.IGNORECASE)
    if county_m:
        result['county'] = county_m.group(1).strip().title()

    # Case numbers — CASE NO.: 2025057489, 2025063707
    case_m = re.search(r'CASE NO\.\s*:\s*([^\n]+)', text, re.IGNORECASE)
    if case_m:
        raw = case_m.group(1).strip()
        parts = [p.strip() for p in re.split(r'[,\s]+', raw) if p.strip()]
        result['all_case_numbers'] = parts
        result['case_number'] = parts[0] if parts else None

    # Violation type — IN RE: The practice of [UNLICENSED] X
    in_re_m = re.search(r'IN RE:\s*The practice of\s+(.+)', text, re.IGNORECASE)
    if in_re_m:
        practice = in_re_m.group(1).strip()
        if re.match(r'UNLICENSED', practice, re.IGNORECASE):
            result['violation_type'] = 'unlicensed_activity'
        else:
            result['violation_type'] = 'disciplinary'

    # Industry — BEFORE THE [BOARD NAME]
    board_m = re.search(r'BEFORE THE\s+(.+)', text, re.IGNORECASE)
    if board_m:
        board_text = board_m.group(1).upper()
        for keyword, slug in BOARD_INDUSTRY_MAP:
            if keyword in board_text:
                result['industry'] = slug
                break
        if not result['industry'] and in_re_m:
            practice_lower = in_re_m.group(1).lower()
            for keyword, slug in BOARD_INDUSTRY_MAP:
                if keyword.lower() in practice_lower:
                    result['industry'] = slug
                    break

    # Response deadline — "by Month DD, YYYY"
    deadline_m = re.search(r'by\s+([A-Z][a-z]+ \d{1,2},\s*\d{4})', text)
    if deadline_m:
        try:
            result['response_deadline'] = parse_date(deadline_m.group(1)).date()
        except Exception:
            pass

    return result


def parse_index_markdown(text: str) -> list:
    """Extract SWFL notice links from the index page markdown.

    Returns list of {'county': str, 'respondent_name': str, 'pdf_url': str}.
    Skips counties with no active notices. Skips non-SWFL counties.
    """
    notices = []
    current_county = None

    for line in text.splitlines():
        # County header: ##### Lee County  or  ##### **Lee County✓**
        county_m = re.match(
            r'^#+\s+\*{0,2}([A-Za-z\s-]+?)\s*(?:County|COUNTY)\s*[✓✔]?\*{0,2}\s*$', line
        )
        if county_m:
            name = county_m.group(1).strip().lower()
            current_county = name if name in SWFL_COUNTIES else None
            continue

        if current_county is None:
            continue

        # PDF link: [Respondent Name](https://...pdf)
        link_m = re.match(r'^\s*\[(.+?)\]\((https?://[^\)]+\.pdf)\)', line, re.IGNORECASE)
        if link_m:
            notices.append({
                'county': current_county.title(),
                'respondent_name': link_m.group(1).strip(),
                'pdf_url': link_m.group(2).strip(),
            })

    return notices
