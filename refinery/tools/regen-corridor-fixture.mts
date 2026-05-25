/**
 * Regenerate fixtures/corridor-rents.json from Supabase corridor_profiles.
 *
 * This is the cre-swfl-domain fixture: rent, vacancy, absorption — period. It
 * deliberately does NOT carry permit_zscore / saturation_index / lat / lng;
 * those belong to other source-of-truth files:
 *   - fixtures/corridor-permits.json   (permits-swfl sidecar)
 *   - fixtures/corridor-centroids.json (hand-authored Lee centroids)
 * The render-time join in app/embed/charts/page.tsx walks the alias table at
 * refinery/lib/corridor-aliases.mts to compose the merged view.
 *
 * What this does:
 *   1. Queries corridor_profiles (verified, non-deleted) — same predicate as
 *      refinery/sources/cre-source.mts.
 *   2. Slugifies corridor_name → row id. Duplicates are a hard error.
 *   3. Sorts by id, writes via writeJsonAtomic (deterministic stringify +
 *      tmp-file rename). Running twice in a row produces a byte-identical
 *      file.
 *
 * Run: `npm run fixtures:corridors`
 */

import path from "node:path";
import { getSupabase } from "../sources/supabase.mts";
import { writeJsonAtomic } from "../lib/write-json-atomic.mts";

interface FixtureRow {
  id: string;
  name: string;
  submarket: string;
  nnn_asking_rent_per_sqft: number | null;
  vacancy_pct: number | null;
  absorption_sqft: number | null;
}

const FIXTURE_PATH = path.join(
  process.cwd(),
  "fixtures",
  "corridor-rents.json",
);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

async function main(): Promise<void> {
  const { data, error } = await getSupabase()
    .from("corridor_profiles")
    .select(
      "corridor_name, city, asking_rent_psf, vacancy_rate_pct, absorption_sqft",
    )
    .is("deleted_at", null)
    .eq("verification_status", "verified");

  if (error) {
    throw new Error(
      `regen-corridor-fixture: corridor_profiles fetch failed — ${error.message}`,
    );
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    throw new Error(
      "regen-corridor-fixture: corridor_profiles returned 0 verified rows. " +
        "Refusing to overwrite fixture with an empty array.",
    );
  }

  const seen = new Set<string>();
  const out: FixtureRow[] = [];
  for (const row of rows) {
    const name = str(row.corridor_name);
    if (!name) continue;
    const id = slugify(name);
    if (seen.has(id)) {
      throw new Error(
        `regen-corridor-fixture: duplicate id "${id}" derived from "${name}". ` +
          `Fix corridor_profiles to disambiguate, then re-run.`,
      );
    }
    seen.add(id);
    out.push({
      id,
      name,
      submarket: str(row.city),
      nnn_asking_rent_per_sqft: num(row.asking_rent_psf),
      vacancy_pct: num(row.vacancy_rate_pct),
      absorption_sqft: num(row.absorption_sqft),
    });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));

  await writeJsonAtomic(FIXTURE_PATH, out);

  const withRent = out.filter((r) => r.nnn_asking_rent_per_sqft != null).length;
  const withAbs = out.filter((r) => r.absorption_sqft != null).length;

  console.log(
    `regen-corridor-fixture: wrote ${out.length} rows to ${FIXTURE_PATH} ` +
      `(rent: ${withRent}/${out.length}, absorption: ${withAbs}/${out.length})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
