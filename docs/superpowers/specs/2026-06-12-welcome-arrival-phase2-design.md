# Welcome-Arrival Phase 2 — Design Spec

**Date:** 2026-06-12 · **Status:** Approved design, ready for `writing-plans`. Not yet built.

Phase 2 of the SWFL Visuals → welcome-arrival flow (Phase 1 shipped in `92501f6`: tokenized
viz cards, render pipeline, `/showcase`, `/welcome` stub). This phase ships **three tested
libs/routes** and wires the welcome stub to a live explainer chat. The full conversion funnel
(email gate, free branded build, session state) is **explicitly out of scope** — see
`docs/superpowers/plans/2026-06-12-welcome-funnel-phase3-notes.md` (ledger: `phase3_welcome_funnel`).

---

## Locked decisions (from the 2026-06-12 design session)

1. **Enrich path = Hybrid** (vendor bake-off ran live on 3 real domains; table below). Firecrawl
   `branding` format senses the palette in one call; a `claude-haiku-4-5` pass reads the
   **complete labeled color map** and selects primary/secondary + confidence. Not scrape+Claude
   (worst color sourcing in the test), not pure-branding (mislabels).
2. **Caller = pure libs.** `enrich-brand.ts` + `build-arrival-url.ts` ship tested and typed with
   **no caller wired**. Two future callers exist (cold-outreach, deferred; welcome free-build,
   Phase 3) — neither is built here.
3. **Chat = un-grounded explainer.** Fixed system prompt, **no live brain data**, **illustrative
   capability ranges not hardcoded stats**, steers data asks to sign-up. Never invents a SWFL
   number (the moat holds even pre-paywall).
4. **All 4 welcome prompts open the live chat;** conversion prompts get an in-chat "sign up to
   build it →" steer; `/pricing` stays the CTA target.

### Moat guardrail (non-negotiable, carried from the design session)

The un-grounded chat must **never** emit a specific SWFL figure (flood AAL, sale price, rate). On
any request for a concrete number it steers to sign-up instead of answering. Precise cited
numbers come only from the grounded deliverable engine — which is Phase 3, not here.

---

## Vendor-verified facts (in-session, Vendor-First)

**Firecrawl v2 `branding` format** — `POST https://api.firecrawl.dev/v2/scrape`, `Authorization:
Bearer <FIRECRAWL_API_KEY>`, body `{ url, formats: ["branding"] }`. Real response captured from
`century21.com` + `sagerealtor.com`:

```
data.branding keys: colorScheme, fonts, colors, typography, spacing, components,
                    images, personality, designSystem, confidence, __llm_* (reasoning)
data.branding.colors:  { primary, secondary, accent, background, textPrimary, link,
                         [textSecondary, success, warning, error] }   ← real brand color
                                                                         often under `link`/`accent`
data.branding.images:  { logo, favicon, ogImage, logoHref, logoAlt }  ← logo lives HERE
data.branding.logo:    null   ← top-level `logo` is null; DO NOT read it
data.branding.components: { buttonPrimary, buttonSecondary, input, ... } (per-element colors)
data.branding.confidence: number (Firecrawl's own)
```

**Bake-off evidence (why hybrid):** on `century21.com` the real "relentless gold" `#BEAF87` came
back under `colors.link`, not `colors.primary` (which was a neutral `#6E5E5E`). On
`premiersothebysrealty.com` branding nailed navy `primary` + gold `accent`. scrape+Claude found
**0 CSS vars on 2 of 3 brands** → guessed from noisy frequent-hex (red primary on C21). Conclusion:
branding *senses* colors best; Haiku *selects* from the full labeled map.

**Anthropic forced-tool JSON** — `claude-haiku-4-5` (repo `TRIAGE_MODEL`; $1/$5 per MTok),
`tool_choice: { type: "tool", name: "select_brand" }`, tool with `input_schema` + `strict: true`;
read `msg.content.find(b => b.type === "tool_use").input`. Reuse `getAnthropic()` from
`refinery/agents/anthropic.mts`.

---

## Component 1 — `lib/prospects/enrich-brand.ts`

Hybrid enrichment. Network I/O but **zero app/route coupling**; deps injected for testability.

```ts
export type BrandEnrichment = {
  primary: string | null;       // hex or null
  secondary: string | null;     // hex or null
  logo_url: string | null;      // absolute URL or null
  confidence: number;           // 0..1; 0 on fallback
  source: "firecrawl-branding+haiku" | "fallback";
  company_name?: string | null;
};

export type EnrichDeps = {
  fetchImpl?: typeof fetch;                 // default: global fetch
  anthropic?: Pick<Anthropic, "messages">;  // default: getAnthropic()
  firecrawlKey?: string;                    // default: env.firecrawlApiKey
};

export async function enrichBrand(domain: string, deps?: EnrichDeps): Promise<BrandEnrichment>;
```

**Flow:**

1. Normalize `domain` (strip protocol/path; lowercase). `POST /v2/scrape { url:
   "https://"+domain, formats: ["branding"] }`.
2. Take `b = data.branding`. Build the Haiku input by passing the **whole sub-objects verbatim —
   no key whitelist** (forward-compatible if Firecrawl adds keys):
   `{ domain, colorScheme: b.colorScheme, colors: b.colors, components: b.components,
      images: b.images, firecrawl_confidence: b.confidence }`.
3. `claude-haiku-4-5`, `max_tokens: 300`, forced tool `select_brand` (schema below). **Prompt
   instructs explicitly:** *"This is the COMPLETE labeled color map Firecrawl extracted. The real
   brand color is frequently NOT under `primary` — it often hides under `link`, `accent`, or a
   `components` button color (e.g. a real-estate brand's gold under `colors.link`). Examine every
   key. Pick `primary_hex` = the dominant brand color (never a neutral white/black/near-gray or
   the `background`), `secondary_hex` = a complementary brand color (or ""), `logo_url` = the best
   logo (prefer `images.logo`, else `ogImage`, else `favicon`), `confidence` 0..1."*
4. Read the `tool_use` block input:
   - **Logo (explicit field path):** take Haiku's `logo_url`; if empty, fall back to
     **`b.images.logo`** — the real logo path — then `b.images.ogImage`, then `b.images.favicon`.
     **Never read `b.logo` (top-level): it is `null` in this API.** Absolutize the result against
     `https://domain` (Firecrawl may return a relative path); `null` if none.
   - **Colors:** validate each hex (`/^#[0-9a-fA-F]{3,8}$/`) → `null` if not.
   - **company_name:** `"" → null`.
5. Return `{ ..., source: "firecrawl-branding+haiku" }`.

**Error / empty handling (GAP-3 discipline — never SWFL-default inside the lib):** Firecrawl
non-2xx, network error, missing `data.branding`, or Haiku error → return
`{ primary: null, secondary: null, logo_url: null, confidence: 0, source: "fallback" }`. Never
throw to the caller; the *consumer* decides whether to apply SWFL defaults. Log at `warn`.

`select_brand` tool `input_schema` (`strict: true`, `additionalProperties: false`,
all required): `primary_hex: string`, `secondary_hex: string`, `logo_url: string`,
`company_name: string`, `confidence: number`. The prompt asks for `company_name` alongside the
colors.

**`company_name` source (explicit):** **best-effort, Haiku-inferred** from `b.images.logoAlt` /
the domain (Firecrawl's branding response has **no dedicated company-name field** — there is
nothing to read directly). `""` when unknown, mapped to `null`. Optional and **not load-bearing**
for Phase 2 — it only supplies a default for `build-arrival-url`'s `name`.

**Tests** (`lib/prospects/enrich-brand.test.mts`, `bun test`): inject `fetchImpl` returning the
**real branding fixtures captured in the spike** (century21 → gold under `link`; Sotheby's → navy
primary + gold accent; Sage → Divi default), inject a mock `anthropic` returning a `tool_use`
block; assert: (a) C21 selection promotes `#BEAF87` from `link` to primary (the whole point);
(b) Sotheby's keeps navy primary; (c) Firecrawl non-2xx → `source:"fallback"`, all nulls,
`confidence:0`; (d) freemail/unbrandable domain returning empty `branding` → fallback;
(e) relative `logo_url` is absolutized; (f) a non-hex `primary_hex` → null.

---

## Component 2 — `lib/prospects/build-arrival-url.ts`

Genuinely pure string builder. No I/O.

```ts
export function buildArrivalUrl(input: {
  name?: string;
  brand?: BrandEnrichment | null;
  base?: string; // default "" → relative "/welcome?…"
}): string;
```

Emits `/welcome?name=&primary=&secondary=&logo=` honoring the welcome page's **exact** validators
(`app/welcome/page.tsx`): hex must match `/^#[0-9a-fA-F]{3,8}$/`, logo must match `^https?://`.
Drop any param that's empty/invalid so the page never receives junk it would reject.
URL-encode `name`; if `name` is omitted, fall back to `brand?.company_name`. If `base` given,
return absolute; else relative. Maps `brand.primary → primary`, `brand.secondary → secondary`,
`brand.logo_url → logo`.

**Tests** (`lib/prospects/build-arrival-url.test.mts`): name encoding (spaces/unicode/`&`);
valid hex passes, `rgb()`/garbage dropped; `http(s)` logo passes, `javascript:`/relative dropped;
all-null brand → bare `/welcome`; `base` → absolute URL; param order stable.

---

## Component 3 — `app/api/welcome/chat/route.ts`

Un-grounded explainer. Mirror the `/api/converse` SSE pattern (`messages.stream()` + the
`extractText` MessageStreamEvent helper + `text/event-stream` + `Cache-Control: no-store`) but
**strip all grounding** — no `fetchBrain`, no `buildDossier`, no reach, no chart, no
`RULES_OF_ENGAGEMENT`/gazetteer import.

- **Model:** `claude-haiku-4-5`, `max_tokens: ~500`.
- **Body:** `{ messages: { role: "user" | "assistant"; content: string }[] }`. Validate non-empty,
  last role `user`; **cap to the last 12 messages** server-side. 400 on bad JSON / empty.
- **System prompt (fixed constant in the route):**

  > You are the assistant for SWFL Data Gulf — live, cited intelligence on Southwest Florida
  > (Lee, Collier, Charlotte, Glades, Hendry, Sarasota) real estate, building permits, flood risk,
  > freight, tourism, and the local economy, down to the ZIP and named-place level. You are talking
  > to a visitor who hasn't signed up yet. Explain plainly what the platform can do and how it would
  > help their work. Speak in illustrative ranges, never specific current statistics — e.g.
  > "beachfront and barrier-island ZIPs carry the region's steepest flood-loss estimates, while
  > inland corridors are far lower," never a precise dollar figure. **You do not have live data in
  > this conversation. If asked for a specific number (a flood loss, a sale price, a rate), do NOT
  > make one up and do NOT guess — say that's exactly what a project builds (a cited, branded
  > one-pager) and steer them to sign up: "sign up and you can build it →". Inventing a Southwest
  > Florida number is the one thing you must never do.** Plain text only — no markdown, no asterisks,
  > no headers, no bullet characters, no backticks. Never use internal jargon (no "master", "brain",
  > "payload", "grain", "dossier"). Be a knowledgeable, direct local expert, not a salesperson.

- **Plain-text directive:** reuse the converse `FORMAT_RULE` verbatim (prepended).
- **Stream + error:** same `ReadableStream` shape as converse — `data: {text}` frames, terminal
  `data: {done:true}`, `data: {error}` on throw, `controller.close()` in `finally`.

### Light guard = insert-only telemetry (no enforcement) — concrete per operator

Per request, fire-and-forget INSERT one row into `public.welcome_chat_usage`
(`cid` = `sdg_cid` cookie, `ip` = first hop of `x-forwarded-for` / `x-real-ip`, `turn_count` =
`messages.length`), via a small helper in the **same fire-and-forget shape as
`lib/highlighter/meter` `recordUse`** (the converse route's existing telemetry pattern — don't
reinvent the Supabase client). **Zero enforcement now** — pure observability so Phase 3 tunes the
20-turn / abuse gate against real data instead of guessed thresholds. Wrap in `void … .catch()` so
a telemetry failure never breaks the chat stream.

**Migration** (`docs/sql/20260612_welcome_chat_usage.sql`, idempotent, run directly per RULE 1):

```sql
CREATE TABLE IF NOT EXISTS public.welcome_chat_usage (
  id          bigint generated always as identity primary key,
  cid         text,
  ip          text,                       -- raw IP for internal tuning; hash in Phase 3 if desired
  turn_count  integer,
  created_at  timestamptz not null default now()
);
-- insert-only; written by the welcome chat route's service-role client. No RLS gate needed
-- (no per-user reads). GRANT INSERT to the role the route uses; NOTIFY pgrst to reload.
```

**Tests** (`app/api/welcome/chat/route.test.ts`, mirror converse route tests): mock the Anthropic
stream; assert SSE `text` frames + terminal `done`; assert the route **never imports/calls
`fetchBrain`** and the system prompt contains the no-invention line; 400 on bad body; telemetry
insert is best-effort (a throwing insert still yields a clean stream).

---

## Component 4 — Wire the welcome stub

`app/welcome/page.tsx` (server component) keeps reading `?name/primary/secondary/logo` and the
brand CSS vars (`--brand-primary/secondary`), but replaces the 4 `/pricing` links + disabled input
with a new client child:

**`app/welcome/WelcomeChat.tsx`** (`'use client'`): renders the 4 arrival prompts + a live input;
streams from `/api/welcome/chat` (parse `text/event-stream`, append assistant text). **All 4
prompts open the chat** (seed the first user message). The conversion steer for prompts #2/#4 is
**system-prompt driven** (the model says "sign up to build it →"); render a persistent
"See pricing →" chip linking `/pricing` (still the CTA target — no paywall yet). Brand colors flow
from the page's CSS vars into the chat UI (send button uses `var(--brand-primary)`, already wired).

Page-paint isn't headless-verifiable — the build brief should flag a manual browser smoke
(stream renders, prompts seed, brand colors apply), not fake it.

---

## Supporting changes

- **`refinery/config/env.mts`:** add `firecrawlApiKey: string | undefined` to the type +
  `firecrawlApiKey: process.env.FIRECRAWL_API_KEY` to the snapshot (additive — no type-lift, no
  backfill). `requireEnv(["firecrawlApiKey"])` available for `enrich-brand` to fail loud if unset.
- **`docs/sql/20260612_welcome_chat_usage.sql`** — the telemetry table above.

---

## Testing summary

| Surface | Tool | Self-verifiable? |
|---|---|---|
| `build-arrival-url` | `bun test` (pure) | yes |
| `enrich-brand` | `bun test` (injected fetch + Anthropic, spike fixtures) | yes |
| `/api/welcome/chat` | route test (mocked stream) | yes — logic |
| welcome page paint | manual browser smoke | **no** (flag, don't fake) |

`tsc` + `eslint` clean on changed files. No vocab/pack/refinery surfaces touched → the RULE-1
vocab/lockfile/secret pre-push gates don't apply; the session-log + ops-board sync still do.

## Out of scope (Phase 3 — do not build here)

`welcome_sessions` state, turn-4 email gate, 20-turn **enforcement**, the grounded free branded
build, `free_build_used` check-and-set, the cold-outreach caller. All captured in
`docs/superpowers/plans/2026-06-12-welcome-funnel-phase3-notes.md`.

## File manifest

```
NEW  lib/prospects/enrich-brand.ts            + .test.mts
NEW  lib/prospects/build-arrival-url.ts       + .test.mts
NEW  app/api/welcome/chat/route.ts            + route.test.ts
NEW  app/welcome/WelcomeChat.tsx
EDIT app/welcome/page.tsx                     (stub → live chat child)
EDIT refinery/config/env.mts                  (+ firecrawlApiKey)
NEW  docs/sql/20260612_welcome_chat_usage.sql (apply directly, idempotent)
DEL  scripts/spike/brand-enrich-compare.mts, scripts/spike/dump-branding.mts  (throwaway)
```
