"""Tests for spider_client.download_binary — the WAF-surviving binary fetch
used by collier_permits. No live network: `_post` is monkeypatched.
"""
from __future__ import annotations

import pytest

from ingest.lib import spider_client
from ingest.lib.spider_client import SpiderError, download_binary


def test_download_binary_reconstructs_bytes_from_int_list(monkeypatch):
    # Spider /scrape return_format=bytes yields `content` as a list of 0-255 ints.
    payload = list(b"PK\x03\x04hello-xlsx-bytes\xff\x00")
    monkeypatch.setattr(
        spider_client,
        "_post",
        lambda path, body: [{"status": 200, "error": None, "content": payload}],
    )
    out = download_binary("https://x/file.xlsx")
    assert out == bytes(payload)
    assert out[:4] == b"PK\x03\x04"


def test_download_binary_sends_http_bytes_params(monkeypatch):
    captured: dict = {}

    def fake_post(path, body):
        captured["path"] = path
        captured["body"] = body
        return [{"status": 200, "content": list(b"PK\x03\x04")}]

    monkeypatch.setattr(spider_client, "_post", fake_post)
    download_binary("https://x/file.xlsx")
    assert captured["path"] == "/scrape"
    # The only binary-safe combo (proven live 2026-06-14): http + bytes + proxy.
    assert captured["body"]["request"] == "http"
    assert captured["body"]["return_format"] == "bytes"
    assert captured["body"]["stealth"] is True
    assert captured["body"]["proxy_enabled"] is True
    # request_timeout intentionally NOT sent — Spider types it u8, not ms.
    assert "request_timeout" not in captured["body"]


def test_download_binary_raises_on_upstream_4xx(monkeypatch):
    monkeypatch.setattr(
        spider_client,
        "_post",
        lambda path, body: [{"status": 403, "error": "blocked", "content": None}],
    )
    with pytest.raises(SpiderError, match="403"):
        download_binary("https://x/file.xlsx")


def test_download_binary_raises_when_content_not_a_byte_list(monkeypatch):
    # request=chrome/smart fallback returns an HTML viewer string, not a byte list.
    monkeypatch.setattr(
        spider_client,
        "_post",
        lambda path, body: [{"status": 200, "content": "<html>viewer wrapper</html>"}],
    )
    with pytest.raises(SpiderError, match="byte list"):
        download_binary("https://x/file.xlsx")


def test_download_binary_raises_on_empty_content(monkeypatch):
    monkeypatch.setattr(
        spider_client,
        "_post",
        lambda path, body: [{"status": 200, "content": []}],
    )
    with pytest.raises(SpiderError):
        download_binary("https://x/file.xlsx")
