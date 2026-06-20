/**
 * Shared contact-upsert core — the ONE place contacts land in email_contacts.
 *
 * Every import path (CSV upload, Google People, vCard) funnels through
 * `upsertContacts` so validation, de-dup, and the insert/update split live in a
 * single tested module rather than being re-implemented per route (the pattern
 * `lib/email/audience-sync.ts` already follows for sync).
 *
 * The pure pieces — `prepareContacts` (validate + normalize + de-dupe) and
 * `mergeContact` (union tags, never null an existing name) — are exported and
 * unit-tested in isolation; `upsertContacts` is the thin orchestration over an
 * RLS-scoped Supabase client (the row's `user_id` is bound here and RLS
 * WITH CHECK enforces `auth.uid() = userId`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactRow } from "./parse-contacts-csv";
import { normalizeEmail, isValidEmail } from "./validation";

/** Hard cap on rows accepted in a single import (runaway-payload guard). */
export const MAX_CONTACT_ROWS = 10_000;

export interface ContactRecord {
  user_id: string;
  email: string;
  name: string | null;
  tags: string[];
}

export interface UpsertContactsResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * PURE: validate + normalize + de-dupe a batch of rows for one user.
 *
 * Invalid emails are dropped (counted in `skipped`, with a per-row `errors`
 * note). Within the batch, a repeated address collapses to a single record —
 * tags are unioned and a later non-null name wins (so a duplicate that adds a
 * tag never erases the name carried by an earlier copy).
 */
export function prepareContacts(
  userId: string,
  rows: ContactRow[],
): { records: ContactRecord[]; skipped: number; errors: string[] } {
  const errors: string[] = [];
  let skipped = 0;

  const byEmail = new Map<string, { name: string | null; tags: string[] }>();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!isValidEmail(email)) {
      skipped++;
      errors.push(`skipped invalid email: ${row.email}`);
      continue;
    }
    const incoming = { name: row.name ?? null, tags: row.tags ?? [] };
    const prev = byEmail.get(email);
    byEmail.set(email, prev ? mergeContact(prev, incoming) : incoming);
  }

  const records: ContactRecord[] = [];
  for (const [email, v] of byEmail) {
    if (records.length >= MAX_CONTACT_ROWS) {
      skipped++;
      continue;
    }
    records.push({ user_id: userId, email, name: v.name, tags: v.tags });
  }

  return { records, skipped, errors };
}

/**
 * PURE: merge an incoming contact into a stored/earlier one.
 *
 * Tags are unioned. The name is preserved unless the incoming row supplies a
 * non-null one — fixes the [MEDIUM] data-loss bug from the 2026-06-13 email
 * audit, where a tags-only re-upload (`incoming.name === null`) destructively
 * nulled an existing name.
 */
export function mergeContact(
  existing: { name: string | null; tags: string[] },
  incoming: { name: string | null; tags: string[] },
): { name: string | null; tags: string[] } {
  return {
    name: incoming.name ?? existing.name,
    tags: Array.from(new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])),
  };
}

/**
 * Idempotent upsert into public.email_contacts. Two-pass so `inserted` and
 * `updated` are disjoint and accurate:
 *   1. insert-only upsert (ON CONFLICT DO NOTHING) → the rows that were new
 *   2. for the conflicts only, union tags + preserve name → updated
 */
export async function upsertContacts(
  supabase: SupabaseClient,
  userId: string,
  rows: ContactRow[],
): Promise<UpsertContactsResult> {
  const { records, skipped, errors } = prepareContacts(userId, rows);
  if (records.length === 0) return { inserted: 0, updated: 0, skipped, errors };

  // Pass 1 — insert new rows only. With ignoreDuplicates the returned rows are
  // exactly the freshly-inserted ones, so their emails identify what was NEW.
  const { data: insertedRows, error: insertError } = await supabase
    .from("email_contacts")
    .upsert(records, { onConflict: "user_id,email", ignoreDuplicates: true })
    .select("email");

  if (insertError) {
    errors.push(`insert error: ${insertError.message}`);
    return { inserted: 0, updated: 0, skipped, errors };
  }

  const insertedEmails = new Set((insertedRows ?? []).map((r) => r.email as string));
  const inserted = insertedEmails.size;
  const conflicts = records.filter((r) => !insertedEmails.has(r.email));

  let updated = 0;
  if (conflicts.length > 0) {
    const { data: existing, error: fetchError } = await supabase
      .from("email_contacts")
      .select("id, email, name, tags")
      .eq("user_id", userId)
      .in(
        "email",
        conflicts.map((r) => r.email),
      );

    if (fetchError) {
      errors.push(`fetch error: ${fetchError.message}`);
    } else {
      const incomingByEmail = new Map(conflicts.map((r) => [r.email, r]));
      for (const ex of existing ?? []) {
        const incoming = incomingByEmail.get(ex.email as string);
        if (!incoming) continue;
        const merged = mergeContact(
          { name: (ex.name as string | null) ?? null, tags: (ex.tags as string[]) ?? [] },
          { name: incoming.name, tags: incoming.tags },
        );
        const { error: upErr } = await supabase
          .from("email_contacts")
          .update({ name: merged.name, tags: merged.tags, updated_at: new Date().toISOString() })
          .eq("id", ex.id as number)
          .eq("user_id", userId); // belt-and-suspenders alongside RLS
        if (!upErr) updated++;
      }
    }
  }

  return { inserted, updated, skipped, errors };
}
