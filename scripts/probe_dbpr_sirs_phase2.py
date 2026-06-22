"""
Phase 2: Direct Python QIX websockets client for DBPR SIRS.

Phase 1 confirmed:
  - WS URL: wss://dbpr-publicrecords.myfloridalicense.com/qpr/app/14f1ed21-...
  - JSON-RPC text frames (not binary)
  - Straight table object ID: DAwQFJ (handle 6 in browser session)
  - GetHyperCubeData returns qMatrix rows with qText values

This script:
  1. Uses Playwright to get X-Qlik-Session-qpr cookie + WS URL (with qlik-csrf-token)
  2. Opens a raw websockets connection with that session cookie
  3. Calls: OpenDoc -> GetObject("DAwQFJ") -> GetLayout (total row count) ->
     GetHyperCubeData page 1 (100 rows x 7 cols)
  4. Reports: total rows, column names, Lee/Collier row count in page 1

Usage:
  python scripts/probe_dbpr_sirs_phase2.py

Runtime: ~45s (page load 20s + WS call chain 5-10s)
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from typing import Any

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("ERROR: playwright not installed")
    sys.exit(1)

try:
    import websockets
except ImportError:
    print("ERROR: websockets not installed -- pip install websockets")
    sys.exit(1)

APP_ID = "14f1ed21-7b21-4272-af14-9eaad7911440"
SHEET_ID = "mcprvJW"
TABLE_OBJ_ID = "DAwQFJ"  # the straight table object (confirmed phase 1)

PAGE_URL = (
    f"https://dbpr-publicrecords.myfloridalicense.com/qpr/single/"
    f"?appid={APP_ID}&sheet={SHEET_ID}&opt=ctxmenu"
)

PAGE_SIZE = 200   # rows per GetHyperCubeData call; Qlik's server cap is usually 10000
N_COLS = 7        # 7 columns in pre-July app (incl. ID + County)
SWFL_COUNTIES = {"lee", "collier"}


# ---------------------------------------------------------------------------
# Step 1: Playwright session harvest
# ---------------------------------------------------------------------------

async def harvest_session() -> tuple[str, str]:
    """Return (ws_url, session_cookie_value).
    Loads the Qlik page just long enough to get the WS handshake URL + session cookie."""
    ws_url: list[str] = []
    session_cookie: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": 3000, "height": 900},
            accept_downloads=False,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = await ctx.new_page()

        def on_ws(ws):
            if APP_ID in ws.url and not ws_url:
                ws_url.append(ws.url)
                print(f"  [WS URL captured] {ws.url[:100]}...")

        page.on("websocket", on_ws)

        print(f"  Loading page to harvest session...")
        try:
            await page.goto(PAGE_URL, wait_until="domcontentloaded", timeout=60_000)
        except Exception as e:
            print(f"  [WARN] goto: {e}")

        # Wait for WS to connect and session cookie to be set
        for _ in range(30):
            if ws_url:
                break
            await page.wait_for_timeout(1_000)

        cookies = await ctx.cookies()
        for c in cookies:
            if "qlik-session" in c["name"].lower() or "x-qlik-session" in c["name"].lower():
                session_cookie.append(f"{c['name']}={c['value']}")
                print(f"  [COOKIE] {c['name']}={c['value'][:20]}...")

        await browser.close()

    if not ws_url:
        raise RuntimeError("Could not capture WS URL from page load")
    if not session_cookie:
        raise RuntimeError("Could not capture session cookie")

    return ws_url[0], session_cookie[0]


# ---------------------------------------------------------------------------
# Step 2: Direct QIX client
# ---------------------------------------------------------------------------

class QIXError(RuntimeError):
    pass


def _unwrap(result: Any) -> Any:
    """Recursively unwrap Qlik QIX delta (JSON Patch) responses to plain values.

    Qlik sends delta=true responses where any list-typed field may be a list of
    JSON Patch operations: [{"op":"add","path":"/","value":{...}}].
    Apply at every level so callers can always .get() normally.
    Non-patch lists (like qMatrix rows) are left as lists of unwrapped items.
    """
    if isinstance(result, dict):
        return {k: _unwrap(v) for k, v in result.items()}
    if isinstance(result, list):
        if result and isinstance(result[0], dict) and "op" in result[0]:
            # JSON Patch list -> merge into one dict
            merged: dict = {}
            for op in result:
                path: str = op.get("path", "/")
                value = _unwrap(op.get("value"))
                if path == "/":
                    if isinstance(value, dict):
                        merged.update(value)
                    else:
                        return value  # scalar at root
                else:
                    key = path.lstrip("/")
                    merged[key] = value
            return merged
        # Regular list (qMatrix rows, etc.) — recurse items
        return [_unwrap(item) for item in result]
    return result


async def qix_client(ws_url: str, session_cookie: str) -> dict:
    """Open a QIX websocket, call GetHyperCubeData, return summary."""

    # websockets 16.x uses 'additional_headers'
    connect_kwargs = {
        "additional_headers": {"Cookie": session_cookie},
        "open_timeout": 30,
        "close_timeout": 10,
    }

    print(f"\n  Connecting to QIX WS...")
    try:
        ws = await websockets.connect(ws_url, **connect_kwargs)
    except Exception as e:
        raise QIXError(f"WS connect failed: {e}") from e

    msg_id = 0
    pending: dict[int, asyncio.Future] = {}

    async def send_rpc(handle: int, method: str, params: list) -> Any:
        nonlocal msg_id
        msg_id += 1
        req_id = msg_id
        payload = json.dumps({
            "delta": True,
            "handle": handle,
            "method": method,
            "params": params,
            "id": req_id,
            "jsonrpc": "2.0",
        })
        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()
        pending[req_id] = fut
        await ws.send(payload)
        return await asyncio.wait_for(fut, timeout=30)

    async def reader():
        """Background reader — routes responses to pending futures."""
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                rid = msg.get("id")
                if rid and rid in pending:
                    fut = pending.pop(rid)
                    if not fut.done():
                        if "error" in msg:
                            fut.set_exception(QIXError(f"RPC error: {msg['error']}"))
                        else:
                            fut.set_result(msg.get("result", {}))
        except Exception:
            # Resolve all pending futures on disconnect
            for fut in pending.values():
                if not fut.done():
                    fut.cancel()

    reader_task = asyncio.ensure_future(reader())

    try:
        # 1. OpenDoc
        print(f"  OpenDoc({APP_ID!r})...")
        resp = _unwrap(await send_rpc(-1, "OpenDoc", [APP_ID, "", "", "", False]))
        doc_handle = resp.get("qReturn", {}).get("qHandle", 1)
        print(f"  Doc handle: {doc_handle}")

        # 2. GetObject (straight table)
        print(f"  GetObject({TABLE_OBJ_ID!r})...")
        resp = _unwrap(await send_rpc(doc_handle, "GetObject", [TABLE_OBJ_ID]))
        obj_handle = resp.get("qReturn", {}).get("qHandle")
        if obj_handle is None:
            raise QIXError(f"GetObject no handle: {resp}")
        print(f"  Table handle: {obj_handle}")

        # 3. GetLayout (total rows + column definitions)
        print(f"  GetLayout()...")
        layout_resp = _unwrap(await send_rpc(obj_handle, "GetLayout", []))
        layout = layout_resp.get("qLayout", layout_resp)
        hc = layout.get("qHyperCube", {})
        q_size = hc.get("qSize", {})
        total_rows = q_size.get("qcy", 0)
        total_cols = q_size.get("qcx", 0)
        dimensions = [d.get("qFallbackTitle", "") for d in hc.get("qDimensionInfo", [])]
        measures = [m.get("qFallbackTitle", "") for m in hc.get("qMeasureInfo", [])]
        print(f"  Total rows: {total_rows}, cols: {total_cols}")
        print(f"  Dimensions: {dimensions}")
        print(f"  Measures:   {measures}")
        # Dump raw layout so we can see the actual structure
        print(f"  GetLayout raw (first 600 chars): {json.dumps(layout_resp)[:600]}")

        # 4. GetHyperCubeData page 1 (first PAGE_SIZE rows, all N_COLS cols)
        n_cols = total_cols or N_COLS
        data_range = [{"qTop": 0, "qLeft": 0, "qHeight": min(PAGE_SIZE, total_rows or PAGE_SIZE), "qWidth": n_cols}]
        print(f"  GetHyperCubeData page 1 ({data_range[0]['qHeight']} rows x {n_cols} cols)...")
        data_resp = _unwrap(await send_rpc(obj_handle, "GetHyperCubeData", ["/qHyperCubeDef", data_range]))
        print(f"  GetHyperCubeData raw (first 400 chars): {json.dumps(data_resp)[:400]}")

        pages = data_resp.get("qDataPages", [])
        rows: list[list[str]] = []
        for pg in pages:
            matrix = pg.get("qMatrix", []) if isinstance(pg, dict) else []
            for row in matrix:
                rows.append([cell.get("qText", "") if isinstance(cell, dict) else str(cell) for cell in row])

        print(f"  Rows in page 1: {len(rows)}")
        if rows:
            print(f"  First row: {rows[0]}")
            print(f"  Second row: {rows[1] if len(rows) > 1 else 'N/A'}")

        # Count SWFL rows (Lee / Collier) -- check each column for county name
        # We don't know which column is County yet; scan all text cells
        swfl_rows = []
        for row in rows:
            if any(cell.lower() in SWFL_COUNTIES for cell in row):
                swfl_rows.append(row)

        print(f"\n  SWFL rows (Lee/Collier) in page 1: {len(swfl_rows)}")
        if swfl_rows:
            print(f"  First SWFL row: {swfl_rows[0]}")
        else:
            # Show unique values in column positions to find County column
            print("  NOTE: No SWFL rows found in page 1. Column value samples:")
            for col_idx in range(min(n_cols, 7)):
                vals = list({r[col_idx] for r in rows[:50] if col_idx < len(r)})[:5]
                print(f"    col[{col_idx}]: {vals}")

        # Estimate total SWFL rows if we can see the county distribution
        # (only page 1 - we'll scale by fraction later if needed)

    finally:
        reader_task.cancel()
        try:
            await ws.close()
        except Exception:
            pass

    return {
        "total_rows": total_rows,
        "total_cols": total_cols,
        "dimensions": dimensions,
        "measures": measures,
        "page1_rows": len(rows),
        "page1_swfl_rows": len(swfl_rows),
        "doc_handle": doc_handle,
        "obj_handle": obj_handle,
        "sample_row": rows[0] if rows else [],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    print("=" * 70)
    print("  DBPR SIRS Phase 2: Direct QIX client")
    print("=" * 70)

    try:
        ws_url, session_cookie = await harvest_session()
    except Exception as e:
        print(f"\n  FATAL: session harvest failed: {e}")
        sys.exit(2)

    print(f"\n  WS URL (trimmed): {ws_url[:120]}...")
    print(f"  Cookie: {session_cookie[:40]}...")

    try:
        result = await qix_client(ws_url, session_cookie)
    except QIXError as e:
        print(f"\n  QIX error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n  Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print(f"\n{'='*70}")
    print("  SUMMARY")
    print(f"{'='*70}")
    print(json.dumps(result, indent=2))

    tr = result.get("total_rows", 0)
    nc = result.get("total_cols", 0)
    sr = result.get("page1_swfl_rows", 0)
    p1 = result.get("page1_rows", 0)

    print(f"\n  Verdict:")
    if tr > 0:
        pages_needed = (tr + PAGE_SIZE - 1) // PAGE_SIZE
        print(f"  * Total rows: {tr} => {pages_needed} pages of {PAGE_SIZE}")
        print(f"  * SWFL rate (page 1): {sr}/{p1} = {sr/p1*100:.1f}%" if p1 else "  * SWFL: unknown")
        if sr > 0:
            print(f"  PATH 2 CLEAR: GetHyperCubeData paging works, SWFL rows confirmed")
        else:
            print(f"  WARNING: No SWFL rows in page 1 -- check county column / filter logic")
        print(f"  READY TO BUILD: pipeline calls GetHyperCubeData in {pages_needed}x pages, filters Lee/Collier")
    else:
        print("  WARNING: total_rows=0, check GetLayout response")


if __name__ == "__main__":
    asyncio.run(main())
