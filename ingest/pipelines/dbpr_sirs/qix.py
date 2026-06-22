"""Qlik QIX-engine websocket client for the DBPR SIRS apps.

The DBPR SIRS data lives in two Qlik Sense apps whose straight-table grids virtualize
BOTH axes (County/ID columns scroll off-screen; rows recycle on scroll) — so DOM scraping
can never capture the full statewide set. This module pulls the hypercube straight from the
QIX engine over its websocket, which returns every row with every column.

Flow (see docs/handoff/2026-06-22-dbpr-sirs-qix-findings.md):
  1. Playwright loads the single-integration page and waits for the grid to render — that is
     what makes the engine open its websocket. We capture the REAL ws URL (csrf token +
     reloadUri ride inside it; it cannot be reconstructed) plus the X-Qlik-Session-qpr cookie.
  2. A raw `websockets` client (the session survives browser close) drives JSON-RPC:
       OpenDoc -> GetAllInfos (find the single table object) -> GetObject -> GetLayout
       -> paged GetHyperCubeData.
"""
from __future__ import annotations

import asyncio
import json
from typing import Optional

import websockets
from playwright.async_api import async_playwright

BASE = "https://dbpr-publicrecords.myfloridalicense.com"
# Cells per GetHyperCubeData call are capped ~10k by the engine; page under that.
_CELL_CAP = 10_000


async def harvest_session(appid: str, sheet: str, *, headless: bool = True) -> tuple[str, str]:
    """Load the page, wait for the grid (engine opens its socket), capture the live QIX ws
    URL and the session cookie. Returns (ws_url, cookie_header)."""
    page_url = f"{BASE}/qpr/single/?appid={appid}&sheet={sheet}&opt=ctxmenu"
    ws_urls: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        ctx = await browser.new_context(viewport={"width": 2400, "height": 1400})
        page = await ctx.new_page()
        page.on(
            "websocket",
            lambda ws: ws_urls.append(ws.url) if "/qpr/app/" in ws.url else None,
        )
        await page.goto(page_url, wait_until="domcontentloaded", timeout=60_000)
        await page.wait_for_selector("table tbody tr", timeout=45_000)
        await page.wait_for_timeout(1_000)
        cookies = await ctx.cookies()
        await browser.close()
    if not ws_urls:
        raise RuntimeError(f"no QIX websocket URL captured for app {appid}")
    cookie_hdr = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
    return ws_urls[0], cookie_hdr


class _Qix:
    """Minimal QIX JSON-RPC caller — sends a request, returns the matching-id result,
    skipping the engine's unsolicited messages (OnConnected, change notifications)."""

    def __init__(self, ws) -> None:
        self.ws = ws
        self._id = 0

    async def call(self, method: str, handle: int, params: list) -> dict:
        self._id += 1
        mid = self._id
        await self.ws.send(
            json.dumps(
                {"jsonrpc": "2.0", "id": mid, "method": method, "handle": handle, "params": params}
            )
        )
        while True:
            msg = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=60))
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"QIX {method} error: {msg['error']}")
                return msg["result"]


async def _fetch_matrix(ws_url: str, cookie_hdr: str) -> tuple[list[list[Optional[str]]], int]:
    """Open the QIX socket and pull the full hypercube. Returns (rows, qcy) where each row is
    a list of cell text (qText) and qcy is the engine-reported total row count."""
    async with websockets.connect(
        ws_url, additional_headers={"Cookie": cookie_hdr}, max_size=None, open_timeout=30
    ) as ws:
        q = _Qix(ws)
        doc = await q.call("OpenDoc", -1, [_appid_from_ws(ws_url)])
        dh = doc["qReturn"]["qHandle"]

        infos = await q.call("GetAllInfos", dh, [])
        tables = [o["qId"] for o in infos.get("qInfos", []) if o.get("qType") == "table"]
        if not tables:
            raise RuntimeError("no qType='table' object in app")
        obj = await q.call("GetObject", dh, [tables[0]])
        oh = obj["qReturn"]["qHandle"]

        layout = await q.call("GetLayout", oh, [])
        size = layout["qLayout"]["qHyperCube"]["qSize"]
        qcx, qcy = size["qcx"], size["qcy"]
        page_h = max(1, _CELL_CAP // max(1, qcx))

        rows: list[list[Optional[str]]] = []
        top = 0
        while top < qcy:
            res = await q.call(
                "GetHyperCubeData",
                oh,
                ["/qHyperCubeDef", [{"qTop": top, "qLeft": 0, "qHeight": page_h, "qWidth": qcx}]],
            )
            matrix = res["qDataPages"][0]["qMatrix"]
            if not matrix:
                break
            for cells in matrix:
                rows.append([c.get("qText") for c in cells])
            top += len(matrix)
        return rows, qcy


def _appid_from_ws(ws_url: str) -> str:
    # .../qpr/app/<appid>?reloadUri=...
    return ws_url.split("/qpr/app/", 1)[1].split("?", 1)[0]


async def _fetch_app_async(appid: str, sheet: str) -> tuple[list[list[Optional[str]]], int]:
    ws_url, cookie_hdr = await harvest_session(appid, sheet)
    return await _fetch_matrix(ws_url, cookie_hdr)


def fetch_app_matrix(appid: str, sheet: str) -> tuple[list[list[Optional[str]]], int]:
    """Sync entry point: full QIX pull for one app. Returns (rows, engine_row_count)."""
    return asyncio.run(_fetch_app_async(appid, sheet))
