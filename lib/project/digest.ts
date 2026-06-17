import { inferScopeFromItems, type InferredScope } from "./derive-name";
import { identityKeyForItem } from "./identity-key";
import { tokenDayKey, tokenVersion } from "./as-of";
import type { ProjectItem } from "./items";

/**
 * The project digest — a small, deterministic "what's in here" summary of ONE project,
 * derived fresh each open from already-loaded data (no new tables; Piece 2 decision 6).
 * It is the AI's context for a project: the prompt engine ranks it into the 3+1 prompts,
 * the cross-project index matches on its `identityKeys`, and the answer-grounding path
 * names the project from its `scope`.
 *
 * The TYPE lives here from Step 1 because the context bus (`ai-context-store.ts`) carries
 * it; `buildProjectDigest` (Step 3) is implemented below the type. `rev` is a cheap content
 * hash so the store/hook can no-op an unchanged re-seed and the prompt engine can memoize.
 */
export interface ProjectDigest {
  projectId: string;
  title: string;
  /** Content hash over items + freshness — cache key for the store + prompt memo. */
  rev: string;
  /** Grounded scope; `address` reserved for the future address grain (unused in v1). */
  scope: InferredScope & { address?: string };
  itemCount: number;
  kindCounts: Record<string, number>;
  /** Cross-project identity keys (one per item) — see `cross-project-index.ts`. */
  identityKeys: string[];
  /** Newest item freshness token carried by the project (compared on the YYYYMMDD tail). */
  freshnessToken?: string;
  /** True when the newest token is newer than `ui_state.last_freshness_token_seen`. */
  freshnessChangedSinceSeen: boolean;
  /** max(items.added_at ∪ deliverables.created_at) — "where you left off". */
  latestActivityAt?: string;
  deliverables: { id: string; template: string; createdAt: string }[];
  schedules: { cadence: string; scope?: string; lastRunAt?: string }[];
  recentSends: { sentAt: string }[];
  /** Stale-metric verdicts from reconcile; `[]` when the TTL gate is off. */
  staleMetrics: { label: string; expiredAt?: string }[];
}

/**
 * Raw inputs to `buildProjectDigest`. The builder is PURE — the (nodejs-only) reconcile
 * read that produces `staleMetrics` happens in the caller (`page.tsx`), which passes the
 * verdicts in (or `[]` when the TTL gate is off). DB column names are kept here so the
 * caller maps straight from a `select` without an intermediate shape.
 */
export interface ProjectDigestInput {
  projectId: string;
  title: string;
  items: ProjectItem[];
  deliverables?: { id: string; template: string; created_at: string }[];
  schedules?: {
    cadence: string;
    scope_kind?: string | null;
    scope_value?: string | null;
    topic?: string | null;
    last_run_at?: string | null;
  }[];
  recentSends?: { sent_at: string }[];
  /** `ui_state.last_freshness_token_seen` — undefined means never seen. */
  lastFreshnessTokenSeen?: string;
  /** Reconcile stale-metric verdicts; omit / `[]` when the TTL gate is off. */
  staleMetrics?: { label: string; expiredAt?: string }[];
}

/** The freshness token an item carries, if its kind has one. */
function freshnessOf(item: ProjectItem): string | undefined {
  switch (item.kind) {
    case "metric":
    case "table_slice":
      return item.freshness_token; // required on these kinds
    case "qa":
    case "report":
      return item.freshness_token; // optional
    default:
      return undefined;
  }
}

/** Cheap deterministic content hash (djb2) — no crypto, no Date/random. Stable across
 *  runs for the same context, so the store no-ops an unchanged re-seed and the prompt
 *  engine can memoize on it. Folds in title + resolved scope (not just items+token): a
 *  rename or a schedule-derived scope change is user-visible (served to the analyst +
 *  prompts), so it MUST bump the rev or the store's keyed-write no-op would silently
 *  drop it (the bug the adversarial review caught). Fields join on a U+001F unit separator (cannot occur in a title/slug/token) so no field boundary collides. */
function computeRev(
  title: string,
  scope: InferredScope & { address?: string },
  identityKeys: string[],
  freshnessToken: string | undefined,
): string {
  const scopeKey = `${scope.zip ?? ""}|${scope.place ?? ""}|${scope.topic ?? ""}`;
  const basis = [
    title,
    scopeKey,
    identityKeys.join("|"),
    freshnessToken ?? "",
    String(identityKeys.length),
  ].join(String.fromCharCode(31)); // U+001F unit separator
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = (((h << 5) + h) ^ basis.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Scope from items first; fall back to a schedule's scope/topic so a project whose
 *  items don't name a place still carries the scope its sends are bound to. */
function withScheduleFallback(
  scope: InferredScope,
  schedules: NonNullable<ProjectDigestInput["schedules"]>,
): InferredScope & { address?: string } {
  const out: InferredScope & { address?: string } = { ...scope };
  if (!out.zip && !out.place) {
    for (const s of schedules) {
      const v = s.scope_value?.trim();
      if (!v) continue;
      if (s.scope_kind === "zip" && !out.zip) out.zip = v;
      else if (s.scope_kind === "place" && !out.place) out.place = v;
      if (out.zip || out.place) break;
    }
  }
  if (!out.topic) {
    const t = schedules.find((s) => s.topic)?.topic;
    if (t) out.topic = t;
  }
  return out;
}

/**
 * Build the deterministic project digest from already-loaded data. Pure + cheap; called
 * server-side in `page.tsx` (and reusable by MCP `swfl_project_list`). Reuses the ONE
 * scope root (`inferScopeFromItems`), the ONE identity-key root, and the ONE freshness
 * day-key root — no parallel copies.
 */
export function buildProjectDigest(input: ProjectDigestInput): ProjectDigest {
  const { items, projectId, title } = input;
  const deliverables = input.deliverables ?? [];
  const schedules = input.schedules ?? [];
  const recentSends = input.recentSends ?? [];

  const scope = withScheduleFallback(inferScopeFromItems(items), schedules);

  const kindCounts: Record<string, number> = {};
  for (const it of items) kindCounts[it.kind] = (kindCounts[it.kind] ?? 0) + 1;

  const identityKeys = items.map(identityKeyForItem);

  // Newest token-bearing item, compared on the YYYYMMDD tail (NOT the whole token —
  // the v{n} segment sorts before the date, so a raw `>` mis-orders a version bump).
  // On a same-DAY tie, prefer the higher refinery version so selection is deterministic
  // regardless of item order (the day tail can't distinguish v9 from v10 on one date).
  let freshnessToken: string | undefined;
  let newestDay: string | undefined;
  let newestVer = -1;
  for (const it of items) {
    const tok = freshnessOf(it);
    if (!tok) continue;
    const day = tokenDayKey(tok);
    if (!day) continue;
    const ver = tokenVersion(tok) ?? -1;
    const newer =
      newestDay === undefined || day > newestDay || (day === newestDay && ver > newestVer);
    if (newer) {
      newestDay = day;
      newestVer = ver;
      freshnessToken = tok;
    }
  }
  const seenDay = tokenDayKey(input.lastFreshnessTokenSeen);
  const freshnessChangedSinceSeen =
    newestDay !== undefined && (seenDay === null || newestDay > seenDay);

  // "Where you left off" — newest of any item save / deliverable build. Lexical max is
  // chronological here because every timestamp is UTC-Z ISO (Postgres timestamptz and
  // `new Date().toISOString()` both emit a trailing `Z`); a mixed-offset string would
  // need epoch normalization, but no producer in this system emits one.
  const activityTimes = [
    ...items.map((i) => i.added_at),
    ...deliverables.map((d) => d.created_at),
  ].filter((t): t is string => !!t);
  const latestActivityAt = activityTimes.length
    ? activityTimes.reduce((a, b) => (a > b ? a : b))
    : undefined;

  return {
    projectId,
    title,
    rev: computeRev(title, scope, identityKeys, freshnessToken),
    scope,
    itemCount: items.length,
    kindCounts,
    identityKeys,
    freshnessToken,
    freshnessChangedSinceSeen,
    latestActivityAt,
    deliverables: deliverables.map((d) => ({
      id: d.id,
      template: d.template,
      createdAt: d.created_at,
    })),
    schedules: schedules.map((s) => ({
      cadence: s.cadence,
      scope: s.scope_value ?? s.topic ?? undefined,
      lastRunAt: s.last_run_at ?? undefined,
    })),
    recentSends: recentSends.map((s) => ({ sentAt: s.sent_at })),
    staleMetrics: input.staleMetrics ?? [],
  };
}
