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


def test_dedup_key_is_deterministic_and_city_topic_scoped():
    a = dedup_key("Naples", "transactions", "Amazon bought $60M of land")
    b = dedup_key("Naples", "transactions", "amazon bought   $60m of LAND")
    c = dedup_key("Cape Coral", "transactions", "Amazon bought $60M of land")
    assert a == b
    assert a != c
    assert len(a) == 64  # sha256 hexdigest


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
    extraction = {"facts": [
        {"topic": "transactions", "fact": "Amazon bought $60M of land in Naples", "source_url": "https://gulfshorebusiness.com/a"},
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
    extraction = {"facts": [
        {"topic": "transactions", "fact": "Unbacked rumor", "source_url": "https://made-up.com/x"},
    ]}
    assert rows_from_extraction(_capture(), extraction) == []


def test_rows_from_extraction_drops_invalid_topic():
    extraction = {"facts": [
        {"topic": "gossip", "fact": "x", "source_url": "https://gulfshorebusiness.com/a"},
    ]}
    assert rows_from_extraction(_capture(), extraction) == []
