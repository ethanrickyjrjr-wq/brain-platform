/**
 * Pure Google People API → ContactRow mapper.
 *
 * Network-free so it unit-tests in isolation; the OAuth dance and the actual
 * `people.connections.list` fetch live in `google-oauth.ts`. A person may carry
 * several email addresses — we emit one row per address so the work-email filter
 * can keep a work address and drop a personal one independently, and people with
 * no email are skipped entirely.
 */
import type { ContactRow } from "./parse-contacts-csv";

/** The slice of a People `person` resource we consume (`personFields=names,emailAddresses`). */
export interface GooglePerson {
  names?: { displayName?: string | null }[];
  emailAddresses?: { value?: string | null }[];
}

/**
 * Flatten People connections into contact rows, applying `tags` (e.g.
 * `["google"]` for provenance) to every row. Email normalization/validation is
 * left to `upsertContacts` so this stays a pure structural transform.
 */
export function peopleConnectionsToContactRows(
  connections: GooglePerson[],
  tags: string[] = [],
): ContactRow[] {
  const rows: ContactRow[] = [];
  for (const person of connections ?? []) {
    const name = person.names?.find((n) => n.displayName)?.displayName ?? null;
    for (const e of person.emailAddresses ?? []) {
      const email = (e?.value ?? "").trim();
      if (!email) continue;
      rows.push({ email, name: name ?? null, tags: [...tags] });
    }
  }
  return rows;
}
