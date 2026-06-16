import asyncio

from ingest.lib.crawl4ai_client import Crawl4aiSession, Crawl4aiError  # noqa: F401

# Local raw-HTML page (no network). crawl4ai accepts raw:// HTML.
_FIXTURE = "raw://<html><body><div id='target'>hello</div></body></html>"


def test_session_step_returns_html_for_raw_page():
    async def run():
        async with Crawl4aiSession(headless=True) as s:
            html = await s.step(_FIXTURE, wait_for="css:#target")
            return html

    html = asyncio.run(run())
    assert "hello" in html
