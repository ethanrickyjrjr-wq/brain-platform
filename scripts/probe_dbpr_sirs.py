"""
Probe the DBPR SIRS Qlik grid for the QIX websocket + ExportData path.

Approach (priority order from task spec):
  1. Capture wss:// QIX engine websocket URL + JSON-RPC frames via Playwright
     page.on("websocket") — crawl4ai.capture_network_requests misses WS frames.
  2. Surface xrfkey from HTTP headers (needed to authenticate a direct ws client).
  3. Try Playwright-native right-click on the grid → export context menu
     (synthetic JS events don't work on Angular handlers; Playwright's click() is native OS).
  4. Report: ws URL + ExportData/tempcontent URL (path 1/2), or "scroll-accumulate next"
     (path 3), or "ODD-only wall".

Usage:
  python scripts/probe_dbpr_sirs.py

Takes ~60s total (navigation 20s + WS settle 15s + export attempt 10s + buffer).
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from datetime import datetime

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("ERROR: playwright not installed — run: pip install playwright && playwright install chromium")
    sys.exit(1)

PRE_JULY_URL = (
    "https://dbpr-publicrecords.myfloridalicense.com/qpr/single/"
    "?appid=14f1ed21-7b21-4272-af14-9eaad7911440&sheet=mcprvJW&opt=ctxmenu"
)
JULY_URL = (
    "https://dbpr-publicrecords.myfloridalicense.com/qpr/single/"
    "?appid=d217126f-2edc-408b-bb98-2c355b6f0429&sheet=HUGAcyE&opt=ctxmenu"
)

VIEWPORT_W = 3000  # proven fix for horizontal virtualization (columns County/ID clipped at ~1400)
VIEWPORT_H = 900


async def probe_url(url: str, label: str) -> dict:
    print(f"\n{'='*72}")
    print(f"  {label}")
    print(f"  {url}")
    print(f"{'='*72}")

    ws_connections: list[dict] = []
    http_qlik: list[dict] = []
    xrfkeys: list[str] = []
    tempcontent_urls: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": VIEWPORT_W, "height": VIEWPORT_H},
            accept_downloads=True,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = await ctx.new_page()

        # -- WebSocket hook ---------------------------------------------------
        # Playwright Python: framesent/framereceived give a WebSocketFrame with
        # .text (str, for text frames) and .payload (bytes, for binary frames).
        # QIX uses EITHER text JSON-RPC (older) or binary (msgpack).
        # We store both: decoded text OR hex snippet of first 80 bytes.
        def on_websocket(ws):
            entry = {
                "url": ws.url,
                "connected_at": datetime.now().isoformat(timespec="seconds"),
                "sent": [],
                "received": [],
            }
            ws_connections.append(entry)
            print(f"\n  [WS CONNECT] {ws.url}")

            def _frame_repr(frame) -> str:
                # Try text first (JSON-RPC)
                txt = getattr(frame, "text", None)
                if txt:
                    return txt
                # Binary: show hex of first 80 bytes
                payload = getattr(frame, "payload", b"")
                if isinstance(payload, bytes) and payload:
                    return f"<binary {len(payload)}B hex={payload[:80].hex()}>"
                # Fallback: inspect the object
                return repr(frame)[:200]

            def on_sent(frame):
                rep = _frame_repr(frame)
                entry["sent"].append(rep)
                if any(kw in rep for kw in ("ExportData", "GetObject", "OpenDoc", "GetHyperCubeData")):
                    print(f"  [WS->OUT] {rep[:300]}")

            def on_received(frame):
                rep = _frame_repr(frame)
                entry["received"].append(rep)
                if any(kw in rep for kw in ("ExportData", "tempcontent", "qExportState")):
                    print(f"  [<-WS] {rep[:500]}")
                    if "tempcontent" in rep:
                        for m in re.finditer(r"tempcontent[^\s\"'\\]+", rep):
                            tempcontent_urls.append(m.group())
                            print(f"  *** TEMPCONTENT: {m.group()} ***")

            ws.on("framesent", on_sent)
            ws.on("framereceived", on_received)

        page.on("websocket", on_websocket)

        # -- Download hook (in case Export data triggers a direct download) ---
        downloads: list[str] = []

        async def on_download(dl):
            suggested = dl.suggested_filename
            url_dl = dl.url
            print(f"\n  [DOWNLOAD] filename={suggested!r} url={url_dl[:200]}")
            downloads.append(url_dl)
            if "tempcontent" in url_dl:
                tempcontent_urls.append(url_dl)
                print(f"  *** TEMPCONTENT from download: {url_dl} ***")

        page.on("download", on_download)

        # ── HTTP hook (xrfkey + tempcontent) ──────────────────────────────
        def on_request(req):
            u = req.url
            if "myfloridalicense.com" not in u and "qlik" not in u.lower():
                return
            try:
                hdrs = req.headers
                key = hdrs.get("x-qlik-xrfkey", "")
                if key and key not in xrfkeys:
                    xrfkeys.append(key)
                    print(f"\n  [XRFKEY] {key}")
                if "tempcontent" in u:
                    tempcontent_urls.append(u)
                    print(f"  [TEMPCONTENT HTTP] {u}")
                http_qlik.append({"method": req.method, "url": u[:200]})
            except Exception:
                pass

        page.on("request", on_request)

        # ── Navigate ───────────────────────────────────────────────────────
        print(f"\n  Navigating with viewport {VIEWPORT_W}×{VIEWPORT_H}...")
        nav_ok = False
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            nav_ok = True
        except Exception as e:
            print(f"  [ERROR] navigation: {e}")

        if not nav_ok:
            await browser.close()
            return {"error": "navigation failed", "ws_count": 0}

        # ── Wait for Qlik grid ─────────────────────────────────────────────
        print("  Waiting for Qlik grid...")
        grid_sel_found = None
        for sel in [
            "qv-st-data",
            ".qv-st-data",
            "[class*='st-data-row']",
            "qv-straight-table",
            ".qv-st-header",
            ".qv-inner-object",
        ]:
            try:
                await page.wait_for_selector(sel, timeout=15_000)
                grid_sel_found = sel
                print(f"  [OK] Grid ready via '{sel}'")
                break
            except Exception:
                pass

        if not grid_sel_found:
            print("  [WARN] Grid selector not found — grid may be still loading or blocked")
            # Still wait for WS traffic
            await page.wait_for_timeout(5_000)

        # ── Settle WS traffic ──────────────────────────────────────────────
        print("  Letting WS traffic settle (12s)...")
        await page.wait_for_timeout(12_000)

        # ── DOM snapshot ───────────────────────────────────────────────────
        dom_info = await page.evaluate("""() => {
            const rows = document.querySelectorAll('qv-st-data-row, [class*="st-data-row"]');
            const cols = document.querySelectorAll('qv-st-header-cell, [class*="st-header-cell"]');
            const obj_content = [];
            document.querySelectorAll('[id$="_content"]').forEach(el => obj_content.push(el.id));
            const scrollbar = !!document.querySelector('.qv-st-data-scrollbar, [class*="st-data-scrollbar"]');
            // sample first few row texts
            const sample = [];
            rows.forEach((r, i) => { if (i < 3) sample.push(r.textContent?.trim()?.slice(0, 120) || ''); });
            return {rows: rows.length, cols: cols.length, obj_content, scrollbar, sample};
        }""")
        print(f"\n  DOM snapshot:")
        print(f"    Visible rows: {dom_info['rows']}")
        print(f"    Header cols:  {dom_info['cols']}")
        print(f"    Custom scrollbar present: {dom_info['scrollbar']}")
        print(f"    Object content IDs: {dom_info['obj_content'][:8]}")
        if dom_info["sample"]:
            print("    First row samples:")
            for s in dom_info["sample"]:
                print(f"      {s}")

        # -- Right-click export attempt -----------------------------------------
        if grid_sel_found:
            print("\n  Trying Playwright-native right-click (native OS events, not synthetic JS)...")
            try:
                header_el = await page.query_selector(
                    "qv-st-header-cell, .qv-st-header-cell, [class*='st-header-cell'], qv-st-data"
                )
                if header_el:
                    await header_el.hover()
                    await page.wait_for_timeout(400)
                    await header_el.click(button="right")
                    await page.wait_for_timeout(3_000)

                    menu_items = await page.evaluate("""() => {
                        const sel = [
                            '.context-menu li', '.qv-context-menu li', '[class*="context-menu"] li',
                            '[class*="menu-item"]', '.dropdown-menu li', 'qv-ui-menu li',
                            '[class*="ng-menu"] li', '[role="menuitem"]',
                        ].join(', ');
                        const items = [];
                        document.querySelectorAll(sel).forEach(el => {
                            const t = el.textContent?.trim();
                            if (t) items.push(t);
                        });
                        return items;
                    }""")

                    if menu_items:
                        print(f"  Context menu items (header right-click): {menu_items[:15]}")
                        # Prefer "Export data" (XLSX) over image/PDF
                        export_item = next(
                            (m for m in menu_items if re.search(r"export\s+data", m, re.I)),
                            None,
                        )
                        if export_item is None:
                            export_item = next(
                                (m for m in menu_items if "spreadsheet" in m.lower()),
                                None,
                            )
                        if export_item:
                            print(f"  *** Clicking: '{export_item}' ***")
                            await page.get_by_text(export_item, exact=True).first.click()
                            print("  Waiting 15s for ExportData WS frame + tempcontent URL...")
                            await page.wait_for_timeout(15_000)
                            # Capture any download dialog URL too
                            dl_url = await page.evaluate("""() => {
                                const a = document.querySelector('a[href*="tempcontent"], a[download]');
                                return a ? a.href : null;
                            }""")
                            if dl_url:
                                tempcontent_urls.append(dl_url)
                                print(f"  *** DOWNLOAD LINK: {dl_url} ***")
                        else:
                            print(f"  No 'Export data' item found in: {menu_items}")
                    else:
                        print("  No context menu items found via header right-click")
            except Exception as e:
                print(f"  [WARN] right-click attempt: {e}")

        # Final settle after any export attempt
        await page.wait_for_timeout(5_000)

        # ── Full page URL + cookies ────────────────────────────────────────
        final_url = page.url
        cookies = await ctx.cookies()
        qlik_cookie_names = [c["name"] for c in cookies if "qlik" in c["name"].lower() or "session" in c["name"].lower()]

        await browser.close()

    # ── Report ─────────────────────────────────────────────────────────────
    print(f"\n{'-'*72}")
    print(f"  RESULTS: {label}")
    print(f"{'-'*72}")
    print(f"  Final page URL: {final_url}")
    print(f"  Session-related cookies: {qlik_cookie_names}")
    print(f"  xrfkey(s) captured: {xrfkeys}")
    print(f"  tempcontent URLs: {tempcontent_urls}")
    print(f"  downloads triggered: {downloads}")
    print(f"\n  WebSocket connections: {len(ws_connections)}")

    for ws in ws_connections:
        print(f"\n    WS: {ws['url']}")
        print(f"       frames sent:     {len(ws['sent'])}")
        print(f"       frames received: {len(ws['received'])}")

        # First few sent frames
        if ws["sent"]:
            print("       First 6 SENT frames:")
            for f in ws["sent"][:6]:
                print(f"         -> {str(f)[:280]}")

        # Any ExportData / GetHyperCubeData / interesting received frames
        interesting_recv = [
            f for f in ws["received"]
            if any(kw in str(f) for kw in ("ExportData", "tempcontent", "GetHyperCubeData", "qSize", "qDataPages"))
        ]
        if interesting_recv:
            print(f"       Interesting RECEIVED frames ({len(interesting_recv)}):")
            for f in interesting_recv[:4]:
                print(f"         <- {str(f)[:400]}")

    has_ws = len(ws_connections) > 0
    has_export = any(
        "ExportData" in str(f) or "tempcontent" in str(f)
        for ws in ws_connections
        for f in ws["sent"] + ws["received"]
    )

    print(f"\n  HTTP requests to myfloridalicense.com: {len(http_qlik)}")
    for r in http_qlik[:25]:
        print(f"    [{r['method']}] {r['url']}")

    print(f"\n  VERDICT:")
    if has_export or tempcontent_urls:
        print("  PATH 1/2 OPEN: ExportData / tempcontent found -- extract URL, download, parse XLSX")
    elif has_ws:
        ws_urls = [ws["url"] for ws in ws_connections]
        print(f"  QIX WS found (no ExportData yet): {ws_urls}")
        print("  Next: direct python websockets client -> GetObject -> ExportData/GetHyperCubeData paging")
        print("  OR: try triggering export via the right-click menu in a headful session")
    else:
        print("  NO WS CAPTURED -- check: auth wall? Qlik using long-poll HTTP? datacenter IP blocked?")
        print("  Next: ODD scaffold (Operation Dumbo Drop) -- park cadence, Tier-1 cold target, source_tag")

    return {
        "ws_count": len(ws_connections),
        "ws_urls": [ws["url"] for ws in ws_connections],
        "xrfkeys": xrfkeys,
        "tempcontent_urls": tempcontent_urls,
        "http_qlik_count": len(http_qlik),
        "has_export_data": has_export,
        "grid_selector": grid_sel_found,
    }


async def main():
    # Only probe pre-July app (7-col, includes ID) — it's the production target
    # July app is 5-col (no ID), probe separately if pre-July is a wall
    result = await probe_url(PRE_JULY_URL, "Pre-July DBPR SIRS (7 cols, appid=14f1ed21)")

    print(f"\n{'='*72}")
    print("  SUMMARY (machine-readable)")
    print(f"{'='*72}")
    print(json.dumps(result, indent=2))

    # Exit code signals to the operator:
    # 0 = WS found (proceed to ExportData path)
    # 1 = WS found but no ExportData (try direct python client)
    # 2 = no WS at all (ODD scaffold)
    if result.get("has_export_data") or result.get("tempcontent_urls"):
        sys.exit(0)
    elif result.get("ws_count", 0) > 0:
        sys.exit(1)
    else:
        sys.exit(2)


if __name__ == "__main__":
    asyncio.run(main())
