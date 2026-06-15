import crypto from "node:crypto";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import type { ProjectItem } from "@/lib/project/items";

/**
 * claim-store — the ONLY module allowed to touch `public.claim_tokens`.
 *
 * Plan B (Carry-Back Bridge): an anonymous `swfl_project_handoff` MCP call mints a
 * token here; the `/claim` flow consumes it once (atomically) after login and
 * inserts the project under the user's real auth.uid. The table is service-role
 * only (RLS default-denies every client), so all access funnels through here.
 *
 * Token transport (locked decision 3): opaque single-use token in a short-TTL row,
 * NOT a signed payload in the URL — no 2k URL cap, no replay, no base64url-HMAC
 * footgun. The token is high-entropy random (24 bytes base64url) and survives the
 * two login redirect hops (`/claim` → `/login?next=` → `/auth/callback?next=`).
 */

/** ~15-minute time-to-live, matching the locked decision. */
const TTL_MS = 15 * 60 * 1000;

export type ConsumeResult =
  | { status: "won"; items: ProjectItem[]; title: string | null }
  | { status: "consumed" }
  | { status: "expired" }
  | { status: "missing" };

export interface ClaimPreview {
  title: string | null;
  itemCount: number;
  /** Distinct item kinds carried (for the logged-out preview). */
  kinds: string[];
  /** True when the link can no longer be claimed (past TTL or already consumed). */
  expired: boolean;
  /** True when the token was already consumed (subset of expired — distinct UX copy). */
  consumed: boolean;
}

/** Mint an opaque single-use carry-back token holding `items` for ~15 minutes. */
export async function mintClaimToken(items: ProjectItem[], title?: string | null): Promise<string> {
  const token = crypto.randomBytes(24).toString("base64url"); // URL-safe; survives redirects
  const now = Date.now();
  const db = createServiceRoleClient();
  const { error } = await db.from("claim_tokens").insert({
    token,
    items,
    title: title ?? null,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + TTL_MS).toISOString(),
  });
  if (error) throw new Error(`mintClaimToken: ${error.message}`);
  return token;
}

/**
 * The UPDATE-guarded consume (NOT INSERT-ON-CONFLICT `claimOnce`). Calls the
 * atomic, server-`now()` SQL function `consume_claim_token`: a single
 * `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING ...`
 * statement that is row-locked, so exactly one concurrent caller can win. A
 * non-winner gets zero rows back; we then classify it with one non-consuming peek.
 */
export async function consumeClaimToken(token: string): Promise<ConsumeResult> {
  const db = createServiceRoleClient();
  const { data, error } = await db.rpc("consume_claim_token", { p_token: token });
  if (error) throw new Error(`consumeClaimToken: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : null;
  if (row) {
    return {
      status: "won",
      items: (Array.isArray(row.items) ? row.items : []) as ProjectItem[],
      title: (row.title as string | null) ?? null,
    };
  }

  // No row updated → classify (this peek does NOT touch consumed_at).
  const { data: peeked } = await db
    .from("claim_tokens")
    .select("consumed_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!peeked) return { status: "missing" };
  if (peeked.consumed_at) return { status: "consumed" };
  // Exists, not consumed, yet the guarded UPDATE matched nothing → it is expired.
  return { status: "expired" };
}

/**
 * Read-only, NON-consuming summary for the `/claim` preview (B-3b). Returns only a
 * summary — never the raw item bodies — and never touches `consumed_at`.
 */
export async function peekClaimToken(token: string): Promise<ClaimPreview | null> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("claim_tokens")
    .select("title, items, expires_at, consumed_at")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  const items = (Array.isArray(data.items) ? data.items : []) as ProjectItem[];
  const consumed = Boolean(data.consumed_at);
  const expired = consumed || new Date(data.expires_at as string).getTime() <= Date.now();
  return {
    title: (data.title as string | null) ?? null,
    itemCount: items.length,
    kinds: [...new Set(items.map((it) => it.kind))],
    expired,
    consumed,
  };
}

/**
 * Best-effort, winner-side observability/cleanup only. NEVER the loser's
 * navigation source — a concurrent loser may read project_id as null because it is
 * written AFTER the winner's project insert.
 */
export async function attachProjectId(token: string, id: string): Promise<void> {
  try {
    const db = createServiceRoleClient();
    await db.from("claim_tokens").update({ project_id: id }).eq("token", token);
  } catch (e) {
    console.error("attachProjectId failed", e); // observability only — never block the claim
  }
}

/**
 * Non-consuming pre-read of the raw item payload — call before consumeClaimToken to
 * validate the item schema without touching consumed_at. Returns null if the token is
 * missing, already consumed, or expired; the caller should still call consume (which
 * confirms the state authoritatively via the atomic UPDATE).
 */
export async function fetchRawClaimItems(token: string): Promise<ProjectItem[] | null> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("claim_tokens")
    .select("items, consumed_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data || data.consumed_at) return null;
  if (new Date(data.expires_at as string).getTime() <= Date.now()) return null;
  return Array.isArray(data.items) ? (data.items as ProjectItem[]) : [];
}

/**
 * Deterministic project id derived from the token. Winner AND loser compute the
 * SAME value, so a double-claim targets one PK → the insert is idempotent (PK
 * conflict = no-op) and both navigate to the same `/project/{id}`. Unguessable
 * because `token` is high-entropy. 12 hex chars — matches the projects.id shape
 * (`randomUUID().slice(0,12)`).
 */
export function deterministicProjectId(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}
