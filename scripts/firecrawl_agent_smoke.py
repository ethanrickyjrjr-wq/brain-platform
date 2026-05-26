"""Local smoke test for Firecrawl /v2/agent.

Two modes:
  --raw-sdk   Call firecrawl.Firecrawl(...).agent(...) directly (vendor contract).
  (default)   Call ingest/lib/firecrawl_client.py:agent() (our wrapper).

Both should return the same shape against a trivial target. Cost ~5-50 credits.

Run locally with FIRECRAWL_API_KEY in env (or .env.local sourced):
  python scripts/firecrawl_agent_smoke.py --raw-sdk
  python scripts/firecrawl_agent_smoke.py
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


PROMPT = (
    "Extract the headline/hero title of the page and a one-sentence description "
    "of what the product does. Return one row."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["title"],
                "properties": {
                    "title":       {"type": "string"},
                    "description": {"type": ["string", "null"]},
                },
            },
        }
    },
}

TARGET_URL = "https://firecrawl.dev"


def _load_dotenv() -> None:
    """Best-effort .env.local loader so the smoke runs the same as GHA + locally."""
    repo_root = Path(__file__).resolve().parent.parent
    for candidate in (repo_root / ".env.local", repo_root / ".env"):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)


def run_raw_sdk(max_credits: int) -> None:
    import firecrawl  # noqa: PLC0415

    api_key = os.environ.get("FIRECRAWL_API_KEY")
    if not api_key:
        print("FIRECRAWL_API_KEY missing — cannot run smoke.", file=sys.stderr)
        sys.exit(1)

    print(f"--raw-sdk: calling Firecrawl SDK agent({TARGET_URL}) directly...")
    fc = firecrawl.Firecrawl(api_key=api_key)
    response = fc.agent(
        [TARGET_URL],
        prompt=PROMPT,
        schema=SCHEMA,
        max_credits=max_credits,
        strict_constrain_to_urls=True,
        model="spark-1-mini",
        poll_interval=2,
        timeout=180,
    )
    print("\n--- AgentResponse (model_dump) ---")
    print(json.dumps(response.model_dump(by_alias=False, exclude_none=False), indent=2, default=str))

    print("\n--- Status checks ---")
    print(f"  status      : {response.status!r}")
    print(f"  has data    : {response.data is not None}")
    if response.data is not None:
        print(f"  data type   : {type(response.data).__name__}")
        if isinstance(response.data, dict):
            print(f"  data keys   : {list(response.data.keys())}")
            rows = response.data.get("rows")
            if isinstance(rows, list):
                print(f"  rows count  : {len(rows)}")
                if rows:
                    print(f"  first row   : {json.dumps(rows[0], indent=2, default=str)}")
    if response.error:
        print(f"  error       : {response.error!r}")
    if response.credits_used is not None:
        print(f"  credits     : {response.credits_used}")


def run_wrapper(max_credits: int) -> None:
    from ingest.lib.firecrawl_client import agent, extract_agent_rows  # noqa: PLC0415

    print(f"wrapper: calling ingest.lib.firecrawl_client.agent({TARGET_URL})...")
    response = agent(
        PROMPT,
        urls=[TARGET_URL],
        schema=SCHEMA,
        model="spark-1-mini",
        max_credits=max_credits,
        strict_constrain_to_urls=True,
    )
    print("\n--- wrapper response (dict) ---")
    print(json.dumps(response, indent=2, default=str))

    rows = extract_agent_rows(response)
    print(f"\n--- extract_agent_rows: {len(rows)} rows ---")
    for r in rows:
        print(f"  {json.dumps(r, default=str)}")
    if not rows:
        print("ZERO rows — wrapper did not extract output. Investigate.", file=sys.stderr)
        sys.exit(2)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-sdk", action="store_true", help="Call the vendor SDK directly (skip wrapper).")
    parser.add_argument("--max-credits", type=int, default=50)
    args = parser.parse_args(argv)

    _load_dotenv()
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

    if args.raw_sdk:
        run_raw_sdk(args.max_credits)
    else:
        run_wrapper(args.max_credits)
    return 0


if __name__ == "__main__":
    sys.exit(main())
