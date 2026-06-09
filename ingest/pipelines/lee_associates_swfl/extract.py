"""
Lee & Associates SWFL market report PDF extractor.

Target: office + retail market reports for the Fort Myers / Naples metro.
Gap this fills: C&W MarketBeat covers industrial well; Lee & Associates
publishes office vacancy / asking rent data not in the C&W survey.

PDF extraction reuses the shared fitz-based primitives from
marketbeat_pdf/extractor.py — same PyMuPDF import convention (fitz, not pymupdf).

# URL VERIFIED 2026-06-09: https://www.lee-associates.com/research/
# Next: obtain sample SWFL PDF, implement parse_lee_table(), then graduate cadence entry.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

# Reuse shared PDF primitives; no parallel shared library needed.
from ingest.pipelines.marketbeat_pdf.extractor import (  # noqa: F401
    extract_text_blocks,
)
import fitz  # PyMuPDF — same convention as marketbeat_pdf/extractor.py

# STUB — implement table parser once live URL is verified and a sample PDF
# is in hand. See ingest/pipelines/marketbeat_pdf/extractor.py for the
# parse_cre_table pattern to follow.
VERIFIED_URL: str = "https://www.lee-associates.com/research/"


def parse_lee_table(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Parse Lee & Associates SWFL report table. NOT YET IMPLEMENTED."""
    raise NotImplementedError(
        "Lee & Associates table parser not built yet. "
        "Verify report URL first, obtain sample PDF, then implement."
    )


def download_pdf(url: str) -> bytes:
    """Download a PDF from the given URL."""
    import requests
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.content


def extract_from_pdf(pdf_bytes: bytes, source_name: str = "lee_associates") -> list[dict[str, Any]]:
    """Extract CRE rows from a Lee & Associates PDF. STUB."""
    blocks = extract_text_blocks(pdf_bytes)
    rows = parse_lee_table(blocks)
    for row in rows:
        row["source_name"] = source_name
    return rows
