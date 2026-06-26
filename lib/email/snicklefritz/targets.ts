// lib/email/snicklefritz/targets.ts
//
// Prospect "folders" — the per-target dossier the SNICKLEFRITZ pipeline pre-stages.
// COMMITTED at fixtures/prospects/<slug>.json (NOT gitignored data/ — the folders
// are part of the system, versioned with it). PURE data layer + thin fs I/O; no
// network, no AI. Schema mirrors docs/superpowers/specs/2026-06-25-snicklefritz-email-system-design.md §4.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EmailGlobalStyle } from "../doc/types";

export interface ProspectMarket {
  zip: string;
  city: string;
  county: string;
}

/** Brand identity. `status:"curated"` = the real logo + full palette pinned by hand
 *  from cited public sources (the reliable path for these brokers). `"scraped"` =
 *  enrichBrand returned colors; `"fallback"` = scrape failed. `palette` is the exact
 *  EmailGlobalStyle the email's brand-inject writes — every value real and cited in
 *  `source` (NEVER the SWFL house teal for a named broker). `logo_url` is a self-hosted
 *  transparent PNG on swfldatagulf.com so it never breaks in an email client. */
export interface ProspectBrand {
  status: "pending" | "curated" | "scraped" | "fallback";
  /** Full email palette — primary/accent/text/backdrop/font. The one source of truth
   *  brand-inject reads for globalStyle. */
  palette?: EmailGlobalStyle;
  logo_url?: string | null;
  company_name?: string | null;
  confidence?: number;
  source?: string;
  /** Legacy single-color fields (pre-curated scrape output). Kept for back-compat. */
  primary?: string | null;
  secondary?: string | null;
}

export interface ProspectProvenance {
  field: string;
  value: string;
  source_url: string;
}

export interface ProspectFolder {
  slug: string;
  name: string;
  company: string;
  domain: string;
  role: "century21" | "independent";
  market: ProspectMarket;
  brand: ProspectBrand;
  contacts: Record<string, unknown>;
  provenance: ProspectProvenance[];
  discovered_at: string;
}

/** Repo-root-relative prospects dir (committed). The CLIs run from repo root (process.cwd()). */
export function prospectsDir(): string {
  return join(process.cwd(), "fixtures", "prospects");
}

function folderPath(slug: string): string {
  return join(prospectsDir(), `${slug}.json`);
}

/** Load + JSON-parse one folder. Throws if missing/malformed (a real defect, not a no-op). */
export function loadFolder(slug: string): ProspectFolder {
  const p = folderPath(slug);
  if (!existsSync(p)) throw new Error(`prospect folder not found: ${p}`);
  return JSON.parse(readFileSync(p, "utf8")) as ProspectFolder;
}

/** Load every committed folder under fixtures/prospects (<slug>.json), slug-sorted. */
export function loadAllFolders(): ProspectFolder[] {
  const dir = prospectsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort()
    .map((slug) => loadFolder(slug));
}

/** Write a folder back (pretty-printed, trailing newline — diff-friendly). */
export function saveFolder(folder: ProspectFolder): void {
  writeFileSync(folderPath(folder.slug), JSON.stringify(folder, null, 2) + "\n", "utf8");
}
