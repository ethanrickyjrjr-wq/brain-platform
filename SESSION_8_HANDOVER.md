# Brains Project: Session 8 Handover (The Dynamic Brain Tree)

## 🚀 The Strategic Shift
This session moves the architecture from a static pipeline to a **Modular Intelligence Factory** (The Dynamic Brain Tree). The goal is to ingest high-value government APIs into a pristine data lake, and then use the Master Brain to dynamically spin up disposable, single-purpose "Atomic Brains" to answer queries, combining them into "Synthesis Brains" as needed.

## 🎯 Core Objectives for Opus & Sonnet

### 1. Data Ingestion (The Lake)
We have identified three critical new data sources that must be ingested into the Supabase project via `dlt` (Python). The A1/B2 rule applies: this data is strictly A1 (Internal/Pristine).

*   **Data USA API:** Specifically targeting the Tesseract cubes for `pums_migration` (county-to-county wealth/migration) and `cbp_naics` (business establishments).
*   **Federal Register API:** Monitoring the `public-inspection` endpoint for early-warning signals on infrastructure grants and AI Consortia export rules.
*   **ITA Trade Data API:** Monitoring the `trade-leads` and `consolidated-screening-list` to validate foreign capital flows into SWFL.

**Sonnet Task:** Write the `dlt` sources/resources in the `refinery/` directory to pull these endpoints into raw Supabase tables. Ensure they are tagged correctly for the Semantic Ledger.

### 2. The Search-Create-Fill Protocol (Master Brain)
The Master Brain must be refactored to act as a **Router**, not a calculator.
*   **Step 1:** Master searches the Brain Registry for an existing Synthesis or Atomic Brain that answers the user's query.
*   **Step 2:** If missing, Master looks at the tagged data in the Supabase pool.
*   **Step 3:** Master triggers the Refinery to generate a disposable "Atomic Brain" (e.g., `brain-rebar-tonnage`) from the raw data.

**Opus Task:** Design the DAG edge-typing schema to support these dynamic "Synthesis" relationships between Atomic Brains.

### 3. The Freemium B2 Sandbox
To support early monetization, we need a Stage 2.5 "Bouncer" for user data dumps.
*   Users dump their portfolio data.
*   The Bouncer validates it against our `brain-vocabulary.json` (SKOS).
*   If clean, it goes into a **B2 Sandbox Brain** which can read from the A1 Master Data, but *never* writes back to it.

## 📝 Execution Rules
*   Operate strictly within `brain-platform`. The legacy `premise-engine` is dead.
*   Maintain strict TDD (Red-Green-Refactor) for the new `dlt` pipelines.
*   Remember the Honesty Rule: Math + Narrative = Truth. No LLM in the math path.

**Next Step:** Opus, please read this handover, confirm understanding of the Dynamic Brain Tree routing logic, and break down the `dlt` pipeline tasks for Sonnet to execute.
