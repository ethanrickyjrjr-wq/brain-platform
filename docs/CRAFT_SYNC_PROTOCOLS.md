# Brains Semantic Intake Protocol (v1.0)

This is the required 6-step protocol for adding new data, SKOS metrics, tags, or sources to the Brains project.

## 1. Audit
Audit the raw source data (e.g., PDF, CSV, API) to identify unique metrics and their meaning.

## 2. Model
Define the data model and how it fits into the existing Brains architecture.

## 3. Ledger Update
Add the new concepts to `refinery/vocab/brain-vocabulary.json` with canonical SKOS Notation IDs.

## 4. Align Types
Ensure TypeScript types in `refinery/types/` match the new vocabulary.

## 5. Constitution
Update the brain's Constitution (the Prior) to include guidance on the new metrics.

## 6. Verify
Run the pipeline in `--dry-run` mode and verify that the Stage 2.5 Normalizer maps all metrics correctly.