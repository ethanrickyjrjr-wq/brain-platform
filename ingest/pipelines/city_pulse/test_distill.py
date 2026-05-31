from datetime import datetime, timezone

from ingest.pipelines.city_pulse.distill import (
    TTL_DAYS, dedup_key, expires_at_for, normalize_fact, VALID_TOPICS,
)


def test_ttl_classes():
    assert TTL_DAYS == {
        "breaking": 1, "transactions": 7, "development": 14,
        "business": 14, "structural": 90,
    }
    assert VALID_TOPICS == set(TTL_DAYS)


def test_normalize_fact_is_stable_under_whitespace_and_case():
    assert normalize_fact("Amazon  bought\n$60M  of LAND.") == normalize_fact("amazon bought $60m of land")


def test_dedup_key_is_city_and_url_scoped_stable_across_wording():
    # Keyed on (city, source_url): the article URL is stable run-to-run, so the
    # LLM rewording the same fact can't create a near-duplicate row. Trailing
    # slash + case are normalized.
    a = dedup_key("Naples", "https://gulfshorebusiness.com/a")
    b = dedup_key("Naples", "https://gulfshorebusiness.com/a/")     # trailing slash
    c = dedup_key("Naples", "https://gulfshorebusiness.com/b")      # different article
    d = dedup_key("Cape Coral", "https://gulfshorebusiness.com/a")  # different city
    assert a == b          # trailing-slash + case normalized to the same key
    assert a != c          # different article -> different key
    assert a != d          # city-scoped
    assert len(a) == 64    # sha256 hexdigest


def test_expires_at_adds_ttl():
    cap = datetime(2026, 5, 30, tzinfo=timezone.utc)
    exp = expires_at_for("breaking", cap)
    assert (exp - cap).days == 1
    assert expires_at_for("structural", cap).year == 2026
    assert (expires_at_for("structural", cap) - cap).days == 90


from ingest.pipelines.city_pulse.distill import rows_from_extraction


def _capture():
    return {
        "city": "Naples",
        "run_at": "2026-05-30T00:00:00Z",
        "citations": [
            {"url": "https://gulfshorebusiness.com/a", "title": "A", "cited_text": "Amazon bought $60M of land"},
        ],
    }


def test_rows_from_extraction_keeps_cited_facts_and_assigns_ttl():
    # cite: 1 → citations[0] → url/cited_text resolved from index
    extraction = {"facts": [
        {"topic": "transactions", "fact": "Amazon bought $60M of land in Naples", "cite": 1},
    ]}
    rows = rows_from_extraction(_capture(), extraction)
    assert len(rows) == 1
    r = rows[0]
    assert r["city"] == "Naples" and r["topic"] == "transactions"
    assert r["source_url"] == "https://gulfshorebusiness.com/a"
    assert r["cited_text"] == "Amazon bought $60M of land"
    assert r["expires_at"] > r["captured_at"]
    assert len(r["dedup_key"]) == 64


def test_rows_from_extraction_drops_uncited_facts():
    # cite: 99 is out of range (only 1 citation) -> dropped (the guarantee)
    extraction = {"facts": [
        {"topic": "transactions", "fact": "Unbacked rumor", "cite": 99},
    ]}
    assert rows_from_extraction(_capture(), extraction) == []


def test_rows_from_extraction_drops_invalid_topic():
    extraction = {"facts": [
        {"topic": "gossip", "fact": "x", "cite": 1},
    ]}
    assert rows_from_extraction(_capture(), extraction) == []


def test_rows_from_extraction_drops_missing_or_nonnumeric_cite():
    # cite missing -> dropped
    extraction_missing = {"facts": [
        {"topic": "transactions", "fact": "Amazon bought $60M of land in Naples"},
    ]}
    assert rows_from_extraction(_capture(), extraction_missing) == []
    # cite is a string that can't be coerced to int -> dropped
    extraction_string = {"facts": [
        {"topic": "transactions", "fact": "Amazon bought $60M of land in Naples", "cite": "web-1"},
    ]}
    assert rows_from_extraction(_capture(), extraction_string) == []
    # cite is None -> dropped
    extraction_none = {"facts": [
        {"topic": "transactions", "fact": "Amazon bought $60M of land in Naples", "cite": None},
    ]}
    assert rows_from_extraction(_capture(), extraction_none) == []


from ingest.pipelines.city_pulse.distill import _insert_sql


def test_insert_sql_uses_on_conflict_do_nothing():
    sql = _insert_sql()
    assert "INSERT INTO data_lake.city_pulse" in sql
    assert "ON CONFLICT (dedup_key) DO NOTHING" in sql
    # all 10 insertable columns present (id + superseded_by are not inserted)
    for col in ["city", "topic", "fact", "source_url", "source_title",
                "cited_text", "captured_at", "expires_at", "dedup_key", "run_at"]:
        assert col in sql


from ingest.pipelines.city_pulse.distill import _prune_sql


def test_prune_sql_deletes_only_expired():
    sql = _prune_sql()
    assert sql.startswith("DELETE FROM data_lake.city_pulse")
    assert "expires_at < now()" in sql


# ---------------------------------------------------------------------------
# story_key content-aware supersession (Build #1)
# ---------------------------------------------------------------------------

from ingest.pipelines.city_pulse.distill import (
    slugify_story_key, _INSERT_COLUMNS, _reconcile_sql,
)


def test_slugify_story_key_normalizes_only():
    # Pure normalization — no fuzzy matching. Equal inputs (mod case/punct) -> equal slug.
    assert slugify_story_key("Amazon Lehigh Distribution Center") == "amazon-lehigh-distribution-center"
    assert slugify_story_key("  Amazon  Lehigh!! ") == "amazon-lehigh"
    assert slugify_story_key("ALREADY-kebab") == "already-kebab"
    assert slugify_story_key("multi---hyphen__mix") == "multi-hyphen-mix"
    assert slugify_story_key("") == ""
    assert slugify_story_key("   ") == ""
    assert slugify_story_key("!!!") == ""


def test_rows_from_extraction_carries_slugified_story_key():
    extraction = {"facts": [
        {"topic": "transactions", "fact": "Amazon bought $60M of land in Naples",
         "cite": 1, "story_key": "Amazon Lehigh!"},
    ]}
    rows = rows_from_extraction(_capture(), extraction)
    assert len(rows) == 1
    assert rows[0]["story_key"] == "amazon-lehigh"


def test_rows_from_extraction_empty_story_key_is_none_but_fact_kept():
    # missing story_key -> None, but the cited fact is STILL written (never dropped for a slug)
    extraction_missing = {"facts": [
        {"topic": "transactions", "fact": "Amazon bought $60M of land in Naples", "cite": 1},
    ]}
    rows = rows_from_extraction(_capture(), extraction_missing)
    assert len(rows) == 1 and rows[0]["story_key"] is None
    # whitespace-only slug also -> None, fact kept
    extraction_blank = {"facts": [
        {"topic": "transactions", "fact": "Amazon bought $60M of land in Naples",
         "cite": 1, "story_key": "   "},
    ]}
    rows2 = rows_from_extraction(_capture(), extraction_blank)
    assert len(rows2) == 1 and rows2[0]["story_key"] is None


def test_insert_columns_includes_story_key():
    assert "story_key" in _INSERT_COLUMNS


def test_reconcile_sql_shape():
    sql = _reconcile_sql()
    assert "DISTINCT ON (city, story_key)" in sql        # head per (city, story_key)
    assert "cp.city = head.city" in sql                  # city-scoped join, no cross-city merge
    assert "LEAST(cp.expires_at, head.keep_expires)" in sql  # FK-safe expiry cap
    assert "IS DISTINCT FROM head.keep_id" in sql        # idempotent
    assert "superseded_by" in sql
