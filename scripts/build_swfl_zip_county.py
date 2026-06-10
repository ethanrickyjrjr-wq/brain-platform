#!/usr/bin/env python3
"""
build_swfl_zip_county.py — regenerate fixtures/swfl-zip-county.json (the §A scope
+ county-floor artifact for the Universal Location Search spine).

PROVENANCE / PRECEDENCE RULE (operator-locked 2026-06-10, see plan deviation note in
docs/superpowers/plans/2026-06-09-universal-location-search/README.md):

  1. The U.S. Census ZCTA-to-county RELATIONSHIP FILE is the SOLE authority for
     (a) in-scope-ness and (b) county / counties / primary_county. Source:
       https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt
     (2020 ZCTAs, TIGER 2024 edition; pipe-delimited; cols verified live 2026-06-10).
     County GEOIDs are byte-identical to the lake's county codes (FIPS are stable
     ANSI ids — they do not drift 2020->2024; only ZCTA boundaries are decennial).

  2. Lake values are NEVER a county authority. The lake's published-ZIP lists are
     used ONLY to cross-check that every ZIP we publish data at is covered. They do
     not widen scope.

  3. Mailing-grade lake columns (lee_building_permits.zip_code, NFIP
     reported_zipcode, collier_building_permits owner_zip/contractor_zip) are
     CANDIDATE-ONLY / low-trust: a ZIP from them is admitted only if Census
     independently places it in a 6-county. Anything else (e.g. NY 10620, Miami
     33131) is excluded — never silently widening scope (G1/G7/moat).

  4. On disagreement, Census wins; the disagreement is logged below (discrepancies)
     and surfaced in the fixture header, not buried.

primary_county tiebreak: the in-scope county with the largest AREALAND_PART overlap,
EXCEPT the documented POP_PRIMARY_OVERRIDE cases where land area misranks a populated
ZCTA (see SOURCED.md#swfl-zip-county-pop-override).

counties[] membership: primary, plus any other in-scope county whose overlap is
>= MIN_SECONDARY_RATIO of the primary's overlap (drops sub-1% GIS-sliver false
straddles). length==2 therefore means a GENUINE straddle.

in-scope test: a ZCTA is in scope iff its DOMINANT county (largest AREALAND_PART
across ALL U.S. counties, not just the 6) is one of the 6. This rejects ZCTAs that
merely clip a SWFL county with a sliver while sitting predominantly in a non-scope
county (e.g. 34269 Arcadia/DeSoto at 0.0%, 34251 Myakka/Manatee at 0.8%). The moat:
a ZIP is "SWFL" only if SWFL is where it actually is, not where its edge grazes.

Run: python scripts/build_swfl_zip_county.py
"""
from __future__ import annotations
import csv, io, json, sys, urllib.request

CENSUS_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/"
    "tab20_zcta520_county20_natl.txt"
)
VERIFIED_DATE = "2026-06-10"

SIX = {
    "12015": "Charlotte",
    "12021": "Collier",
    "12043": "Glades",
    "12051": "Hendry",
    "12071": "Lee",
    "12115": "Sarasota",
}

# A secondary county is a real straddle only if its overlap is >= this fraction of
# the primary's overlap. Drops 33471 (Hendry 0.019%) and 34135 (Collier 0.03%).
MIN_SECONDARY_RATIO = 0.01

# Land-area misranks these populated ZCTAs; corrected on USPS / CDP grounds.
# SOURCED.md#swfl-zip-county-pop-override
POP_PRIMARY_OVERRIDE = {
    # Lehigh Acres CDP is entirely Lee County; ZCTA 33936 extends east into vast
    # empty unincorporated Hendry land, so AREALAND_PART ranks Hendry first
    # (63.8M m^2) over Lee (29.8M m^2). USPS preferred city for 33936 is
    # "Lehigh Acres" (Lee). The populated grain is Lee -> primary corrected to Lee.
    "33936": "12071",
}

# Published site-grade ZIP snapshot (lake query 2026-06-10): the ZIPs we actually
# publish data at, from SITE-grade columns only — ZORI in-scope, collier_parcels
# .phy_zipcd (physical site ZIP), and the curated swfl-geo barrier table. Used as a
# fail-loud cross-check that Census covers every ZIP we publish. NOT a scope source.
PUBLISHED_SITE_GRADE = set(
    # ZORI zori_swfl in-scope (Manatee ZIPs deliberately excluded — out of 6-county)
    "33901 33903 33904 33905 33907 33908 33909 33912 33913 33914 33916 33917 33919 "
    "33928 33931 33936 33947 33948 33950 33952 33953 33954 33955 33957 33966 33967 "
    "33971 33972 33973 33974 33976 33980 33981 33982 33983 33990 33991 33993 34102 "
    "34103 34104 34105 34108 34109 34110 34112 34113 34114 34116 34117 34119 34120 "
    "34134 34135 34142 34145 34223 34224 34228 34229 34231 34232 34233 34234 34235 "
    "34236 34237 34238 34239 34240 34241 34242 34275 34285 34286 34287 34288 34291 "
    "34292 34293".split()
    # collier_parcels.phy_zipcd
    + "34102 34103 34104 34105 34108 34109 34110 34112 34113 34114 34116 34117 34119 "
    "34120 34134 34137 34138 34139 34140 34141 34142 34145".split()
    # swfl-geo barrier table
    + "33931 33957 33924 34145 33921 34134 34102 33914 33901 33990 34109 34112".split()
)

# Representative candidate-only ZIPs that FAILED the Census gate and were excluded
# (mailing-grade noise from lee_building_permits.zip_code / NFIP reported_zipcode).
EXCLUDED_EXAMPLES = [
    {"zip": "10620", "reason": "lee_building_permits.zip_code — NY contractor mailing ZIP; not a SWFL ZCTA"},
    {"zip": "15101", "reason": "lee_building_permits.zip_code — Pittsburgh PA mailing ZIP"},
    {"zip": "33131", "reason": "fema_nfip_claims_swfl.reported_zipcode — Miami (Miami-Dade); self-reported, mis-tagged to a SWFL county_code"},
]


def fetch_rows() -> list[dict]:
    data = urllib.request.urlopen(CENSUS_URL, timeout=180).read().decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(data), delimiter="|"))


def build():
    # zcta -> {county_fips: overlap_land_m2} across ALL counties (so we can test the
    # ZCTA's dominant county, not just its in-scope clip), and zcta -> total ZCTA land
    all_overlaps: dict[str, dict[str, int]] = {}
    zcta_total: dict[str, int] = {}
    for row in fetch_rows():
        z = row["GEOID_ZCTA5_20"].strip()
        c = row["GEOID_COUNTY_20"].strip()
        if not z:
            continue
        try:
            part = int(row["AREALAND_PART"] or 0)
        except ValueError:
            part = 0
        all_overlaps.setdefault(z, {})[c] = all_overlaps.get(z, {}).get(c, 0) + part
        try:
            zcta_total[z] = int(row["AREALAND_ZCTA5_20"] or 0)
        except ValueError:
            zcta_total.setdefault(z, 0)

    # in-scope iff the ZCTA's dominant (max-overlap) county across ALL counties is a 6.
    overlaps: dict[str, dict[str, int]] = {}
    rejected_fringe = []  # touches a 6-county but is dominated by a non-scope county
    for z, by_all in all_overlaps.items():
        dominant = max(by_all, key=lambda c: by_all[c])
        in_six = {c: v for c, v in by_all.items() if c in SIX}
        if not in_six:
            continue
        if dominant in SIX:
            overlaps[z] = in_six
        else:
            tot = zcta_total.get(z, 0)
            rejected_fringe.append(
                (z, SIX[max(in_six, key=lambda c: in_six[c])],
                 round(sum(in_six.values()) / tot, 4) if tot else 0.0)
            )

    entries = []
    discrepancies = []
    fringe = []  # in-scope ZCTAs whose in-scope land is a minority of the whole (diagnostic)
    for z in sorted(overlaps):
        by_county = overlaps[z]
        # primary
        land_primary = max(by_county, key=lambda c: by_county[c])
        primary = POP_PRIMARY_OVERRIDE.get(z, land_primary)
        if z in POP_PRIMARY_OVERRIDE and primary != land_primary:
            discrepancies.append(
                f"{z}: Census AREALAND_PART ranks {SIX[land_primary]} ({land_primary}) "
                f"first, corrected to {SIX[primary]} ({primary}) on USPS/CDP population "
                f"grounds (SOURCED.md#swfl-zip-county-pop-override)."
            )
        # counties[]: primary first, then material secondaries (>= 1% of primary)
        prim_overlap = by_county[primary]
        secondaries = sorted(
            (c for c in by_county if c != primary and by_county[c] >= MIN_SECONDARY_RATIO * prim_overlap),
            key=lambda c: -by_county[c],
        )
        counties = [primary] + secondaries
        entries.append(
            {
                "zip": z,
                "counties": counties,
                "primary_county": primary,
                "county_names": [SIX[c] for c in counties],
            }
        )
        tot = zcta_total.get(z, 0)
        inscope_land = sum(by_county.values())
        if tot and inscope_land / tot < 0.5:
            fringe.append((z, SIX[primary], round(inscope_land / tot, 3)))

    # Fail-loud cross-check: every published site-grade ZIP must be covered.
    covered = {e["zip"] for e in entries}
    missing = sorted(p for p in PUBLISHED_SITE_GRADE if p not in covered)
    if missing:
        raise SystemExit(
            f"CROSS-CHECK FAILED: published site-grade ZIPs absent from Census extract: "
            f"{missing}. Hand-source each (county + citation) and add a SOURCED.md entry."
        )

    fixture = {
        "crosswalk_vintage": "2020-ZCTA (U.S. Census TIGER 2024 edition)",
        "source": (
            "U.S. Census 2020 ZCTA-to-county relationship file "
            f"({CENSUS_URL}); county GEOID = state+county FIPS. Pipe-delimited; "
            "fields GEOID_ZCTA5_20, GEOID_COUNTY_20, AREALAND_PART verified live."
        ),
        "verified_date": VERIFIED_DATE,
        "note": (
            "Scope + county floor for the 6-county SWFL footprint (Charlotte 12015, "
            "Collier 12021, Glades 12043, Hendry 12051, Lee 12071, Sarasota 12115). "
            "in_scope = (zip present in this file). ZCTA approximates ZIP: USPS "
            "point/PO-box ZIPs without a ZCTA are absent by design. primary_county = "
            "largest AREALAND_PART overlap, except documented population overrides "
            "(see precedence_rule). counties.length==2 => genuine straddle (secondary "
            ">= 1% of primary overlap; sub-1% GIS slivers dropped). Census is the SOLE "
            "county authority; lake mailing-ZIP columns are candidate-only and never "
            "widen scope — see precedence_rule + excluded_examples."
        ),
        "precedence_rule": (
            "Census relationship file wins on any disagreement. lee_building_permits"
            ".zip_code + NFIP reported_zipcode + collier owner/contractor_zip are "
            "MAILING-grade: candidate-only, admitted only if Census places the ZIP in a "
            "6-county; all else excluded (G1/G7/moat). Site-grade published ZIPs (ZORI "
            "in-scope, collier_parcels.phy_zipcd, barrier table) are cross-checked for "
            "coverage, not used to widen scope."
        ),
        "discrepancies": discrepancies,
        "excluded_examples": EXCLUDED_EXAMPLES,
        "entries": entries,
    }

    # ---- diagnostics to stdout (review before trusting the JSON) ----
    strad = [e for e in entries if len(e["counties"]) > 1]
    print(f"in-scope ZCTAs: {len(entries)}")
    print(f"genuine straddlers (>=1% secondary): {len(strad)}")
    for e in strad:
        print(f"  {e['zip']}: {e['county_names']} (primary {e['primary_county']})")
    print(f"discrepancies logged: {discrepancies}")
    print(f"REJECTED fringe (touches a 6-county but dominated by non-scope): {rejected_fringe}")
    print(f"in-scope ZCTAs <50% land in-scope (kept; dominant county still in-scope): {fringe}")
    for tz in ["33924", "33903", "34142", "34134", "33931", "33921", "33936", "34269", "34251"]:
        match = next((e for e in entries if e["zip"] == tz), None)
        print(f"  check {tz}: {match['county_names'] if match else 'NOT IN SCOPE'}"
              + (f" primary={match['primary_county']}" if match else ""))
    print(f"published site-grade cross-check: all {len(PUBLISHED_SITE_GRADE)} covered OK")

    return fixture


if __name__ == "__main__":
    fx = build()
    out = "fixtures/swfl-zip-county.json"
    if "--write" in sys.argv:
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            json.dump(fx, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"\nWROTE {out} ({len(fx['entries'])} entries)")
    else:
        print("\n(dry-run; pass --write to emit the fixture)")
