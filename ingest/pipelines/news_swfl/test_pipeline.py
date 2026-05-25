"""Tests for news_swfl NDJSON building."""
from __future__ import annotations

import json

from ingest.pipelines.news_swfl.pipeline import to_ndjson


def test_ndjson_one_line_per_article():
    out = to_ndjson([
        {"url": "https://a.example/1", "title": "A"},
        {"url": "https://b.example/2", "title": "B"},
    ])
    lines = out.decode("utf-8").strip().split("\n")
    assert len(lines) == 2
    assert json.loads(lines[0])["url"] == "https://a.example/1"
    assert json.loads(lines[1])["url"] == "https://b.example/2"


def test_ndjson_preserves_unicode():
    out = to_ndjson([{"url": "x", "title": "Sí, señor"}])
    line = out.decode("utf-8").strip()
    assert json.loads(line)["title"] == "Sí, señor"


def test_ndjson_empty_input_returns_one_byte():
    # Empty input still terminates with a newline; size will be 1 byte.
    out = to_ndjson([])
    assert out == b"\n"
