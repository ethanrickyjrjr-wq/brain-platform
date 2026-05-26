# Lee Accela probe findings — 2026-05-26

**What this is:** one-shot discovery notes from poking the live Lee Accela portal with
Firecrawl. Captures the open questions v1 left for v2 (pagination + per-permit detail
fetch). **Not a plan, not a contract** — just what the portal does right now and the
cheapest way to talk to it.

**Status:** one probe day. Findings below are accurate as of 2026-05-26.

**Re-check by:** 2026-08-26 (or whenever v2 work resumes — whichever comes first). If
the production scraper is still passing tests on that date, this file can be archived;
if it's failing, re-run the probe before changing code.

**Not a recurring task.** The ingest itself may run weekly (v2 design call). This
research doesn't.

---

## Findings

### 1. Per-permit detail = Path A (direct URL), not JS postback

Each permit_id cell in the results grid is a direct anchor to `CapDetail.aspx`:

```html
<a
  id="ctl00_PlaceHolderMain_dgvPermitList_gdvPermitList_ctl02_hlPermitNumber"
  href="https://aca-prod.accela.com/LEECO/Cap/CapDetail.aspx?Module=Permitting&TabName=Permitting&capID1=26CAP&capID2=00000&capID3=00YLA&agencyCode=LEECO&IsToShowInspection="
>
  <strong><span id="...lblPermitNumber1">PLU2026-00480</span></strong>
</a>
```

No `__doPostBack`, no in-session modal click. v2 can collect hrefs during pagination,
exit the interact session, then parallel-scrape the `CapDetail.aspx` URLs.

The `capID1`/`capID2`/`capID3` segments are opaque — must be harvested from the list
page, can't be reconstructed from `permit_id` alone.

### 2. Volume: ~110 permits per 7-day window

Grid has `pagecount="11"` attribute. Pager reads "Showing 1-10 of 100+". 11 pages × 10
rows = ~110 permits per 7-day window. Matches the v1 docstring estimate.

### 3. Parser shape

- **`href`**: on the `<a>` element directly.
- **`permit_id` text**: inside a nested `<span id="...lblPermitNumber1">`, **not**
  the anchor's own text. The anchor text also contains the `<strong>` wrapper.
- v1's `permit_id` regex (`^[A-Z]{2,5}\d{4}-\d{3,6}...`) still matches the span text.

### 4. Stealth proxy is required → REST, not CLI

The Accela portal returns `Error.aspx` to non-stealth requests. The Firecrawl CLI
(`firecrawl scrape`) has no `--proxy stealth` flag — production calls must hit the
REST API directly with `"proxy": "stealth"` in the body.

This matches what's already in `ingest/lib/firecrawl_client.py` (the shared REST
client from PR #17). What that client is **missing** is an actions-aware call:

```python
# Needed for v2 — does not exist in firecrawl_client.py yet:
def scrape_with_actions(
    url: str,
    actions: list[dict],
    *,
    proxy: str = "stealth",
    formats: Iterable[str] = ("html",),
    wait_for_ms: int = 5000,
    timeout: int = 180_000,
) -> dict: ...
```

v1's `scraper.py` still calls the `firecrawl-py` SDK directly (`FirecrawlApp` +
`WaitAction`/`WriteAction`/`ClickAction`/`ScrapeAction`) — it predates PR #17 and
was never migrated. v2 should either add the method above to the shared client or
keep the SDK call but consolidate the rest of the new code (pagination loop, detail
fetcher) on the shared client.

### 5. Code-mode interact wants Python, not Node

The Firecrawl `interact --code` Node REPL doesn't auto-await fire-and-forget IIFEs —
top-level expressions return the Promise object before the async work completes.
Python's `aioconsole` REPL supports top-level `await` cleanly. If v2 uses
`/interact` code-mode anywhere, default `--language python`.

(/interact is only needed if pagination requires staying in-session. The probe
showed that the **first** results page can be fetched via plain `/v2/scrape` +
actions, no interact session needed. Whether pages 2-11 also work via `/v2/scrape`
or require interact is unknown — see below.)

---

## Recommended v2 shape

This isn't a plan — Sonnet has the build chain. But the shape the probe points at:

1. **Get page 1** with `/v2/scrape` + actions array (write dates → click search →
   wait → scrape). Parse `pagecount` from the grid attribute. Collect `(permit_id,
capDetail_url)` tuples.
2. **Get pages 2..N**: either repeat `/v2/scrape` with an extra `click pager` action,
   or open an `/interact` session and click through. The probe didn't test
   pagination — this is the next unknown.
3. **Exit pagination**, then parallel-scrape each `CapDetail.aspx` URL with
   `/v2/scrape` (`proxy: "stealth"`, `formats: ["html"]`). Extract `issued_date`,
   `declared_value_usd`, `permit_type` from the detail page.
4. **Filter `26TMP-*`** at parse time (already noted in v1 README as v2 work).

Credit math at weekly cadence: ~12 stealth scrapes for pagination + ~110 detail
scrapes ≈ 122 credits/week ≈ 530/month. Comfortable on a 100k/month budget.

---

## Open unknowns (not resolved by this probe)

- Pagination mechanism (next-page click vs. URL param). Not tested.
- Whether `CapDetail.aspx` itself requires stealth proxy or if a plain scrape works.
  Untested — assume stealth until proven otherwise.
- Whether `declared_value_usd` is exposed on the detail page DOM or behind a
  separate tab/click.
- Detail-page selectors for `issued_date`. v1 stamps `end_date` as a documented
  approximation; v2 needs the real field.

---

## Artifacts

The raw probe scripts and the saved Accela results HTML are not retained — the
relevant fragments are captured in the findings above. If you need to re-probe,
the working `/v2/scrape` body shape was:

```python
body = {
    "url": "https://aca-prod.accela.com/LEECO/Cap/CapHome.aspx?module=Permitting&TabName=Permitting",
    "formats": ["html"],
    "proxy": "stealth",
    "waitFor": 5000,
    "timeout": 180000,
    "actions": [
        {"type": "wait", "selector": 'input[id$="txtGSStartDate"]'},
        {"type": "write", "text": "MM/DD/YYYY", "selector": 'input[id$="txtGSStartDate"]'},
        {"type": "write", "text": "MM/DD/YYYY", "selector": 'input[id$="txtGSEndDate"]'},
        {"type": "wait", "milliseconds": 1000},
        {"type": "click", "selector": "#ctl00_PlaceHolderMain_btnNewSearch"},
        {"type": "wait", "milliseconds": 12000},
        {"type": "scrape"},
    ],
}
```

A 7-day window costs ~6 credits per first-page fetch.
