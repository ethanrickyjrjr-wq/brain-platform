"""Generate the Glass §4 'Shopping List' — public.data_targets.

Reads five gap sources over one direct-Postgres connection and upserts ranked
rows, auto-dropping resolved generator rows. Internal only (service_role); a
retrodicted-derived number is never a public claim (Glass guardrail 3).

Run:
  python -m ingest.scripts.generate_data_targets --dry-run   # compute + print, no write
  python -m ingest.scripts.generate_data_targets             # upsert + auto-drop
Creds: DESTINATION__POSTGRES__CREDENTIALS, else .dlt/secrets.toml (via check_freshness).
"""
import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Reuse the freshness probe's connection + registry + STALE/MISSING/LOW_VOLUME probe.
from ingest.scripts.check_freshness import _get_connection, load_registry, run_probe

# ── DIAL-2 ⛔ excluded-but-wanted (canonical: docs/.../flywheel-bootstrap-REVIEW-knobs.md
#    DIAL 2, mirrored by refinery/tools/flywheel-backtest.mts EXCLUDED). Listed, never
#    silently dropped — these need kept point-in-time vintages before they can be graded.
EXCLUDED_WANTED_SEEDS: list[dict[str, str]] = [
    {"subject": "zori_rent", "label": "ZORI rent — needs kept vintages",
     "reason": "Excluded from backtest: Zillow re-writes history; no retained vintages. "
               "Qualifies only if we archive ZORI vintages going forward."},
    {"subject": "census_acs", "label": "Census ACS aggregates — needs point-in-time archive",
     "reason": "Excluded: revised; no point-in-time archive held. Needs vintage retention."},
    {"subject": "bls_qcew", "label": "BLS QCEW — benchmark-revised",
     "reason": "Excluded: benchmark revisions overwrite the past. Needs vintage retention."},
    {"subject": "tdt_collections", "label": "TDT collections — fixture-only",
     "reason": "Excluded: fixture-only; self-ingest still pending. Qualifies after self-ingest lands."},
]


def _target(kind: str, subject: str, label: str, reason: str, *,
            status: str, priority: int, metric: dict[str, Any]) -> dict[str, Any]:
    return {
        "target_key": f"{kind}:{subject}",
        "kind": kind, "subject": subject, "label": label, "reason": reason,
        "status": status, "priority": priority, "metric": metric,
    }


# ── pure builders (no I/O — unit-tested) ────────────────────────────────────────
def build_stale_targets(probe_results: list[dict]) -> list[dict]:
    """STALE/MISSING/LOW_VOLUME pipelines → stale targets (threshold already cadence×tolerance)."""
    out: list[dict] = []
    for r in probe_results:
        status = r.get("status")
        vol = r.get("volume_status")
        if status not in ("STALE", "MISSING") and vol != "LOW_VOLUME":
            continue
        name = r["name"]
        if status == "MISSING":
            priority, label = 1, f"{name} — never landed (MISSING)"
            reason = (f"No row in inventory/_dlt_loads (cadence {r['cadence_days']}d, "
                      f"threshold {r['threshold_days']}d).")
        elif status == "STALE":
            priority, label = 2, f"{name} — stale {r['age_days']}d"
            reason = (f"Last load {r['age_days']}d ago > threshold {r['threshold_days']}d "
                      f"(cadence {r['cadence_days']}d).")
        else:  # LOW_VOLUME on an otherwise-fresh pipeline
            priority, label = 2, f"{name} — low volume"
            reason = f"Landed {r.get('volume_landed')} rows < floor {r.get('volume_min')}."
        out.append(_target(
            "stale", name, label, reason, status="building", priority=priority,
            metric={k: r.get(k) for k in
                    ("age_days", "threshold_days", "cadence_days", "lane",
                     "volume_landed", "volume_min", "status", "volume_status")}))
    return out


def build_skill_targets(skill_rows: list[dict], *, min_n: int = 15) -> list[dict]:
    """Slugs whose lift ≤ 0 over n ≥ min_n — the system does not beat naive carry-forward."""
    out: list[dict] = []
    for row in skill_rows:
        n = int(row["n"])
        lift = float(row["lift"])
        if n < min_n or lift > 0:
            continue
        out.append(_target(
            "low_skill", row["slug"],
            f"{row['slug']} — lift {lift:+.1%} (N={n})",
            f"Backtest lift {lift:+.1%} ≤ 0 over N={n} graded calls "
            f"(system {float(row['system_accuracy']):.1%} vs naive "
            f"{float(row['persistence_accuracy']):.1%}) — call logic needs work before weighting.",
            status="building", priority=3,
            metric={"n": n, "lift": lift,
                    "system_accuracy": float(row["system_accuracy"]),
                    "persistence_accuracy": float(row["persistence_accuracy"])}))
    return out


def build_low_n_targets(slug_counts: dict[str, int], *, floor: int = 30,
                        corpus: str = "backtest") -> list[dict]:
    """Slugs with some graded calls but fewer than `floor` — under-sampled, grow the N."""
    out: list[dict] = []
    for slug, n in slug_counts.items():
        if n <= 0 or n >= floor:
            continue
        out.append(_target(
            "low_n", slug,
            f"{slug} — only N={n} graded calls",
            f"{corpus} corpus has N={n} < {floor} graded calls — too few to trust the rate.",
            status="building", priority=4, metric={"n": n, "floor": floor, "corpus": corpus}))
    return out


def build_excluded_targets() -> list[dict]:
    """The DIAL-2 ⛔ excluded-but-wanted signals (want kept vintages)."""
    return [_target("excluded_wanted", s["subject"], s["label"], s["reason"],
                    status="want", priority=5, metric={"backtestable": False})
            for s in EXCLUDED_WANTED_SEEDS]


def build_falsifiability_targets(claim_counts: dict[str, dict[str, int]],
                                 *, slug_predictions_logged: int,
                                 min_claims: int = 8,
                                 max_ungradeable_rate: float = 0.4) -> list[dict]:
    """Brains where ungradeable ≥ max_rate of CLAIM-BEARING predictions (husks excluded).
    The system noticing it isn't making falsifiable bets (the §6 finding)."""
    out: list[dict] = []
    for brain, c in claim_counts.items():
        g = int(c.get("gradeable", 0))
        u = int(c.get("ungradeable", 0))
        total = g + u
        if total < min_claims:
            continue
        rate = u / total if total else 0.0
        if rate < max_ungradeable_rate:
            continue
        out.append(_target(
            "falsifiability_gap", brain,
            f"{brain} — {rate:.0%} of calls ungradeable (N={total})",
            f"{u}/{total} claim-bearing predictions are ungradeable (no registered numeric "
            f"driver); {slug_predictions_logged} leaf slug-predictions logged. Lift gradeable "
            f"yield (Glass §6).",
            status="new", priority=4,
            metric={"gradeable_n": g, "ungradeable_n": u, "ungradeable_rate": round(rate, 3),
                    "slug_predictions_logged": slug_predictions_logged}))
    return out


def keys_to_drop(existing_generator_keys: set[str], current_keys: set[str]) -> set[str]:
    """Generator rows no longer in the current target set → auto-drop (resolved)."""
    return existing_generator_keys - current_keys


# ── DB readers (one direct-Postgres connection) ─────────────────────────────────
def read_skill_rows(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT slug, n, system_accuracy, persistence_accuracy, lift "
                    "FROM public.backtest_skill_by_slug")
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def read_slug_counts(conn) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute("SELECT slug, count(*) FROM public.backtest_grades "
                    "WHERE grade_method='retrodicted' GROUP BY slug")
        return {r[0]: int(r[1]) for r in cur.fetchall()}


def read_live_slug_counts(conn) -> dict[str, int]:
    """Live graded-call counts per slug (grade_accuracy_by_slug); empty until outcomes land."""
    with conn.cursor() as cur:
        cur.execute("SELECT gradeable_slug, n FROM public.grade_accuracy_by_slug "
                    "WHERE gradeable_slug IS NOT NULL")
        return {r[0]: int(r[1]) for r in cur.fetchall()}


def read_claim_counts(conn) -> tuple[dict[str, dict[str, int]], int]:
    """Per-brain gradeable/ungradeable over CLAIM-BEARING predictions (pending husks
    excluded), plus the live count of leaf slug-predictions."""
    counts: dict[str, dict[str, int]] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT brain_id, grade_status, count(*) FROM public.predictions "
                    "WHERE grade_status IN ('gradeable','ungradeable') GROUP BY 1,2")
        for brain, status, n in cur.fetchall():
            counts.setdefault(brain, {})[status] = int(n)
        cur.execute("SELECT count(*) FROM public.predictions WHERE prediction_kind='slug'")
        slug_preds = int(cur.fetchone()[0])
    return counts, slug_preds


# ── writer: upsert current set, auto-drop resolved generator rows ────────────────
def upsert_targets(conn, targets: list[dict], *, dry_run: bool) -> tuple[set[str], set[str]]:
    current_keys = {t["target_key"] for t in targets}
    with conn.cursor() as cur:
        cur.execute("SELECT target_key FROM public.data_targets WHERE source='generator'")
        existing = {r[0] for r in cur.fetchall()}
        drop = keys_to_drop(existing, current_keys)
        if dry_run:
            return current_keys, drop
        for t in targets:
            cur.execute(
                "INSERT INTO public.data_targets "
                "(target_key, kind, subject, label, reason, status, priority, metric, source, updated_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'generator',now()) "
                "ON CONFLICT (target_key) DO UPDATE SET "
                "kind=EXCLUDED.kind, subject=EXCLUDED.subject, label=EXCLUDED.label, "
                "reason=EXCLUDED.reason, status=EXCLUDED.status, priority=EXCLUDED.priority, "
                "metric=EXCLUDED.metric, updated_at=now()",
                (t["target_key"], t["kind"], t["subject"], t["label"], t["reason"],
                 t["status"], t["priority"], json.dumps(t["metric"])))
        for k in drop:
            cur.execute("DELETE FROM public.data_targets WHERE target_key=%s AND source='generator'", (k,))
    conn.commit()
    return current_keys, drop


def collect_targets(conn) -> list[dict]:
    registry = load_registry(Path(__file__).parent.parent / "cadence_registry.yaml")
    probe = run_probe(conn, registry)
    claim_counts, slug_preds = read_claim_counts(conn)
    targets: list[dict] = []
    targets += build_stale_targets(probe)
    targets += build_skill_targets(read_skill_rows(conn))
    targets += build_low_n_targets(read_slug_counts(conn), corpus="backtest")
    targets += build_low_n_targets(read_live_slug_counts(conn), corpus="live")
    targets += build_excluded_targets()
    targets += build_falsifiability_targets(claim_counts, slug_predictions_logged=slug_preds)
    targets.sort(key=lambda t: (t["priority"], t["kind"], t["subject"]))
    return targets


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate The Glass §4 data_targets.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute + print the ranked targets, write nothing.")
    args = parser.parse_args(argv)

    try:
        conn = _get_connection()
    except Exception as exc:  # noqa: BLE001 — fail loud, this is not observability-only
        print(f"generate_data_targets: DB connection failed: {exc}", file=sys.stderr)
        return 1

    try:
        targets = collect_targets(conn)
        current, drop = upsert_targets(conn, targets, dry_run=args.dry_run)
    finally:
        conn.close()

    print(f"{'[DRY-RUN] ' if args.dry_run else ''}data_targets: "
          f"{len(targets)} current, {len(drop)} resolved/dropped")
    by_kind: dict[str, int] = {}
    for t in targets:
        by_kind[t["kind"]] = by_kind.get(t["kind"], 0) + 1
    for kind in ("stale", "low_skill", "low_n", "excluded_wanted", "falsifiability_gap"):
        print(f"  {kind}: {by_kind.get(kind, 0)}")
    for t in targets:
        print(f"  [P{t['priority']}] {t['kind']:<18} {t['label']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
