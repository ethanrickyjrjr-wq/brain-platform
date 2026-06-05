<p align="center">
  <img src="public/logo-name.png" alt="SWFL Data Gulf" width="480" />
</p>

<p align="center">
  <strong>Analyst-grade Southwest Florida data, delivered straight into your AI.</strong><br/>
  Live at <a href="https://www.swfldatagulf.com">swfldatagulf.com</a> · MCP endpoint at <code>/api/mcp</code>
</p>

---

## What it is

SWFL Data Gulf is a multi-brain intelligence platform for Lee and Collier counties. Dozens of live data pipelines feed into a DAG of "brains" — each brain owns one slice of reality and emits a single distilled output block. A master synthesizer reads the whole lake and produces one grounded, falsifiable direction call. Every number is cited, every source linked, confidence decays honestly with staleness.

The data is served over [Model Context Protocol (MCP)](https://modelcontextprotocol.io), so any MCP-compatible AI (Claude, Cursor, etc.) can query it directly — no copy-paste, no stale PDFs.

---

## Install the MCP server

```bash
# Claude Code
claude mcp add --transport http swfl https://www.swfldatagulf.com/api/mcp

# Claude Desktop / any MCP client
# Add to your mcp config:
# { "swfl": { "type": "http", "url": "https://www.swfldatagulf.com/api/mcp" } }
```

Then ask: _"What's the flood-adjusted investment picture for ZIP 33931?"_ and it fetches live data.

---

## What's live

| Brain                  | What it covers                                                |
| ---------------------- | ------------------------------------------------------------- |
| `master`               | Synthesizer — one grounded direction call over the whole lake |
| `macro-swfl`           | FRED rates, BLS unemployment (LAUS), labor participation      |
| `housing-swfl`         | Median sale prices, DOM, YoY deltas (LEEPA)                   |
| `env-swfl`             | FEMA flood zones, NFIP AAL, storm surge exposure              |
| `cre-swfl`             | Commercial corridor pulse — 25 verified corridors             |
| `sector-credit-swfl`   | SBA franchise outcomes, NAICS charge-off rates                |
| `labor-demand-swfl`    | BLS OEWS occupational demand + wages                          |
| `properties-lee-value` | Parcel-level Lee County values, SOH gap analysis              |
| `traffic-swfl`         | FDOT annual average daily traffic by road segment             |
| `tourism-tdt`          | Tourist Development Tax receipts                              |
| `notices-swfl`         | DBPR public business notices                                  |

---

## Architecture

```
Sources (FRED, BLS, FEMA, LEEPA, FDOT, SBA…)
    ↓  Python ingest pipelines
data_lake.*  (Supabase Postgres + Parquet on Storage)
    ↓  Refinery (Bun + TypeScript)
Brains  →  master synthesizer
    ↓  MCP / REST
Your AI
```

Three tiers:

- **Tier 1 — Reporters:** leaf brains, cited facts only, no opinions
- **Tier 2 — Synthesizer:** master, the only tier that speculates; conditional IF/THEN calls with a falsifier
- **Tier 3 — Conversation:** the user's AI reasons over master's dossier without re-fetching

---

## Tech stack

| Layer              | Tool                                 |
| ------------------ | ------------------------------------ |
| Frontend / API     | Next.js 15 (App Router) + TypeScript |
| Database           | Supabase (Postgres + Storage)        |
| Refinery / tooling | Bun + TypeScript                     |
| Ingest pipelines   | Python + dlt                         |
| Analytics          | DuckDB                               |
| Deployment         | Vercel                               |

---

## Local development

```bash
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` and fill in your Supabase credentials.

To run the refinery (rebuild brains locally):

```bash
npm run refinery -- master --force
```

Tests:

```bash
bun test
```

---

## Data coverage

Lee County + Collier County, Florida. Grain: county → corridor → ZIP. Named towns and beaches (Fort Myers Beach, Bonita Springs, Naples, Cape Coral, Estero, Marco Island, etc.) resolve to their ZIP.

---

## Contact

`support@swfldatagulf.com`
