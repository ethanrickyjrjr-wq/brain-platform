# Paywall gate points across the moat — where they go, how to flip them on

**Status (2026-06-10):** OPEN FRIENDS-BETA. No paywall enforced anywhere. Goal right now: people we know using **everything**, sending feedback, while we clean up. This doc is the map so any gate is a small, well-understood change **when** we want revenue — not now.

**Operator direction (2026-06-10):** "We want people to use and see the benefits of everything… get people I know using it and sending feedback. Just make sure we can easily set up paywalls at different spots of our moat at any time."

---

## The decision on the MCP bearer (resolves the LB-R6a question)

We are running the MCP **open** for the beta:

- `swfl_fetch` (read the lake) — **public, unchanged.** The advertised `claude mcp add … swfl` keeps working.
- `swfl_project_*` (S9 co-build writes) — gated by the **per-project capability key** (256-bit, header-only, revocable). That key alone makes writes safe; an anonymous caller can't write without a valid `proj_…` key.
- `MCP_BEARER_TOKEN` — **stays unset** for the beta.

**This consciously defers the locked gate `[LB-R6a]`** ("bearer enforced before write tools ship"). The deferral is a deliberate operator call for the beta, not an oversight, and it is safe because writes are key-gated independent of the bearer. To turn the MCP into a paid product later, set `MCP_BEARER_TOKEN` in prod — but note it gates the **whole** surface (reads + writes); see "Gate 3" + the breaking-change caveat below.

**Before flipping any global MCP gate:** confirm there are no active free consumers via **Vercel function logs** (POST `/api/mcp` volume). There is NO server-side consumer trail to query — MCP reads aren't metered and the rate limiter is in-memory. That check lives in the Vercel dashboard, not here.

---

## Ground truth: what metering we actually have (read before trusting any paywall query)

`public.usage_events` columns: `id, client_id, iso_week, report_id, reach, ip_hash, created_at, action`. **There is no `user_id` column and no `event` column.** Actions are written to `action`.

Every action currently metered, and **who it is attributed to**:

| action | written by | `client_id` attribution |
|---|---|---|
| `ask` | highlighter / `/api/converse` | anon `sdg_cid` cookie |
| `build` (web) | `/api/projects/[id]/build` | anon `sdg_cid` cookie |
| `build` (MCP) | `swfl_project_build` (S9) | **`mcp:<owner_uid>`** ✅ |
| `item_add` (MCP) | `swfl_project_add` (S9) | **`mcp:<owner_uid>`** ✅ |
| `deliver_email`, `deliver_share` | `/p/[id]` DeliveryButtons → `/api/meter` | anon `sdg_cid` cookie |
| `upload` | UploadDrop → `/api/meter` | anon `sdg_cid` cookie |
| `chart_save`, `export_print`, `project_create` | various → `/api/meter` | anon `sdg_cid` cookie |

Dormant primitives already in `lib/highlighter/meter.ts` (defined, **unused** today): `actionCount(clientId, action)` (per-ISO-week count), `weeklyCount(clientId)`, `capEnabled()` (reads `HIGHLIGHTER_FREE_WEEKLY_CAP`). The amber **soft-wall** UI in `HighlightPopup.tsx` is the existing "nudge" precedent.

### LittleBird advice — adopted vs. pushed back (per operator: "listen to LB's good advice, push back on the bad")

**Adopted (good instinct):**
- ✅ Paywall = a usage-count query against the already-live `usage_events`. The data seam exists; a gate is ~20 lines.
- ✅ **Share/view is a stronger trigger than build** (someone can build once and share 50×). `deliver_share` + `deliver_email` are already metered — use them.
- ✅ Time-windowed limits (e.g. 3/month). `iso_week` is on every row; `actionCount` already counts per ISO-week.

**Pushed back (wrong specifics — do NOT ship as written):**
- ❌ The proposed query `… WHERE user_id = $uid AND event = 'deliverable_build'` does not run: there is **no `user_id`** (it's `client_id`), **no `event`** (it's `action`), and the value is **`'build'`**, not `'deliverable_build'`.
- ❌ "You know exactly who built what **per user**" — only for **MCP** builds (`mcp:<uid>`). **Web builds and all `/api/meter` client actions attribute to the anonymous `sdg_cid` cookie**, not the account. A per-account paywall over those is currently impossible without the prerequisite below.

Correct "how many builds has this owner done" query, given today's reality:
```sql
-- MCP-built deliverables, attributed to the owner:
select count(*) from usage_events where client_id = 'mcp:' || $uid and action = 'build';
-- (web builds are under the anon sdg_cid cookie — NOT counted here; see prerequisite)
```

---

## PREREQUISITE for any per-account gate: attribute the gated actions to the owner uid

Today client-side actions meter to the anon `sdg_cid` cookie. For a **per-account** paywall (free N builds *per user*), the gated actions must also carry the logged-in uid. Cheapest fix: when a session user exists, write `client_id = 'uid:<auth.uid>'` (or add a nullable `user_id` column and backfill it on write). Scope: the **gated** actions only (`build`, `deliver_*`, `upload`), web + MCP, so both build paths agree. **This is the one real blocker** — tracked as check `meter_uid_attribution`. Anonymous free-tier gates (the highlighter `ask` cap) do NOT need this; the cookie is the right unit there.

---

## The flip-on mechanism (so "any gate, any time" is one env var)

Drop-in primitive — **off by default** (unset/0 env = unlimited = gate OFF), so adding it changes nothing until we set a limit:

```ts
// lib/billing/usage-gate.ts  (paste when ready; reuses actionCount from meter.ts)
import { actionCount } from "@/lib/highlighter/meter";

const LIMIT = (env: string) => { const n = Number(process.env[env]); return Number.isFinite(n) && n > 0 ? n : Infinity; };
const LIMITS: Record<string, number> = {
  build:         LIMIT("FREE_BUILD_LIMIT"),
  deliver_share: LIMIT("FREE_SHARE_LIMIT"),
  upload:        LIMIT("FREE_UPLOAD_LIMIT"),
  ask:           LIMIT("HIGHLIGHTER_FREE_WEEKLY_CAP"),
};

export class PaywallError extends Error {
  constructor(readonly action: string, readonly limit: number) { super(`free limit reached: ${action}`); }
}

/** Throws PaywallError when the client is at/over the free limit for `action`
 *  this ISO-week. No-op when the action's env limit is unset (gate OFF). */
export async function assertUnderFreeLimit(clientId: string, action: keyof typeof LIMITS): Promise<void> {
  const limit = LIMITS[action];
  if (!Number.isFinite(limit)) return;            // gate OFF
  if ((await actionCount(clientId, action)) >= limit) throw new PaywallError(action, limit);
}
```

Each gate point becomes ONE call before the action + a 402/modal on `PaywallError`. **Flip a gate on = set its env var** (`FREE_BUILD_LIMIT=3`). Flip it off = unset it. No deploy of logic, just config.

---

## The gate points, ranked (where they go + the value logic)

1. **Deliverable BUILD — primary gate.** Files: `app/api/projects/[id]/build/route.ts` (web) + `swfl_project_build` in `app/api/mcp/project-tools.ts` (MCP). Insert `assertUnderFreeLimit(ownerId, "build")` right after ownership/key resolution, before `assembleDeliverable`. Highest-value action (produces the client-ready PDF/page). Free N/month → paywall. **Needs the uid-attribution prerequisite for the web path.**
2. **Deliverable SHARE / VIEW — strongest trigger (LB's point).** Files: `/p/[id]` DeliveryButtons → `/api/meter` (`deliver_email`/`deliver_share`). A built deliverable shared repeatedly is where realized value concentrates. Two models: (a) free N shares then gate, or (b) free shares carry a watermark/"made with" footer, paid removes it. **Needs uid attribution** (shares fire from the public page under the viewer's cookie today).
3. **MCP access tier — the "pro" gate.** Set `MCP_BEARER_TOKEN` to gate the **whole** MCP behind a paid token (reads + writes). This is the `paid_path_wtp` keystone's transport lever. ⚠️ **Breaking change**: every existing connection without the bearer dies the instant it's set — only flip with zero active free consumers (Vercel-logs check above). If we want reads-free + writes-paid instead, gate the bearer *inside* the 3 write-tool handlers rather than in `auth.ts` (≈20 lines; keeps `swfl_fetch` public).
4. **Premium content page — the keystone's named first paid surface.** `paid_path_wtp` specifies "a $39–79 page on the EXISTING housing-swfl ZIP-drill + env-swfl flood AAL." This is a content/tier gate on a `/r/`-style premium report, not a usage counter — the cleanest *first* dollar because it gates a discrete artifact, not a metered verb. Likely the right place to start when revenue turns on.
5. **Highlighter ASK cap — already designed, just set the env.** `capEnabled()`/`weeklyCount()` + the amber soft-wall already exist. Anonymous-first (cookie is the correct unit — no prerequisite). Set `HIGHLIGHTER_FREE_WEEKLY_CAP` to activate. The gentlest top-of-funnel gate.
6. **Uploads / exports — minor gates.** `upload`, `export_print`, `chart_save` are metered. Low-value on their own; hold unless storage cost forces it.

**Suggested first paid move when we're ready:** Gate 4 (premium page) for the discrete-artifact dollar, with Gate 1 (build, time-windowed) as the usage gate once uid-attribution lands. Gate 5 is the free top-of-funnel nudge that can go on anytime with no prerequisite.

---

## What to do right now (open beta)

Nothing paywall-related. Ship S9 (co-build, key-gated, no bearer), keep reads public, get friends using `/project` + "Connect your AI" + build/share, and collect feedback. Revisit this doc when willingness-to-pay is the goal. The only code prerequisite to bank before the first per-account gate is `meter_uid_attribution`.
