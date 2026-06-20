/**
 * Work-email filter — "Work emails only" toggle shared by every import path.
 *
 * Brokers importing a full phone book usually want their business network, not
 * family and friends. When `workOnly` is on, contacts whose address sits on a
 * known personal/consumer domain are dropped; everything else (company and
 * professional domains) is kept. Blocklist approach: an unknown domain is
 * treated as work — we exclude what we recognise as personal, never guess a
 * domain is personal because it's unfamiliar.
 *
 * Pure module — no I/O, no env. The People API can return several emails for one
 * person; the caller emits one `ContactRow` per email, so a person with both a
 * work and a personal address keeps the work one and drops the personal one, and
 * a person with only a personal address falls out entirely when `workOnly`.
 */
import type { ContactRow } from "./parse-contacts-csv";

/**
 * Known personal / consumer-ISP email domains. Not exhaustive by design — extend
 * as real imports surface frequent personal domains (per the operator note).
 */
export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "comcast.net",
  "att.net",
  "verizon.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "earthlink.net",
  "protonmail.com",
  "proton.me",
  "gmx.com",
]);

/** The domain part of an email, lowercased; "" when there is no `@domain`. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * True when the address is NOT on a recognised personal domain. A malformed
 * address (no domain) is not classified as personal here — validation drops it
 * downstream; the filter's only job is to exclude known consumer domains.
 */
export function isWorkEmail(email: string): boolean {
  const domain = emailDomain(email);
  return domain.length > 0 && !PERSONAL_EMAIL_DOMAINS.has(domain);
}

export interface PartitionResult {
  /** Rows to keep (all rows when `workOnly` is off). */
  kept: ContactRow[];
  /** Count of rows dropped specifically because their domain is personal. */
  skippedPersonal: number;
}

/**
 * Split rows by the work-only toggle. With `workOnly` off this is a pass-through
 * (`skippedPersonal` is 0); with it on, only personal-domain rows are removed
 * and counted — invalid/garbage addresses are left for email validation to drop
 * so they aren't mislabelled "personal".
 */
export function partitionContacts(
  rows: ContactRow[],
  opts: { workOnly: boolean },
): PartitionResult {
  if (!opts.workOnly) return { kept: rows, skippedPersonal: 0 };
  const kept: ContactRow[] = [];
  let skippedPersonal = 0;
  for (const row of rows) {
    const domain = emailDomain(String(row.email ?? ""));
    if (domain.length > 0 && PERSONAL_EMAIL_DOMAINS.has(domain)) {
      skippedPersonal++;
      continue;
    }
    kept.push(row);
  }
  return { kept, skippedPersonal };
}
