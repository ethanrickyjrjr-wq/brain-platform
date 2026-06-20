/**
 * Per-user Resend audience sync — Unit C2 of the multi-tenant email product.
 *
 * VENDOR-FIRST NOTE (verified live against resend@6.12.3 + resend.com docs,
 * 2026-06-12): the installed SDK migrated **Audiences → Segments**. The live
 * surface is `resend.segments.*` and `resend.contacts.*`:
 *
 *   - create a list:  `resend.segments.create({ name })`
 *                      → { data: { id, name, object:'segment' }, error }
 *   - list lists:      `resend.segments.list()`
 *                      → { data: { object:'list', data: Segment[], has_more }, error }
 *   - add a contact:   `resend.contacts.create({ email, unsubscribed,
 *                          segments: [{ id }] })`
 *                      → { data: { id, object:'contact' }, error }
 *                      (idempotent on duplicate email — returns the same id, no
 *                       error; C1's /subscribe route relies on this).
 *
 * `resend.audiences` still exists as a backward-compat ALIAS for the same
 * `Segments` class (index.d.mts: `readonly audiences: Segments`), and
 * `contacts.create({ audienceId })` is the DEPRECATED single-list shape. We use
 * the current `segments` surface everywhere. The DB column is named
 * `resend_audience_id` for historical reasons — it stores a **segment id**; the
 * two are the same opaque string, so no schema change is needed.
 *
 * The slug → list mapping: each distinct contact tag value is one audience whose
 * `audience_slug` IS the tag. A contact with tags ["newsletter","vip"] is upserted
 * into both lists. Tag-less contacts belong to no audience (design decision — see
 * `enumerateAudiences`).
 *
 * This module is pure-logic + dependency-injected so the route is a thin adapter
 * and the orchestration is unit-testable without a live Resend account.
 */

import type { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A contact row as read from `public.email_contacts` (only fields we use). */
export interface ContactRow {
  email: string;
  tags: string[] | null;
}

/** One audience to sync: the slug (= tag) and the contacts that carry that tag. */
export interface AudienceGroup {
  audience_slug: string;
  emails: string[];
}

/**
 * Group contacts by tag → one `AudienceGroup` per distinct tag value.
 *
 * DESIGN DECISION — tag-less contacts are SKIPPED (belong to no audience). We do
 * NOT invent a default "all" audience: a tag is the explicit, user-controlled
 * segmentation signal, and silently sweeping every untagged contact into an "all"
 * list would (a) send mail to people the user never segmented and (b) make the
 * Resend contact_count diverge from intent. A user who wants an "all" list tags
 * their rows "all" on upload (C1 already supports per-import tags). Untagged rows
 * still live in `email_contacts` — they are simply not synced to any Resend list.
 *
 * Pure: deterministic, no I/O. Emails within a group are de-duplicated and the
 * groups are returned sorted by slug for stable output.
 */
export function enumerateAudiences(contacts: readonly ContactRow[]): AudienceGroup[] {
  const bySlug = new Map<string, Set<string>>();

  for (const c of contacts) {
    const email = c.email?.trim().toLowerCase();
    if (!email) continue;
    const tags = Array.isArray(c.tags) ? c.tags : [];
    for (const rawTag of tags) {
      if (typeof rawTag !== "string") continue;
      const slug = rawTag.trim().toLowerCase();
      if (!slug) continue;
      let set = bySlug.get(slug);
      if (!set) {
        set = new Set<string>();
        bySlug.set(slug, set);
      }
      set.add(email);
    }
  }

  return Array.from(bySlug.entries())
    .map(([audience_slug, emails]) => ({
      audience_slug,
      emails: Array.from(emails).sort(),
    }))
    .sort((a, b) => a.audience_slug.localeCompare(b.audience_slug));
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestration
// ---------------------------------------------------------------------------

/** Existing `email_audiences` row (the slug → resend id cache for idempotency). */
export interface AudienceRecord {
  audience_slug: string;
  resend_audience_id: string;
}

/**
 * The DB seam the route supplies. Reads/writes go through the cookie/RLS client
 * so authz is `auth.uid() = user_id`; the route closes over `user.id` and never
 * exposes it here.
 */
export interface AudienceStore {
  /** All contacts for the signed-in user (RLS already scopes them). */
  readContacts(): Promise<ContactRow[]>;
  /** Existing slug → resend_audience_id map, for find-or-create reuse. */
  readAudiences(): Promise<AudienceRecord[]>;
  /** Upsert one audience row (UNIQUE(user_id, audience_slug)). */
  upsertAudience(row: {
    audience_slug: string;
    resend_audience_id: string;
    contact_count: number;
  }): Promise<void>;
}

/** Per-audience sync outcome, returned to the route for the response body. */
export interface AudienceSyncResult {
  audience_slug: string;
  resend_audience_id: string;
  contact_count: number;
  created: boolean; // true if the Resend segment was created this run
  contacts_synced: number; // contacts successfully upserted into the segment
  errors: string[];
}

export interface SyncSummary {
  audiences: AudienceSyncResult[];
  total_audiences: number;
  total_contacts_synced: number;
  skipped_untagged: number; // contacts with no tags (not synced anywhere)
}

/**
 * The Resend segment NAME for a tenant's audience. CRITICAL multi-tenant isolation:
 * Resend segments live on ONE shared account, so a bare-slug name (e.g. "newsletter")
 * would be SHARED across tenants — tenant B's sync would find + reuse tenant A's
 * "newsletter" segment and either's broadcast would hit the other's recipients. We
 * namespace the segment NAME by user id so the list-scan can only ever match THIS
 * tenant's segment. The operator-facing `audience_slug` (the DB column) stays the
 * bare slug — only the opaque Resend name carries the namespace.
 *
 * Migration for any legacy bare-named segments: scripts/email/migrate-segment-names.mts
 * (resend@6.12.3 has no segment rename, so it re-creates → re-syncs → repoints →
 * removes the old one last). Cached ids resolve by id regardless of name, so existing
 * subscribers are never stranded by this change.
 */
export function segmentName(userId: string, slug: string): string {
  return `${userId}:${slug}`;
}

/**
 * Find-or-create a Resend **segment** by its (already namespaced) `name`, reusing a
 * cached id when present.
 *
 * Order of resolution (idempotent — never creates a duplicate on re-sync):
 *   1. Reuse `existingId` from `email_audiences.resend_audience_id` if set, and
 *      confirm it still resolves via `segments.get(id)` (a deleted segment falls
 *      through to create). This path is name-independent, so existing rows keep
 *      their existing segment even as naming changes.
 *   2. Else scan `segments.list()` for a segment whose name === `name` and reuse it.
 *      Because `name` is tenant-namespaced (see `segmentName`), this can only match
 *      THIS tenant's segment — never another tenant's.
 *   3. Else `segments.create({ name })`.
 *
 * Returns the segment id plus whether it was created this run. Throws on a hard
 * Resend error so the caller can isolate the failure per-audience.
 */
export async function findOrCreateSegment(
  resend: Resend,
  name: string,
  existingId: string | undefined,
): Promise<{ id: string; created: boolean }> {
  // 1) Reuse a cached id, verifying it still exists.
  if (existingId) {
    const got = await resend.segments.get(existingId);
    if (!got.error && got.data?.id) {
      return { id: got.data.id, created: false };
    }
    // Cached id is stale (deleted in Resend) — fall through to re-create.
  }

  // 2) Reuse an existing segment with the SAME (namespaced) name (covers a missing
  //    DB row when the Resend segment already exists — e.g. a partial prior run).
  const listed = await resend.segments.list();
  if (listed.error) {
    throw new Error(`segments.list failed for "${name}": ${listed.error.message}`);
  }
  const match = listed.data?.data.find((s) => s.name === name);
  if (match) {
    return { id: match.id, created: false };
  }

  // 3) Create it.
  const created = await resend.segments.create({ name });
  if (created.error || !created.data?.id) {
    throw new Error(
      `segments.create failed for "${name}": ${created.error?.message ?? "no id returned"}`,
    );
  }
  return { id: created.data.id, created: true };
}

/**
 * Upsert one contact into a Resend segment. `contacts.create` is idempotent on a
 * duplicate email (returns the same contact id, no error — verified live, and the
 * C1 /subscribe route already depends on it), so re-syncing never duplicates a
 * contact. Passing `segments: [{ id }]` adds the contact to the segment on the
 * same call; for an already-existing contact it ensures membership.
 *
 * Returns true on success. A per-contact error is reported, not thrown, so one
 * bad address never aborts the whole audience.
 */
async function upsertContactIntoSegment(
  resend: Resend,
  email: string,
  segmentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await resend.contacts.create({
    email,
    unsubscribed: false,
    segments: [{ id: segmentId }],
  });
  if (res.error) {
    return { ok: false, error: `contacts.create("${email}"): ${res.error.message}` };
  }
  return { ok: true };
}

/**
 * Sync every tag-defined audience for the signed-in user.
 *
 * For each distinct tag (= audience_slug):
 *   - find-or-create the Resend segment (reusing the stored id — idempotent),
 *   - upsert each tagged contact into it,
 *   - upsert `email_audiences(audience_slug, resend_audience_id, contact_count)`
 *     with the LIVE tagged-contact count.
 *
 * Re-running is safe: no duplicate segments (find-or-create) and no duplicate
 * contacts (Resend create is idempotent on email). Errors are isolated per
 * audience and per contact and surfaced in the result, never thrown past the
 * audience boundary, so one failing tag can't sink the rest of the sync.
 */
export async function syncUserAudiences(
  resend: Resend,
  store: AudienceStore,
  userId: string,
): Promise<SyncSummary> {
  const contacts = await store.readContacts();
  const groups = enumerateAudiences(contacts);

  // How many contacts carry no tag at all (skipped by design).
  const skippedUntagged = contacts.filter(
    (c) =>
      !Array.isArray(c.tags) ||
      c.tags.filter((t) => typeof t === "string" && t.trim()).length === 0,
  ).length;

  const existing = await store.readAudiences();
  const idBySlug = new Map(existing.map((a) => [a.audience_slug, a.resend_audience_id]));

  const results: AudienceSyncResult[] = [];

  for (const group of groups) {
    const errors: string[] = [];
    let segmentId: string;
    let created = false;

    try {
      // The DB cache keys by the bare slug; the Resend segment NAME is namespaced
      // per tenant so the list-scan can't reuse another tenant's segment.
      const seg = await findOrCreateSegment(
        resend,
        segmentName(userId, group.audience_slug),
        idBySlug.get(group.audience_slug),
      );
      segmentId = seg.id;
      created = seg.created;
    } catch (e) {
      // Couldn't resolve the segment — record the failure and move on.
      results.push({
        audience_slug: group.audience_slug,
        resend_audience_id: idBySlug.get(group.audience_slug) ?? "",
        contact_count: group.emails.length,
        created: false,
        contacts_synced: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
      continue;
    }

    let synced = 0;
    for (const email of group.emails) {
      const r = await upsertContactIntoSegment(resend, email, segmentId);
      if (r.ok) synced++;
      else errors.push(r.error);
    }

    // contact_count reflects the live tagged-contact count for this audience
    // (the intent), independent of how many individual upserts errored.
    const contactCount = group.emails.length;
    try {
      await store.upsertAudience({
        audience_slug: group.audience_slug,
        resend_audience_id: segmentId,
        contact_count: contactCount,
      });
    } catch (e) {
      errors.push(
        `upsertAudience("${group.audience_slug}"): ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    results.push({
      audience_slug: group.audience_slug,
      resend_audience_id: segmentId,
      contact_count: contactCount,
      created,
      contacts_synced: synced,
      errors,
    });
  }

  return {
    audiences: results,
    total_audiences: results.length,
    total_contacts_synced: results.reduce((acc, r) => acc + r.contacts_synced, 0),
    skipped_untagged: skippedUntagged,
  };
}

/**
 * Adapt a Supabase client to the `AudienceStore` seam, scoped to one user.
 *
 * Reads are filtered by `user_id` EXPLICITLY — not left to RLS — so this is safe
 * with BOTH the cookie/RLS client (redundant filter) and the service-role client
 * (RLS bypassed, so the filter is the only thing preventing a cross-tenant read).
 * The phone-import path relies on the service-role variant; the /sync route uses
 * the cookie client.
 */
export function makeSupabaseAudienceStore(
  supabase: SupabaseClient,
  userId: string,
): AudienceStore {
  return {
    async readContacts(): Promise<ContactRow[]> {
      const { data, error } = await supabase
        .from("email_contacts")
        .select("email, tags")
        .eq("user_id", userId);
      if (error) throw new Error(`read email_contacts: ${error.message}`);
      return (data ?? []) as ContactRow[];
    },

    async readAudiences(): Promise<AudienceRecord[]> {
      const { data, error } = await supabase
        .from("email_audiences")
        .select("audience_slug, resend_audience_id")
        .eq("user_id", userId);
      if (error) throw new Error(`read email_audiences: ${error.message}`);
      return (data ?? []).filter(
        (r): r is AudienceRecord =>
          typeof r.audience_slug === "string" && typeof r.resend_audience_id === "string",
      );
    },

    async upsertAudience(row): Promise<void> {
      const { error } = await supabase.from("email_audiences").upsert(
        {
          user_id: userId,
          audience_slug: row.audience_slug,
          resend_audience_id: row.resend_audience_id,
          contact_count: row.contact_count,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,audience_slug" },
      );
      if (error) throw new Error(error.message);
    },
  };
}
