"""SWFL corridor pulse — distill step (Build #2).

Corridor-grained sibling of ingest/pipelines/city_pulse/distill.py. Reads a Tier-1
capture record (one corridor), makes ONE cheap SYNCHRONOUS Anthropic call (no web
search — forced tool_use structured output) that turns the captured citations[]
into discrete, citation-backed facts. Each fact is classified into a volatility
`topic` (which sets its TTL), backed by a citation span by 1-based INDEX (cite
field), given a dedup_key, and tagged with a story_key (the slug naming the
underlying story/entity/deal so a NEW article about the SAME story can retire the
older row — supersession, which dedup_key cannot do).

Reuse boundary (Build #2 plan): the pure, grain-agnostic helpers
(normalize_fact, normalize_url, slugify_story_key, expires_at_for, TTL_DAYS,
VALID_TOPICS, dedup_key) are imported AS-IS from the daily module — single-sourcing
the volatility taxonomy and hashing. Only the grain-bound pieces (the corridor tool,
row-building keyed on `corridor`, the corridor-scoped grounding read, and the SQL
that names data_lake.city_pulse_corridors / the `corridor` column) are re-implemented
here. The daily script is NOT modified.

Distill engine is SYNCHRONOUS (one client.messages.create per corridor), mirroring
the daily pipeline — 25 corridors/week does not justify the Batch API poll loop.

Writes to data_lake.city_pulse_corridors via psycopg with
ON CONFLICT (dedup_key) DO NOTHING.
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import anthropic

from ingest.lib.tier1_inventory import _get_connection
# Pure, grain-agnostic helpers — single-sourced from the daily module. dedup_key's
# first positional arg is the grain key (named `city` there); its value semantics
# are grain-agnostic, so we call it with the corridor string.
from ingest.pipelines.city_pulse.distill import (
    MODEL,  # noqa: F401  (re-exported; single source of truth for model version)
    TTL_DAYS,  # noqa: F401  (re-exported for import-identity test parity)
    VALID_TOPICS,
    dedup_key,
    expires_at_for,
    normalize_fact,  # noqa: F401  (re-exported for parity with the daily module surface)
    normalize_url,  # noqa: F401
    slugify_story_key,
)


EXTRACT_TOOL = {
    "name": "record_corridor_facts",
    "description": "Record discrete, citation-backed current-events facts for one SWFL commercial corridor.",
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
    """Turn the model's extraction into city_pulse_corridors rows, dropping any fact
    whose cite index is out of range, whose topic is invalid, or whose resolved
    citation has no URL. Index-based lookup carries title + cited_text onto the row.

    story_key is slugified onto the row; an empty/missing slug becomes None (the
    fact is still written — it just never participates in supersession). A cited
    fact is NEVER dropped for a missing slug. Identical logic to the daily module's
    rows_from_extraction, but keyed on `corridor` instead of `city`."""
    citations = capture.get("citations", [])
    captured_at = datetime.fromisoformat(capture["run_at"].replace("Z", "+00:00"))
    rows: list[dict[str, Any]] = []
    for f in extraction.get("facts", []):
        topic = f.get("topic")
        fact = (f.get("fact") or "").strip()
        if topic not in VALID_TOPICS or not fact:
            continue
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
            "corridor": capture["corridor"],
            "topic": topic,
            "fact": fact,
            "source_url": url,
            "source_title": c.get("title"),
            "cited_text": c.get("cited_text"),
            "captured_at": captured_at,
            "expires_at": expires_at_for(topic, captured_at),
            "dedup_key": dedup_key(capture["corridor"], url),
            "story_key": slugify_story_key(f.get("story_key") or "") or None,
            "run_at": captured_at,
        })
    return rows


def live_story_keys(corridor: str) -> list[str]:
    """Active (non-retired) story_keys for one corridor — injected into the distill
    prompt so the LLM reuses an existing slug when a fact continues that story.
    Best-effort: any failure (pre-migration column missing, dry-run, no DB) yields
    [] and grounding is simply unavailable."""
    try:
        conn = _get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT DISTINCT story_key FROM data_lake.city_pulse_corridors "
                    "WHERE corridor = %(corridor)s AND superseded_by IS NULL "
                    "AND story_key IS NOT NULL AND expires_at > now()",
                    {"corridor": corridor})
                return [r[0] for r in cur.fetchall()]
        finally:
            conn.close()
    except Exception:
        return []  # pre-migration / dry-run / no-DB → grounding simply unavailable


def build_distill_prompt(corridor: str, citations: list[dict[str, Any]], known: list[str]) -> str:
    """Assemble the forced-tool distill prompt for one corridor (pure — no network).
    Factored out of distill_capture so it is string-shape testable on its own."""
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
            f"Stories already being tracked for the {corridor} corridor (reuse the "
            f"EXACT slug if a new fact continues one of these):\n{tracked}\n\n"
        )
    return (
        grounding +
        f"Here are {n} cited spans from a web search about the {corridor} corridor in "
        f"Southwest Florida (Lee or Collier County), covering recent commercial "
        f"real-estate and current-events context:\n\n"
        f"{numbered_spans}\n\n"
        "Extract every concrete, DATED current-events fact from these spans — "
        "commercial building sales/leases/land buys, construction starts, "
        "planning-board approvals or permit milestones, business openings/closings/"
        "expansions, major tenant announcements, and storm/disaster impacts. "
        "Keep numbers, dollar amounts, company names, and dates verbatim. "
        "Skip vague or undated statements. "
        "For each fact set `cite` to the [number] of the span it came from and "
        "classify `topic`. "
        "Set `story_key` for each fact — reuse an exact slug from the tracked list "
        "above when the fact continues that story, otherwise mint a new kebab slug. "
        f"IMPORTANT: Only extract facts whose primary subject — the business, project, "
        f"transaction, or event — is physically located on or immediately along the "
        f"{corridor} corridor (or its immediate commercial area). SKIP facts about a "
        f"clearly different corridor or a distant part of the region. "
        "Call record_corridor_facts."
    )


def distill_capture(capture: dict[str, Any]) -> list[dict[str, Any]]:
    """One SYNCHRONOUS forced-tool-use call: extract facts from the capture's
    citation spans, then post-process into rows. No web search here.

    The model receives a NUMBERED list of citation spans (not the raw response
    blob) and returns each fact with a cite integer referencing its backing span by
    1-based index. Before the call we read the corridor's live story_keys and inject
    them so the model reuses an EXACT existing slug when a fact continues that story
    (grounded reuse — the supersession stability lever)."""
    if not capture.get("citations"):
        return []  # nothing citable -> nothing to distill
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    corridor = capture["corridor"]
    known = live_story_keys(corridor)
    prompt = build_distill_prompt(corridor, capture["citations"], known)
    msg = client.messages.create(
        model=MODEL,
        # 8192, not 2048: a busy corridor can yield many facts; at 2048 the forced
        # tool-input JSON truncates mid-array (stop_reason=max_tokens) and parses to
        # ZERO facts. Matches the daily pipeline's verified headroom.
        max_tokens=8192,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "record_corridor_facts"},
        messages=[{"role": "user", "content": prompt}],
    )
    extraction = next(
        (b.input for b in msg.content if getattr(b, "type", None) == "tool_use"),
        {"facts": []},
    )
    return rows_from_extraction(capture, extraction)


_INSERT_COLUMNS = [
    "corridor", "topic", "fact", "source_url", "source_title",
    "cited_text", "captured_at", "expires_at", "dedup_key", "run_at",
    "story_key",
]


def _insert_sql() -> str:
    cols = ", ".join(_INSERT_COLUMNS)
    placeholders = ", ".join(f"%({c})s" for c in _INSERT_COLUMNS)
    return (
        f"INSERT INTO data_lake.city_pulse_corridors ({cols}) VALUES ({placeholders}) "
        "ON CONFLICT (dedup_key) DO NOTHING"
    )


def write_rows(rows: list[dict[str, Any]]) -> int:
    """Upsert rows; returns number of NEW rows inserted (dedup skips count as 0).
    On any error the whole batch is rolled back and the exception re-raised."""
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
    return "DELETE FROM data_lake.city_pulse_corridors WHERE expires_at < now()"


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
      SELECT DISTINCT ON (corridor, story_key)
             corridor, story_key, id AS keep_id, expires_at AS keep_expires
      FROM data_lake.city_pulse_corridors
      WHERE story_key IS NOT NULL AND expires_at > now()
      ORDER BY corridor, story_key, captured_at DESC, id DESC
    )
    UPDATE data_lake.city_pulse_corridors cp
    SET superseded_by = head.keep_id,
        expires_at    = LEAST(cp.expires_at, head.keep_expires)
    FROM head
    WHERE cp.corridor = head.corridor
      AND cp.story_key = head.story_key
      AND cp.id <> head.keep_id
      AND cp.superseded_by IS DISTINCT FROM head.keep_id
    """


def reconcile_supersession() -> int:
    """End-of-run pass (mirrors prune_expired): retire every non-head live row of
    each (corridor, story_key) to point at that story's newest live row, capping its
    expires_at to the head's. Returns rows retired.

    Corridor-scoped via the join (cp.corridor = head.corridor), so the same slug in
    two corridors never merges. Idempotent: `superseded_by IS DISTINCT FROM
    head.keep_id` skips already-pointed rows; a newer head re-collapses the chain
    flat (children point at the head, not at each other).

    FK-safe under NO ACTION: LEAST(...) caps every child's expires_at <= its head's,
    so when a head expires its children are already expired — a single
    `DELETE WHERE expires_at < now()` removes parent+children together; no dangling
    reference.

    Head-selection caveat: within ONE run all facts share captured_at (= run_at), so
    the head ties on `id DESC` = LLM array order, NOT event recency. Across runs the
    later capture wins (the realistic follow-up path). At weekly cadence the
    cross-run path is the dominant one."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(_reconcile_sql())
            n = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return n
