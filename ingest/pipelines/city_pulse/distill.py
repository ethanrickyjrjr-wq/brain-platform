"""SWFL city pulse — distill step.

Reads a Tier-1 capture record (one city), makes ONE cheap Anthropic call (no
web search — forced tool_use structured output) that turns the captured
citations[] into discrete, citation-backed facts. Each fact is classified into a
volatility `topic` (which sets its TTL), backed by a citation span by 1-based
INDEX (cite field), given a dedup_key, and tagged with a story_key (the slug
naming the underlying story/entity/deal so a NEW article about the SAME story can
retire the older row — supersession, which dedup_key cannot do).

Distill contract: the model is shown a NUMBERED list of citation spans
(title + cited_text + url) — not the raw response blob — and each extracted fact
references its backing span by index number (cite: 1, 2, …). Facts whose cite
index is out of range, whose topic is invalid, or whose resolved citation has no
URL are DROPPED — that is the no-unbacked-claim guarantee, enforced before the
row exists. This approach fixes the 0-facts bug (the raw 278k-char response blob
drowned the model) and cuts distill input tokens ~20x.

Writes to data_lake.city_pulse via psycopg with ON CONFLICT (dedup_key) DO NOTHING.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import anthropic

from ingest.lib.tier1_inventory import _get_connection

MODEL = "claude-sonnet-4-6"

TTL_DAYS: dict[str, int] = {
    "breaking": 1,
    "transactions": 7,
    "development": 14,
    "business": 14,
    "structural": 90,
}
VALID_TOPICS: set[str] = set(TTL_DAYS)


def normalize_fact(fact: str) -> str:
    """Lowercase + collapse whitespace + strip trailing punctuation for stable dedup."""
    return re.sub(r"\s+", " ", fact.lower()).strip().rstrip(".")


def normalize_url(url: str) -> str:
    """Lowercase + strip trailing slash/whitespace for stable URL-based dedup."""
    return url.strip().rstrip("/").lower()


def slugify_story_key(s: str) -> str:
    """Lowercase, collapse non-alphanumerics to single hyphens, strip edges. The
    LLM mints the slug; this only normalizes casing/punctuation for stable equality
    (e.g. 'Amazon Lehigh!' -> 'amazon-lehigh'). No fuzzy matching — grounded reuse
    (live_story_keys injected into the prompt) is the only stability lever, by design."""
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)


def dedup_key(city: str, source_url: str) -> str:
    """Dedup on (city, source_url). The article URL is stable run-to-run, so this
    is immune to the LLM rewording the same fact or reclassifying its topic
    between daily runs (the exact-fact-text key let near-duplicates accumulate —
    verified live: a re-run wrote 12 of 14 as "new"). One signal per source
    article per city; a second fact from the same article dedups at write time."""
    raw = f"{city}|{normalize_url(source_url)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def expires_at_for(topic: str, captured_at: datetime) -> datetime:
    return captured_at + timedelta(days=TTL_DAYS[topic])


EXTRACT_TOOL = {
    "name": "record_city_facts",
    "description": "Record discrete, citation-backed current-events facts for one SWFL city.",
    "input_schema": {
        "type": "object",
        "properties": {
            "facts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string", "enum": sorted(VALID_TOPICS),
                                  "description": "Volatility class. breaking=disaster/sudden closure/major layoff; transactions=sales/big leases/land buys; development=construction/permits/approvals; business=openings/closings/expansions/hiring; structural=ownership/long-run posture."},
                        "fact": {"type": "string", "description": "One concrete claim, numbers and dates verbatim."},
                        "cite": {"type": "integer", "description": "The number of the citation span (from the numbered list) that backs this fact."},
                        "story_key": {"type": "string",
                                  "description": "Stable lowercase-kebab slug naming the underlying story/entity/deal this fact is about (e.g. 'amazon-lehigh-distribution-center'). If this fact continues one of the already-tracked stories listed in the prompt, return that EXACT slug. Otherwise mint a new concise kebab slug from the core entity + place. Use the SAME slug for every fact in THIS response that is about the same story. Never paraphrase an existing slug."},
                    },
                    "required": ["topic", "fact", "cite", "story_key"],
                },
            }
        },
        "required": ["facts"],
    },
}


def rows_from_extraction(capture: dict[str, Any], extraction: dict[str, Any]) -> list[dict[str, Any]]:
    """Turn the model's extraction into city_pulse rows, dropping any fact whose
    cite index is out of range, whose topic is invalid, or whose resolved citation
    has no URL. Index-based lookup carries title + cited_text onto the row.

    story_key is slugified onto the row; an empty/missing slug becomes None (the
    fact is still written — it just never participates in supersession, like a
    legacy row). A cited fact is NEVER dropped for a missing slug."""
    citations = capture.get("citations", [])
    captured_at = datetime.fromisoformat(capture["run_at"].replace("Z", "+00:00"))
    rows: list[dict[str, Any]] = []
    for f in extraction.get("facts", []):
        topic = f.get("topic")
        fact = (f.get("fact") or "").strip()
        if topic not in VALID_TOPICS or not fact:
            continue
        # cite is a 1-based index into citations; coerce and range-check
        try:
            cite_idx = int(f["cite"])
        except (KeyError, TypeError, ValueError):
            continue  # missing or non-integer cite -> dropped (the guarantee)
        if not (1 <= cite_idx <= len(citations)):
            continue  # out of range -> dropped
        c = citations[cite_idx - 1]
        url = c.get("url")
        if not url:
            continue  # no URL on resolved citation -> dropped
        rows.append({
            "city": capture["city"],
            "topic": topic,
            "fact": fact,
            "source_url": url,
            "source_title": c.get("title"),
            "cited_text": c.get("cited_text"),
            "captured_at": captured_at,
            "expires_at": expires_at_for(topic, captured_at),
            "dedup_key": dedup_key(capture["city"], url),
            "story_key": slugify_story_key(f.get("story_key") or "") or None,
            "run_at": captured_at,
        })
    return rows


def live_story_keys(city: str) -> list[str]:
    """Active (non-retired) story_keys for one city — injected into the distill
    prompt so the LLM reuses an existing slug when a fact continues that story.
    Best-effort: any failure (pre-migration column missing, dry-run, no DB) yields
    [] and grounding is simply unavailable."""
    try:
        conn = _get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT DISTINCT story_key FROM data_lake.city_pulse "
                    "WHERE city = %(city)s AND superseded_by IS NULL "
                    "AND story_key IS NOT NULL AND expires_at > now()",
                    {"city": city})
                return [r[0] for r in cur.fetchall()]
        finally:
            conn.close()
    except Exception:
        return []  # pre-migration / dry-run / no-DB → grounding simply unavailable


def distill_capture(capture: dict[str, Any]) -> list[dict[str, Any]]:
    """One forced-tool-use call: extract facts from the capture's citation spans,
    then post-process into rows. No web search here.

    The model receives a NUMBERED list of citation spans (not the raw response
    blob) and returns each fact with a cite integer referencing its backing span
    by 1-based index. This avoids the 0-facts bug caused by feeding the model a
    ~278k-char encrypted_content blob and cuts input tokens ~20x.

    Before the call we read the city's live story_keys and inject them so the model
    reuses an EXACT existing slug when a fact continues that story (grounded reuse —
    the supersession stability lever)."""
    if not capture.get("citations"):
        return []  # nothing citable -> nothing to distill
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    city = capture["city"]
    citations = capture["citations"]
    known = live_story_keys(city)
    # Build a numbered list of citation spans for the prompt
    span_lines = []
    for i, c in enumerate(citations, start=1):
        title = c.get("title") or ""
        cited_text = c.get("cited_text") or ""
        url = c.get("url") or ""
        span_lines.append(f'[{i}] {title} — "{cited_text}" ({url})')
    numbered_spans = "\n".join(span_lines)
    n = len(citations)
    grounding = ""
    if known:
        tracked = "\n".join(f"- {k}" for k in sorted(known))
        grounding = (
            f"Stories already being tracked for {city} (reuse the EXACT slug if a "
            f"new fact continues one of these):\n{tracked}\n\n"
        )
    prompt = (
        grounding +
        f"Here are {n} cited spans from a web search about {city}, Florida "
        f"(Southwest Florida), covering recent current events:\n\n"
        f"{numbered_spans}\n\n"
        "Extract every concrete, DATED current-events fact from these spans — "
        "business openings/closings, transactions/sales/leases, "
        "construction/permits/approvals, layoffs/hiring, storm/disaster impacts. "
        "Keep numbers, dollar amounts, company names, and dates verbatim. "
        "Skip vague or undated statements. "
        "For each fact set `cite` to the [number] of the span it came from and "
        "classify `topic`. "
        "Set `story_key` for each fact — reuse an exact slug from the tracked list "
        "above when the fact continues that story, otherwise mint a new kebab slug. "
        f"IMPORTANT: Only extract facts whose primary subject — the business, project, "
        f"transaction, or event — is physically located in or specifically about {city} "
        f"(or its immediate area / the surrounding county seat context). SKIP any fact "
        f"whose primary location is a DIFFERENT named Southwest Florida city (e.g. when "
        f"the city is Naples, skip facts about Fort Myers, Cape Coral, Estero, Bonita "
        f"Springs, Lehigh Acres, or Fort Myers Beach). "
        "Call record_city_facts."
    )
    msg = client.messages.create(
        model=MODEL,
        # 8192, not 2048: a busy city yields 30-40 facts; at 2048 the forced
        # tool-input JSON truncates mid-array (stop_reason=max_tokens) and parses
        # to ZERO facts. Verified live — Naples returned 33 facts at 8192, 0 at
        # 2048. Headroom is ~3x the observed worst case.
        max_tokens=8192,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "record_city_facts"},
        messages=[{"role": "user", "content": prompt}],
    )
    extraction = next(
        (b.input for b in msg.content if getattr(b, "type", None) == "tool_use"),
        {"facts": []},
    )
    return rows_from_extraction(capture, extraction)


_INSERT_COLUMNS = [
    "city", "topic", "fact", "source_url", "source_title",
    "cited_text", "captured_at", "expires_at", "dedup_key", "run_at",
    "story_key",
]


def _insert_sql() -> str:
    cols = ", ".join(_INSERT_COLUMNS)
    placeholders = ", ".join(f"%({c})s" for c in _INSERT_COLUMNS)
    return (
        f"INSERT INTO data_lake.city_pulse ({cols}) VALUES ({placeholders}) "
        "ON CONFLICT (dedup_key) DO NOTHING"
    )


def write_rows(rows: list[dict[str, Any]]) -> int:
    """Upsert rows; returns number of NEW rows inserted (dedup skips count as 0).
    On any error the whole batch is rolled back and the exception re-raised — the
    caller treats the city as failed rather than trusting a partial count."""
    if not rows:
        return 0
    conn = _get_connection()
    inserted = 0
    try:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(_insert_sql(), row)
                inserted += cur.rowcount  # 0 on conflict, 1 on insert
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return inserted


def _prune_sql() -> str:
    # Tier-1 cold storage retains the permanent raw audit, so deleting expired
    # Tier-2 rows loses nothing recoverable. The reader already ignores them.
    return "DELETE FROM data_lake.city_pulse WHERE expires_at < now()"


def prune_expired() -> int:
    """Delete expired Tier-2 rows. Returns the number deleted."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(_prune_sql())
            deleted = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return deleted


def _reconcile_sql() -> str:
    return """
    WITH head AS (
      SELECT DISTINCT ON (city, story_key)
             city, story_key, id AS keep_id, expires_at AS keep_expires
      FROM data_lake.city_pulse
      WHERE story_key IS NOT NULL AND expires_at > now()
      ORDER BY city, story_key, captured_at DESC, id DESC
    )
    UPDATE data_lake.city_pulse cp
    SET superseded_by = head.keep_id,
        expires_at    = LEAST(cp.expires_at, head.keep_expires)
    FROM head
    WHERE cp.city = head.city
      AND cp.story_key = head.story_key
      AND cp.id <> head.keep_id
      AND cp.superseded_by IS DISTINCT FROM head.keep_id
    """


def reconcile_supersession() -> int:
    """End-of-run pass (mirrors prune_expired): retire every non-head live row of
    each (city, story_key) to point at that story's newest live row, capping its
    expires_at to the head's. Returns rows retired.

    City-scoped via the join (cp.city = head.city), so the same slug in two cities
    never merges. Idempotent: `superseded_by IS DISTINCT FROM head.keep_id` skips
    already-pointed rows; a newer head re-collapses the chain flat (children point
    at the head, not at each other).

    FK-safe under NO ACTION (verified: city_pulse_superseded_by_fkey confdeltype='a'):
    LEAST(...) caps every child's expires_at <= its head's, so when a head expires
    its children are already expired — a single `DELETE WHERE expires_at < now()`
    removes parent+children together; no dangling reference.

    Head-selection caveat: within ONE run all facts share captured_at (= run_at), so
    the head ties on `id DESC` = LLM array order, NOT event recency. Across runs the
    later capture wins (the realistic follow-up path). Supersession only fires while
    the older row is still inside its topic TTL (transactions 7d … structural 90d);
    past that it's pruned regardless."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(_reconcile_sql())
            n = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return n
