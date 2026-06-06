"""Backfill Lee County building permits from 2025-01-01 to 2026-03-06.

Runs the pipeline in 30-day chunks to stay under Firecrawl's 60s wait-action
cap (≤4 result pages per chunk). Idempotent: permit_id is PRIMARY KEY.

Usage:
    python ingest/scripts/backfill_lee_permits.py [--dry-run] [--start YYYY-MM-DD] [--end YYYY-MM-DD]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Minimal dotenv loader — sets env vars not already present."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


DEFAULT_START = date(2025, 1, 1)
DEFAULT_END = date(2026, 3, 6)
CHUNK_DAYS = 30
SLEEP_BETWEEN_CHUNKS = 30  # seconds — avoids hammering Firecrawl


def run_chunk(start: date, end: date, dry_run: bool) -> int:
    cmd = [
        sys.executable, "-m", "ingest.pipelines.lee_permits.pipeline",
        "--start", start.isoformat(),
        "--end", end.isoformat(),
    ]
    if dry_run:
        cmd.append("--dry-run")
    print(f"\n=== {start} to {end} ===")
    result = subprocess.run(cmd)
    return result.returncode


def main() -> int:
    _load_dotenv(Path(__file__).parent.parent / ".env")

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--start", type=date.fromisoformat, default=DEFAULT_START)
    p.add_argument("--end", type=date.fromisoformat, default=DEFAULT_END)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    current = args.start
    chunks: list[tuple[date, date]] = []
    while current < args.end:
        chunk_end = min(current + timedelta(days=CHUNK_DAYS), args.end)
        chunks.append((current, chunk_end))
        current = chunk_end

    print(f"Lee permits backfill: {len(chunks)} chunks from {args.start} to {args.end}")
    if args.dry_run:
        print("DRY RUN — no DB writes")

    errors: list[tuple[date, date]] = []
    for i, (start, end) in enumerate(chunks, 1):
        print(f"\n[{i}/{len(chunks)}]", flush=True)
        rc = run_chunk(start, end, args.dry_run)
        if rc != 0:
            print(f"  FAILED (exit {rc}) — continuing")
            errors.append((start, end))
        if i < len(chunks):
            time.sleep(SLEEP_BETWEEN_CHUNKS)

    print(f"\n{'='*50}")
    print(f"Done. {len(chunks) - len(errors)}/{len(chunks)} chunks succeeded.")
    if errors:
        print("Failed chunks (re-run manually):")
        for s, e in errors:
            print(f"  python -m ingest.pipelines.lee_permits.pipeline --start {s} --end {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
