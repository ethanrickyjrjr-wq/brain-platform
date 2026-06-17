import crypto from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { projectItemSchema, projectItemsSchema, type ProjectItem } from "@/lib/project/items";
import { lintChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { assembleDeliverable, DeliverableError } from "@/lib/deliverable/assemble";
import { parseDeliverableScope } from "@/lib/deliverable/parse-scope";
import { recordUseForClient } from "@/lib/highlighter/meter";
import { resolveOrigin } from "@/lib/fetch-brain";
import { mintClaimToken } from "@/lib/claim/claim-store";
import { DRAFT_CAP } from "@/lib/briefcase/draft";

/**
 * The three project co-build WRITE tools (Session 9).
 *
 * A user's own Claude, authorized by a per-project capability key, co-builds the
 * SAME project: list it, add items into it, and build a deliverable. Every tool
 * resolves the key → its ONE project FIRST, then writes via service-role (a
 * documented second capability-authorized lane — the cookie-RLS lane is for the
 * web UI; this is for the keyed agent). Items written carry `origin:"mcp"`.
 *
 * SECURITY:
 *  - The capability key is read ONLY from the `X-Project-Key` request header,
 *    never a tool argument — it is structurally absent from every input schema,
 *    so it cannot land in a tool-call payload / model context / client log.
 *  - (LB-R6b) The write target is derived SOLELY from the key→project lookup. No
 *    tool argument carries a `project_id`; the `item`/`template`/`instruction`
 *    args carry content only. A request can never name another project to write to.
 *  - The bearer gate (`auth.ts`) is an orthogonal transport layer left fully
 *    intact (LB-R6a) — the key is an ADDITIONAL per-call authorization.
 */

// ---------------------------------------------------------------------------
// Key → project resolution
// ---------------------------------------------------------------------------

export interface ProjectKeyRow {
  id: string;
  user_id: string;
  title: string | null;
  items: ProjectItem[] | null;
  branding: Record<string, unknown> | null;
}

/** The shape of the SDK tool `extra` we read — request headers, when the host
 *  transport forwards them. Loose by design: absent on hosts that drop them. */
interface ToolExtra {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> };
}

/**
 * The capability key arrives ONLY in the `X-Project-Key` request HEADER — never
 * as a tool argument. This is a hard guarantee, not a preference: the key is
 * structurally absent from every tool's input schema, so it can never land in a
 * tool-call payload / model context / client telemetry. A client that cannot set
 * the header cannot use these tools (fail-closed) — that is the correct trade
 * vs. an arg fallback that would silently leak the key into the call log.
 *
 * The SDK web transport builds `extra.requestInfo.headers` from the incoming
 * Request (verified in-session: mcp-handler 1.1.0 reconstructs the Request
 * preserving all headers → `webStandardStreamableHttp` →
 * `Object.fromEntries(req.headers.entries())`, lowercased keys → forwarded to the
 * tool handler's `extra`).
 */
export function keyFromHeader(extra: ToolExtra | undefined): string | null {
  const header = extra?.requestInfo?.headers?.["x-project-key"];
  const headerVal = Array.isArray(header) ? header[0] : header;
  if (typeof headerVal === "string" && headerVal.trim()) return headerVal.trim();
  return null;
}

/**
 * Resolve a capability key → its single project via SERVICE-ROLE lookup on the
 * UNIQUE `projects.mcp_key`. The returned `project.id` is the ONLY write target
 * downstream — derived SOLELY from the key. Returns null on no / blank / unmatched
 * key (regenerate overwrites `mcp_key`, so an old key matches no row = revoked).
 */
export async function resolveProjectByKey(
  db: SupabaseClient,
  key: string | null,
): Promise<ProjectKeyRow | null> {
  if (!key) return null;
  const { data } = await db
    .from("projects")
    .select("id, user_id, title, items, branding")
    .eq("mcp_key", key)
    .maybeSingle();
  return (data as ProjectKeyRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// [ADDED] dedupe — a co-building Claude filing twice must not spam the project
// ---------------------------------------------------------------------------

/** True when `candidate` already exists by its identity fields (kind +
 *  report_id + label/value for metric, + question/answer for qa, text for note,
 *  slug for report). Charts are always unique (each carries a fresh chart_id). */
export function isDuplicateItem(existing: ProjectItem[], candidate: ProjectItem): boolean {
  return existing.some((e) => {
    if (e.kind !== candidate.kind) return false;
    if (e.kind === "metric" && candidate.kind === "metric")
      return (
        e.report_id === candidate.report_id &&
        e.label === candidate.label &&
        e.value === candidate.value
      );
    if (e.kind === "qa" && candidate.kind === "qa")
      return (
        e.report_id === candidate.report_id &&
        e.question === candidate.question &&
        e.answer === candidate.answer
      );
    if (e.kind === "note" && candidate.kind === "note") return e.text === candidate.text;
    if (e.kind === "report" && candidate.kind === "report") return e.slug === candidate.slug;
    return false;
  });
}

/** Stamp the server-owned fields onto a validated content item. */
function stamp<T extends object>(partial: T): T & { id: string; added_at: string; origin: "mcp" } {
  return {
    ...partial,
    id: crypto.randomUUID(),
    added_at: new Date().toISOString(),
    origin: "mcp" as const,
  };
}

// ---------------------------------------------------------------------------
// Tool input schemas — NO field anywhere carries a project_id (LB-R6b)
// ---------------------------------------------------------------------------

const chartBlockInput = z
  .object({
    title: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
    chart_type: z.enum(["bar", "area", "scatter", "table"]).optional(),
    value_format: z.unknown().optional(),
    asOf: z.string().optional(),
  })
  .passthrough();

/** The MCP `item` arg — the union restricted to the agent-fileable kinds.
 *  `chart_block` is converted to a `{kind:"chart"}` ref server-side after lint. */
const addItemInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note"), text: z.string().min(1) }),
  z.object({
    kind: z.literal("metric"),
    report_id: z.string(),
    label: z.string(),
    value: z.string(),
    source_url: z.string().optional(),
    source_label: z.string().optional(),
    freshness_token: z.string(),
  }),
  z.object({
    kind: z.literal("qa"),
    report_id: z.string(),
    question: z.string(),
    answer: z.string(),
    fact: z.string().optional(),
    reach: z.array(z.string()).optional(),
    freshness_token: z.string().optional(),
  }),
  z.object({
    kind: z.literal("report"),
    slug: z.string(),
    title: z.string().optional(),
    freshness_token: z.string().optional(),
  }),
  z.object({
    kind: z.literal("chart_block"),
    block: chartBlockInput,
    title: z.string(),
    report: z.string().optional(),
  }),
]);

type AddItemInput = z.infer<typeof addItemInput>;

const TEMPLATE_ENUM = z.enum(["market-overview", "bov-lite", "client-email", "one-pager", "email"]);

/** The deliverable scope kinds (the email_schedules contract). `email` deliverables
 *  carry a ZIP/place/county scope so /p/[id] reconstructs the grounded model. */
const SCOPE_KIND_ENUM = z.enum(["zip", "place", "county"]);

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const errText = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });
const NO_KEY = errText(
  "No project key found. These tools read the key ONLY from the `X-Project-Key` request header — your MCP client must send it (copy the connect command from the “Connect your AI” panel on the project page). The key is never accepted as a tool argument.",
);
const INVALID_KEY = errText(
  "Invalid or expired project key — no changes were made. Ask the project owner for a fresh key from the “Connect your AI” panel on the project page.",
);

/**
 * Resolve the per-project key from the request header → its project. Returns the
 * project, or the right error response: NO_KEY when the header is absent (so the
 * caller knows to configure it), INVALID_KEY when present but unmatched/revoked.
 */
async function authorize(
  db: SupabaseClient,
  extra: ToolExtra | undefined,
): Promise<{ project: ProjectKeyRow } | { error: ReturnType<typeof errText> }> {
  const key = keyFromHeader(extra);
  if (!key) return { error: NO_KEY };
  const project = await resolveProjectByKey(db, key);
  if (!project) return { error: INVALID_KEY };
  return { project };
}

/** A short, customer-clean one-liner per item for the list view (no internal ids). */
function describeItem(it: ProjectItem): string {
  switch (it.kind) {
    case "metric":
      return `${it.label}: ${it.value}`;
    case "qa":
      return it.question;
    case "note":
      return it.text.length > 80 ? it.text.slice(0, 79) + "…" : it.text;
    case "chart":
      return it.title;
    case "report":
      return it.title ?? it.slug;
    case "source":
      return it.label;
    case "table_slice":
      return it.title;
    case "frame":
      return it.title;
    case "file":
      return it.caption ?? "attachment";
  }
}

// ---------------------------------------------------------------------------
// chart_block → saved_charts → {kind:"chart"} ref
// ---------------------------------------------------------------------------

async function buildChartItem(
  db: SupabaseClient,
  input: Extract<AddItemInput, { kind: "chart_block" }>,
): Promise<{ item: ProjectItem } | { error: string }> {
  // Provenance/structure gate — same lint the web /api/charts/save path runs.
  const lint = lintChartBlock(input.block, null, { requireAsOf: true });
  if (!lint.ok) return { error: `Chart rejected: ${lint.errors.join("; ")}` };
  const chart_id = crypto.randomUUID().slice(0, 8);
  const { error } = await db.from("saved_charts").insert({
    id: chart_id,
    chart_block: input.block,
    source_meta: input.report ? { report_id: input.report } : null,
    freshness_token: null,
  });
  if (error) return { error: "Could not save the chart." };
  return { item: stamp({ kind: "chart" as const, chart_id, title: input.title }) };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectTools(server: McpServer): void {
  // -- swfl_project_list ----------------------------------------------------
  server.registerTool(
    "swfl_project_list",
    {
      title: "SWFL Project — list",
      description:
        "List the project authorized by your `X-Project-Key` request header: its title and a condensed view of the items already filed. Read-only. The key is read only from the header — never pass it as an argument.",
      inputSchema: {},
      annotations: {
        title: "SWFL Project — list",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (_args, extra) => {
      const db = createServiceRoleClient();
      const auth = await authorize(db, extra as ToolExtra);
      if ("error" in auth) return auth.error;
      const { project } = auth;
      const items = Array.isArray(project.items) ? project.items : [];
      const lines = items.length
        ? items.map((it, i) => `${i + 1}. [${it.kind}] ${describeItem(it)}`).join("\n")
        : "(no items filed yet)";
      return text(`Project: ${project.title ?? "Untitled"}\n${items.length} item(s)\n\n${lines}`);
    },
  );

  // -- swfl_project_add -----------------------------------------------------
  server.registerTool(
    "swfl_project_add",
    {
      title: "SWFL Project — add item",
      description:
        "File ONE item into the project authorized by your `X-Project-Key` request header. File metrics with the exact value, source url, and freshness_token from the dossier you just fetched — verbatim, never recomputed. Kinds: note | metric | qa | report | chart_block. The key is read only from the header — never pass it as an argument.",
      inputSchema: {
        item: addItemInput.describe(
          "The single item to file. Quote every figure/source/freshness_token verbatim from the fetched dossier — never invent or recompute.",
        ),
      },
      annotations: {
        title: "SWFL Project — add item",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (args, extra) => {
      const db = createServiceRoleClient();
      const auth = await authorize(db, extra as ToolExtra);
      if ("error" in auth) return auth.error;
      const { project } = auth;

      // Build the final ProjectItem (chart_block → lint → saved_charts → ref).
      let item: ProjectItem;
      if (args.item.kind === "chart_block") {
        const built = await buildChartItem(db, args.item);
        if ("error" in built) return errText(built.error);
        item = built.item;
      } else {
        item = stamp({ ...args.item });
      }

      // Validate against the canonical schema before it ever touches the row.
      const validated = projectItemSchema.safeParse(item);
      if (!validated.success) return errText("That item did not validate; nothing was filed.");
      item = validated.data;

      const existing = Array.isArray(project.items) ? project.items : [];
      if (isDuplicateItem(existing, item)) {
        return text(
          `Already filed — skipped the duplicate. “${project.title ?? "Your project"}” has ${existing.length} item(s).`,
        );
      }

      const next = [...existing, item];
      const finalParse = projectItemsSchema.safeParse(next);
      if (!finalParse.success)
        return errText("The project item set did not validate; nothing was filed.");

      // Write target = the resolved project id ONLY (LB-R6b).
      const { error: upErr } = await db
        .from("projects")
        .update({ items: finalParse.data, updated_at: new Date().toISOString() })
        .eq("id", project.id);
      if (upErr) return errText("Could not file the item. Please try again.");

      await recordUseForClient(`mcp:${project.user_id}`, {
        report_id: project.id,
        reach: [],
        action: "item_add",
      });
      return text(
        `Filed into “${project.title ?? "your project"}”. It now has ${next.length} item(s).`,
      );
    },
  );

  // -- swfl_project_build ---------------------------------------------------
  server.registerTool(
    "swfl_project_build",
    {
      title: "SWFL Project — build deliverable",
      description:
        "Assemble a client-ready deliverable from everything filed in the project authorized by your `X-Project-Key` request header, and return a shareable link. Pick a template; an optional instruction steers the framing. The `email` template builds a send-ready branded email — pass `scope_kind`/`scope_value` (e.g. zip 33931) so it stays grounded to that place. Numbers are quoted verbatim from the filed items — nothing is invented. The key is read only from the header — never pass it as an argument.",
      inputSchema: {
        template: TEMPLATE_ENUM.describe(
          "Deliverable template: market-overview | bov-lite | client-email | one-pager | email.",
        ),
        instruction: z
          .string()
          .optional()
          .describe("Optional framing instruction (e.g. “lead with the flood-risk caveat”)."),
        scope_kind: SCOPE_KIND_ENUM.optional().describe(
          "Scope kind for an `email` deliverable: zip | place | county. Required with scope_value to keep an email grounded to one place.",
        ),
        scope_value: z
          .string()
          .optional()
          .describe("The scope value, e.g. “33931” (zip) or “Fort Myers Beach” (place)."),
      },
      annotations: {
        title: "SWFL Project — build deliverable",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (args, extra) => {
      const db = createServiceRoleClient();
      const auth = await authorize(db, extra as ToolExtra);
      if ("error" in auth) return auth.error;
      const { project } = auth;
      // G4: thread the deliverable scope so an `email` build stays grounded to its
      // ZIP/place/county (same contract + parser as the web build route).
      const scope = parseDeliverableScope(args.scope_kind, args.scope_value);
      try {
        const { id } = await assembleDeliverable({
          db,
          projectId: project.id,
          ownerId: project.user_id,
          items: project.items,
          branding: project.branding,
          template: args.template,
          instruction: args.instruction ?? "",
          ...scope,
        });
        // A-8.5: an MCP build is still a build by the owner's account — stamp the
        // owner uid as user_id (the same single identity as the web build) so the
        // trial window counts MCP-first builds. client_id stays mcp:<owner_uid>.
        await recordUseForClient(
          `mcp:${project.user_id}`,
          { report_id: project.id, reach: [], action: "build" },
          project.user_id,
        );
        return text(`Built. Share this link: ${resolveOrigin()}/p/${id}`);
      } catch (e) {
        if (e instanceof DeliverableError) return errText(`Build failed: ${e.message}`);
        return errText("Build failed unexpectedly. Please try again.");
      }
    },
  );

  // -- swfl_project_handoff (KEYLESS carry-back, Plan B) --------------------
  // The ONE keyless write tool: it lets a user's Claude carry an ANONYMOUS
  // conversation (no X-Project-Key) over to the web to be claimed under a real
  // account. It NEVER reads the header, NEVER calls authorize()/resolveProjectByKey,
  // and writes NOTHING to any project — it only mints a short-TTL claim token. The
  // read-only swfl_fetch tool (server.ts) is untouched by this.
  server.registerTool(
    "swfl_project_handoff",
    {
      title: "SWFL Project — hand off to the web",
      description:
        "Carry the items you've assembled in THIS conversation over to the web, where the user signs in to claim them, then refine and build a polished deliverable. No project key needed — returns a link to continue on the web. Quote every figure, source url, and freshness_token verbatim from the dossiers you fetched — never invent or recompute. Offer this once, when the user wants to save, share, or build something from what they've seen — never as a hard sell.",
      inputSchema: {
        items: z
          .array(addItemInput)
          .min(1)
          .describe(
            "The items to carry over — the cited facts, Q&A, notes, and reports from this conversation. Quote figures/sources/freshness_tokens verbatim; never invent or recompute.",
          ),
        title: z.string().optional().describe("Optional title for the carried project."),
      },
      annotations: {
        title: "SWFL Project — hand off to the web",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (args) => {
      // KEYLESS: no authorize(), no header read, no project write. Only claim_tokens.
      const db = createServiceRoleClient();
      const raw = args.items as AddItemInput[];

      // Storage-amplification guard — count first (cheap), size after building.
      if (raw.length > DRAFT_CAP)
        return errText(
          `Too many items to hand off (${raw.length}; max ${DRAFT_CAP}). Carry the most important ones.`,
        );

      // Build each item EXACTLY like swfl_project_add: chart_block → lint →
      // saved_charts → {kind:"chart"} ref; everything else → stamp(origin:"mcp").
      //
      // chart_block inserts a saved_charts row EAGERLY. If a LATER item (or the
      // schema/size guards below) then fails, those already-inserted rows would be
      // orphaned (never referenced by any project — no token gets minted). Track the
      // inserted ids and delete them on any failure path before the token is minted.
      const built: ProjectItem[] = [];
      const insertedChartIds: string[] = [];
      async function cleanupOrphanCharts() {
        if (insertedChartIds.length === 0) return;
        try {
          await db.from("saved_charts").delete().in("id", insertedChartIds);
        } catch {
          /* best-effort — never throw out of an error path */
        }
      }
      for (const it of raw) {
        if (it.kind === "chart_block") {
          const r = await buildChartItem(db, it);
          if ("error" in r) {
            await cleanupOrphanCharts();
            return errText(r.error);
          }
          if (r.item.kind === "chart") insertedChartIds.push(r.item.chart_id);
          built.push(r.item);
        } else {
          built.push(stamp({ ...it }));
        }
      }

      const parsed = projectItemsSchema.safeParse(built);
      if (!parsed.success) {
        await cleanupOrphanCharts();
        return errText("Those items did not validate; nothing was handed off.");
      }

      const bytes = Buffer.byteLength(JSON.stringify(parsed.data), "utf8");
      if (bytes > 256 * 1024) {
        await cleanupOrphanCharts();
        return errText("That's too much to hand off at once. Carry fewer items.");
      }

      const token = await mintClaimToken(parsed.data, args.title ?? null);

      // Beacon: observability ONLY, never a gate, never an identity. The anonymous
      // handoff has no auth.uid → client_id is a fixed beacon label, not a per-user
      // id (deriving one here would be the binding scheme the plan rejected).
      await recordUseForClient("mcp:anon-handoff", {
        report_id: "",
        reach: [],
        action: "handoff_mint",
      });

      return text(`Continue on the web (sign in to claim): ${resolveOrigin()}/claim?t=${token}`);
    },
  );
}
