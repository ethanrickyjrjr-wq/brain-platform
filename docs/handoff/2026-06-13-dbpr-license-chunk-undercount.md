# Handoff — DBPR construction-license "chunk undercount" — RESOLVED (was a phantom)

**Verdict (PERMANENT, do not re-open): NEVER add `CONSTRUCTIONLICENSE_2.csv` or
`_3.csv` to `LICENSES_URLS`.** They are frozen 2019 legacy files in a different,
incompatible format — adding them is a *regression*, not a fix. The original
"3 chunks → ~⅓ undercount" alarm was a phantom. `CONSTRUCTIONLICENSE_1.csv` is the
single, complete, daily-refreshed licensee file.

The only thing left genuinely open is a **separate, lower-priority** question about the
`cilb_*` files (bottom of doc) — and even if that surfaces a gap, the fix is a `cilb`
merge, **never** the `_2`/`_3` path. Tracked by check `dbpr_license_chunk_undercount`.

Context: this came out of the faf5-retire + applicants-fix PR (2026-06-13). The
applicants fix shipped; this license question was held to no-code investigation.

---

## ⛔ Why `_2`/`_3` must NEVER be added — three independent confirmations

All probed live 2026-06-13 against
`https://www2.myfloridalicense.com/sto/file_download/extracts/`.

**1. They are frozen 7 years (HEAD last-modified):**

| File | HTTP | Bytes | last-modified | Refresh |
|------|------|-------|---------------|---------|
| `CONSTRUCTIONLICENSE_1.csv` | 200 csv | 47,991,367 | **2026-06-13** | daily (today) |
| `CONSTRUCTIONLICENSE_2.csv` | 200 csv | 14,739,733 | **2019-10-12** | **frozen ≈7 yr** |
| `CONSTRUCTIONLICENSE_3.csv` | 200 csv | 13,836,119 | **2019-10-12** | **frozen ≈7 yr** |
| `CONSTRUCTIONLICENSE_4.csv` | 301→HTML | — | — | does not exist |

**2. They are a DIFFERENT, INCOMPATIBLE format (first-rows content probe):**

| | `_1` (current) | `_2` / `_3` (2019) |
|---|---|---|
| Column count | **22** (the layout the pipeline reads) | **20** |
| County field | numeric DBPR codes (`60`, `62`, `20` … the `46`/`21` scheme the filter uses) | county **NAMES** (`Broward`, `Volusia`, `Duval`, `Osceola`) |
| Expiration dates | `08/31/2026`, `08/31/2028` (active) | **all `08/31/2020`** (expired 6 years ago) |
| Header row | none (starts at data) | yes (`Licensee, County, License Number, …`) |

So if `_2`/`_3` were added, the existing license code would:
- misread a 20-col file with a 22-col map (`COL_COUNTY=11`, `COL_LICENSE_NO=12`, `COL_EXP_DATE=17`);
- match **zero** Lee/Collier rows — `_is in COUNTY_FILTER {"46","21"}` can never match a county *name* like `Broward`;
- and, in any path where rows did land, inject **expired-2020 dead licenses**.

**3. DBPR's own page links ONLY `_1`** (firecrawl scrape 2026-06-13 of
`https://www2.myfloridalicense.com/construction-industry/public-records/`). The
"Licensee Files" section — "Active, inactive and voluntarily inactive licensees; NULL &
VOID, delinquent and involuntarily inactive records are not included" — links exactly
`CONSTRUCTIONLICENSE_1.csv` and `swimpool_exam.csv`. `_2`/`_3` are not referenced
anywhere; they are abandoned overflow from a 2019-era export that was chunked and
county-named differently.

**Completeness sanity:** `_1` alone = **267,632 rows** (dry-run 2026-06-13) → 11,248
Lee/Collier construction (board 06) + 1,195 board-08 (`lic08el.csv`) = 12,443 Lee/Collier
license rows (all statuses); the brain's 9,623 *active* subset is consistent with `_1`
being the complete current set. There is no missing third of the data.

(Same lesson as the LittleBird gap audit: verify each "gap" against the live data before
building. The fix here would have been the regression.)

## ⚠️ If you ever touch DBPR files: trust the FILE, not the published layout doc

While fixing the applicants in the same PR, DBPR's **published** "Applicants" layout doc
listed 11 fields (combined "City, State, Zip", no county) — but the real `constr_app.csv`
has **15 columns** with a `county_code`. The stale doc was the *root cause* of the
original applicant bug. Always `curl … | head -3` the actual file and read its real
columns; never code to DBPR's layout doc.

---

## The ONE genuinely open question (separate, lower priority — NOT the `_2`/`_3` path)

Do `cilb_certified.csv` (≈690 MB, refreshed daily) / `cilb_registered.csv` (≈28 MB,
daily) contain Lee/Collier construction `license_number`s **absent** from
`CONSTRUCTIONLICENSE_1.csv`? The official page files them under "Continuing Education,"
not "Licensee Files," so most likely they overlap/subset `_1` — but this hasn't been
diffed. Resolve against data, not docs:

1. Lee/Collier `license_number` set from `CONSTRUCTIONLICENSE_1.csv` (the pipeline already
   maps these via `_DBPR_COLUMNS`).
2. The equivalent key from `cilb_certified.csv` / `cilb_registered.csv` — **probe their
   real column layout first** (`curl … | head -3`; do not assume).
3. Set-diff. Subset/equal → close this check, no code change. If the `cilb` files carry
   licenses `_1` omits → that is the real (and only) fix surface: a `cilb` **merge** on
   `license_number` (idempotent; `fl_dbpr_licenses` is `write_disposition="merge"`, so
   Gate 4's replace-without-guard rule does not apply). After landing:
   `npm run refinery -- licenses-swfl --target-only`; record before/after Lee+Collier
   active count (RULE 1).

## Files

- Pipeline: `ingest/pipelines/fl_dbpr_licenses/{constants.py,resources.py,pipeline.py}`
- `LICENSES_URLS` at `constants.py:8-17` — **read, never add `_2`/`_3`**; only a verified
  `cilb` gap (above) would justify a new URL.
- Consuming brain: `refinery/packs/licenses-swfl.mts`; source: `refinery/sources/fl-dbpr-licenses-source.mts`.
