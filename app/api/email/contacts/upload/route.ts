/**
 * POST /api/email/contacts/upload
 *
 * INPUT CONTRACT: JSON body `{ csv: string, tags?: string[], workOnly?: boolean }`
 *   - `csv`      — raw CSV text (header row required; columns: email, name, tags)
 *   - `tags`     — optional array of tags applied to every row in this import
 *   - `workOnly` — when true, drop personal-domain emails (keep company/professional)
 *
 * Parses the CSV, optionally filters personal domains, then upserts into
 * `public.email_contacts` via the shared `upsertContacts` core (idempotent on
 * (user_id, email); tags unioned; names preserved). Same contact-handling path
 * as the Google import — no parallel insert logic.
 *
 * RESPONSE: 200 { inserted, updated, skipped, skippedPersonal, errors }
 *           400 missing / invalid body
 *           401 unauthenticated
 *
 * AUTH: cookie/RLS client only — RLS `auth.uid() = user_id` IS the authorization.
 * Never use the service-role client here.
 */

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { parseContactsCsv } from "@/lib/email/parse-contacts-csv";
import { parseVcard } from "@/lib/email/parse-vcard";
import { partitionContacts } from "@/lib/email/work-email-filter";
import { upsertContacts } from "@/lib/email/upsert-contacts";
import type { ContactRow } from "@/lib/email/parse-contacts-csv";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // --- Auth (copy pattern from app/api/projects/route.ts) ---
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // --- Parse body ---
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body: expected JSON object" }, { status: 400 });
  }

  const { csv, vcard, tags: bodyTagsRaw, workOnly: workOnlyRaw } = body as {
    csv?: unknown;
    vcard?: unknown;
    tags?: unknown;
    workOnly?: unknown;
  };

  const hasCsv = typeof csv === "string" && csv.trim().length > 0;
  const hasVcard = typeof vcard === "string" && vcard.trim().length > 0;
  if (!hasCsv && !hasVcard) {
    return NextResponse.json(
      { error: "invalid body: provide a non-empty 'csv' or 'vcard' string" },
      { status: 400 },
    );
  }

  // Normalize body-level tags
  const bodyTags: string[] = Array.isArray(bodyTagsRaw)
    ? bodyTagsRaw
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
    : [];

  const workOnly = workOnlyRaw === true;

  // --- Parse (CSV or vCard) → optional work-email filter → shared upsert ---
  let rows: ContactRow[];
  let skippedFormat: number;
  if (hasVcard) {
    const parsed = parseVcard(vcard as string);
    // vCard rows carry no tags of their own — apply the list-name tags here so a
    // vCard import lands in the same audience a CSV would.
    rows = parsed.rows.map((r) => ({
      ...r,
      tags: Array.from(new Set([...bodyTags, ...r.tags])),
    }));
    skippedFormat = parsed.skippedCards;
  } else {
    const parsed = parseContactsCsv(csv as string, bodyTags);
    rows = parsed.rows;
    skippedFormat = parsed.skippedCount;
  }

  const { kept, skippedPersonal } = partitionContacts(rows, { workOnly });
  const result = await upsertContacts(supabase, user.id, kept);

  return NextResponse.json(
    {
      inserted: result.inserted,
      updated: result.updated,
      // Format-level skips (blank/invalid CSV rows or email-less vCards) + per-row
      // invalid-email skips from the shared core.
      skipped: skippedFormat + result.skipped,
      skippedPersonal,
      errors: result.errors,
    },
    { status: 200 },
  );
}
