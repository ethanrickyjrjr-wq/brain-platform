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
