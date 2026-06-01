"""Unit tests for DBPR public notices parse module.

All fixtures are inline strings based on the real PDF/index content observed 2026-06-01.
No file reads — tests run without any external dependencies.
"""
from datetime import date

import pytest

from .parse import parse_index_markdown, parse_pdf_markdown

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

COLLIER_PDF = """
## COLLIER COUNTY

STATE OF FLORIDA
DEPARTMENT OF BUSINESS AND PROFESSIONAL REGULATION

CASE NO.: 2025081234

IN RE: The practice of UNLICENSED general contracting by Jhandy Garcia

BEFORE THE CONSTRUCTION INDUSTRY LICENSING BOARD

Jhandy Garcia
123 Main St
Naples, FL 34101

You are hereby notified that you must respond by June 15, 2026.
"""

SARASOTA_PDF = """
## SARASOTA COUNTY

STATE OF FLORIDA
DEPARTMENT OF BUSINESS AND PROFESSIONAL REGULATION

CASE NO.: 2025099001

IN RE: The practice of real estate brokerage without a valid license by Brian Fischer

BEFORE THE FLORIDA REAL ESTATE COMMISSION

Brian Fischer
456 Oak Ave
Sarasota, FL 34230

You must respond by June 8, 2026.
"""

# Two case numbers on one CASE NO.: line — Manatee typo/amendment scenario
MANATEE_TWO_CASE_PDF = """
## MANATEE COUNTY

STATE OF FLORIDA
DEPARTMENT OF BUSINESS AND PROFESSIONAL REGULATION

CASE NO.: 2025057489, 202563707

IN RE: The practice of real estate sales without a license by Dale Sexton

BEFORE THE FLORIDA REAL ESTATE COMMISSION

Dale Sexton
789 Beach Rd
Bradenton, FL 34205

You are required to respond by June 1, 2026.
"""

# Index page markdown with SWFL + non-SWFL counties
INDEX_MD = """
# Florida DBPR Public Notices

##### Lee County

No Updated Notice

##### Collier County

[Jhandy Garcia](https://www2.myfloridalicense.com/notices/collier/2025081234.pdf)

##### Charlotte County

No Updated Notice

##### Sarasota County

[Brian Fischer](https://www2.myfloridalicense.com/notices/sarasota/2025099001.pdf)
[Florida Investors PM LLC](https://www2.myfloridalicense.com/notices/sarasota/2025099002.pdf)

##### Manatee County

[Dale Sexton](https://www2.myfloridalicense.com/notices/manatee/2025057489.pdf)
[Dale Sexton](https://www2.myfloridalicense.com/notices/manatee/2025057490.pdf)
[Christopher Weiss](https://www2.myfloridalicense.com/notices/manatee/2025060001.pdf)

##### Hendry County

No Updated Notice

##### Monroe County

No Updated Notice

##### Miami-Dade County

[Some Non-SWFL Person](https://www2.myfloridalicense.com/notices/miami/2025000001.pdf)

##### Broward County

[Another Non-SWFL Person](https://www2.myfloridalicense.com/notices/broward/2025000002.pdf)
"""

# ---------------------------------------------------------------------------
# Tests: parse_pdf_markdown
# ---------------------------------------------------------------------------

class TestCollierUnlicensed:
    def setup_method(self):
        self.result = parse_pdf_markdown(COLLIER_PDF, 'https://example.com/collier.pdf', 'Jhandy Garcia')

    def test_county(self):
        assert self.result['county'] == 'Collier'

    def test_violation_type(self):
        assert self.result['violation_type'] == 'unlicensed_activity'

    def test_industry(self):
        assert self.result['industry'] == 'construction'

    def test_case_number(self):
        assert self.result['case_number'] == '2025081234'

    def test_all_case_numbers(self):
        assert self.result['all_case_numbers'] == ['2025081234']

    def test_response_deadline(self):
        assert self.result['response_deadline'] == date(2026, 6, 15)

    def test_respondent_name_from_hint(self):
        assert self.result['respondent_name'] == 'Jhandy Garcia'


class TestSarasotaDisciplinary:
    def setup_method(self):
        self.result = parse_pdf_markdown(SARASOTA_PDF, 'https://example.com/sarasota.pdf', 'Brian Fischer')

    def test_county(self):
        assert self.result['county'] == 'Sarasota'

    def test_violation_type(self):
        assert self.result['violation_type'] == 'disciplinary'

    def test_industry(self):
        assert self.result['industry'] == 'real_estate'

    def test_response_deadline(self):
        assert self.result['response_deadline'] == date(2026, 6, 8)


class TestManateeTwoCaseNumbers:
    def setup_method(self):
        self.result = parse_pdf_markdown(MANATEE_TWO_CASE_PDF, 'https://example.com/manatee.pdf', 'Dale Sexton')

    def test_case_number_is_first(self):
        assert self.result['case_number'] == '2025057489'

    def test_all_case_numbers_has_two(self):
        assert len(self.result['all_case_numbers']) == 2
        assert self.result['all_case_numbers'][0] == '2025057489'

    def test_response_deadline(self):
        assert self.result['response_deadline'] == date(2026, 6, 1)


# ---------------------------------------------------------------------------
# Tests: parse_index_markdown
# ---------------------------------------------------------------------------

class TestIndexParsing:
    def setup_method(self):
        self.notices = parse_index_markdown(INDEX_MD)

    def test_swfl_county_count(self):
        # Lee: 0, Charlotte: 0, Hendry: 0, Monroe: 0
        # Collier: 1, Sarasota: 2, Manatee: 3 = 6 total
        assert len(self.notices) == 6

    def test_non_swfl_excluded(self):
        counties = {n['county'] for n in self.notices}
        assert 'Miami-Dade' not in counties
        assert 'Broward' not in counties

    def test_collier_link(self):
        collier = [n for n in self.notices if n['county'] == 'Collier']
        assert len(collier) == 1
        assert collier[0]['respondent_name'] == 'Jhandy Garcia'
        assert '2025081234.pdf' in collier[0]['pdf_url']

    def test_sarasota_two_links(self):
        sarasota = [n for n in self.notices if n['county'] == 'Sarasota']
        assert len(sarasota) == 2

    def test_manatee_three_links(self):
        manatee = [n for n in self.notices if n['county'] == 'Manatee']
        assert len(manatee) == 3

    def test_no_updated_notice_counties_absent(self):
        # Lee, Charlotte, Hendry, Monroe all had "No Updated Notice" — zero rows
        empty_counties = {'Lee', 'Charlotte', 'Hendry', 'Monroe'}
        result_counties = {n['county'] for n in self.notices}
        assert not empty_counties.intersection(result_counties)
