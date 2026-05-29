/**
 * The ledger — the derived-status brain.
 *
 * Combines real signals (GitHub workflow runs, raw repo files, Supabase
 * _dlt_loads, direct table freshness) into categorized GREEN / YELLOW / RED items.
 *
 * DERIVED (never hand-typed): existence + done-or-not.
 * HUMAN INPUT: build-queue.md sets YELLOW items and RED priority order.
 */
import { parse as parseYaml } from "yaml";
import { latestWorkflowRuns, rawText, listDir, githubMeta } from "./github";
import { latestDltLoads, directTableFreshness, supabaseMeta } from "./supabase";

export type Status = "green" | "yellow" | "red";

export interface LedgerItem {
  id: string;
  label: string;
  status: Status;
  cols: Record<string, string>;
  updatedAt: string | null;
  link?: string;
  note?: string;
}

export interface Category {
  key: string;
  title: string;
  dot: string;
  columns: string[];
  items: LedgerItem[];
}

export interface QueueItem {
  label: string;
  status: Status;
  order: number;
}

export interface Ledger {
  generatedAt: string;
  signals: { github: boolean; supabase: boolean };
  categories: Category[];
  queue: QueueItem[];
}

const DOT = {
  pipelines: "#f59e0b",
  brains: "#8b5cf6",
  sources: "#3b82f6",
  services: "#10b981",
};

function parseQueue(md: string | null): QueueItem[] {
  if (!md) return [];
  const out: QueueItem[] = [];
  let order = 0;
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*-\s*\[([ x~])\]\s+(.*\S)\s*$/i);
    if (!m) continue;
    const mark = m[1].toLowerCase();
    const status: Status =
      mark === "x" ? "green" : mark === "~" ? "yellow" : "red";
    out.push({ label: m[2], status, order: order++ });
  }
  return out;
}

function applyQueueOverlay(items: LedgerItem[], queue: QueueItem[]): void {
  const building = queue.filter((q) => q.status === "yellow");
  for (const item of items) {
    const hay = `${item.id} ${item.label}`.toLowerCase();
    if (
      building.some(
        (q) =>
          hay.includes(q.label.toLowerCase()) ||
          q.label.toLowerCase().includes(item.id.toLowerCase()),
      )
    ) {
      item.status = "yellow";
    }
  }
}

function ageDays(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

// ── Pipelines / cron ──────────────────────────────────────────────────────────
interface RegistryEntry {
  name: string;
  lane?: string;
  cadence_days?: number;
  tolerance_multiplier?: number;
  dlt_schema_name?: string;
  freshness_table?: string; // non-dlt: check MAX(inserted_at) on this table
}

async function buildPipelines(): Promise<Category> {
  // Fetch registry + dlt loads in parallel; then resolve direct-table specs.
  const [registryRaw, dlt] = await Promise.all([
    rawText("ingest/cadence_registry.yaml"),
    latestDltLoads(),
  ]);

  let reg: {
    pipelines?: RegistryEntry[];
    not_yet_running?: RegistryEntry[];
  } = {};
  if (registryRaw) {
    try {
      reg = parseYaml(registryRaw) ?? {};
    } catch {
      reg = {};
    }
  }

  const freshnessTables = (reg.pipelines ?? [])
    .filter((e) => e.freshness_table)
    .map((e) => e.freshness_table!);

  const direct = await directTableFreshness(freshnessTables);

  const loadBySchema = new Map(
    dlt.loads.map((l) => [l.schema_name, l.last_loaded]),
  );
  const loadByTable = new Map(
    direct.loads.map((l) => [l.table_name, l.last_inserted]),
  );

  const items: LedgerItem[] = [];

  for (const e of reg.pipelines ?? []) {
    const cadence = e.cadence_days ?? 30;
    const tol = e.tolerance_multiplier ?? 2.0;

    // Prefer freshness_table signal; fall back to dlt_loads.
    const loaded = e.freshness_table
      ? (loadByTable.get(e.freshness_table) ?? null)
      : (loadBySchema.get(e.dlt_schema_name ?? e.name) ?? null);

    let status: Status = "red";
    if (loaded && ageDays(loaded) <= cadence * tol) status = "green";
    else if (loaded)
      status = "red"; // stale
    else if (e.lane !== "tier-2") status = "green"; // tier-1: no dlt, assume ok

    const signalMissing =
      !e.freshness_table && !dlt.available
        ? "Supabase signal unavailable — load freshness unknown"
        : undefined;

    items.push({
      id: e.name,
      label: e.name,
      status,
      updatedAt: loaded,
      cols: {
        Lane: e.lane ?? "—",
        Cadence: `${cadence}d`,
        "Last load": loaded ? loaded.slice(0, 10) : "—",
      },
      note: signalMissing,
    });
  }

  for (const e of reg.not_yet_running ?? []) {
    items.push({
      id: e.name,
      label: e.name,
      status: "red",
      updatedAt: null,
      cols: { Lane: e.lane ?? "—", Cadence: "—", "Last load": "never run" },
    });
  }

  return {
    key: "pipelines",
    title: "Pipelines & Cron",
    dot: DOT.pipelines,
    columns: ["Pipeline", "Lane", "Cadence", "Last load", "Status"],
    items,
  };
}

// ── Workflows (GHA) ───────────────────────────────────────────────────────────
async function buildWorkflows(): Promise<Category> {
  const { runs } = await latestWorkflowRuns();
  const items: LedgerItem[] = runs
    .map((r) => {
      let status: Status = "red";
      if (r.status !== "completed") status = "yellow";
      else if (r.conclusion === "success") status = "green";
      return {
        id: r.path.replace(".github/workflows/", ""),
        label: r.name,
        status,
        updatedAt: r.created_at,
        link: r.html_url,
        cols: {
          "Last run": r.created_at.slice(0, 10),
          Result: r.conclusion ?? r.status,
        },
      } as LedgerItem;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return {
    key: "workflows",
    title: "GitHub Actions",
    dot: "#06b6d4",
    columns: ["Workflow", "Last run", "Result", "Status"],
    items,
  };
}

// ── Brains ────────────────────────────────────────────────────────────────────
async function buildBrains(): Promise<Category> {
  const files = (await listDir("brains")).filter(
    (f) => f.endsWith(".md") && !f.includes("--") && f !== "test-alpha.md",
  );
  const items = await Promise.all(
    files.map(async (f): Promise<LedgerItem> => {
      const id = f.replace(/\.md$/, "");
      const md = await rawText(`brains/${f}`);
      const token = md?.match(/freshness_token:\s*([^\n]+)/)?.[1]?.trim();
      const refined = md?.match(/refined_at:\s*([^\n]+)/)?.[1]?.trim() ?? null;
      return {
        id,
        label: id,
        status: token ? "green" : "red",
        updatedAt: refined,
        cols: {
          "Freshness token": token ?? "—",
          "Refined at": refined ? refined.slice(0, 10) : "—",
        },
      };
    }),
  );
  return {
    key: "brains",
    title: "Brains",
    dot: DOT.brains,
    columns: ["Brain", "Freshness token", "Refined at", "Status"],
    items: items.sort((a, b) => a.label.localeCompare(b.label)),
  };
}

// ── Services / health ─────────────────────────────────────────────────────────
async function ping(url: string | undefined): Promise<Status> {
  if (!url) return "red";
  try {
    const res = await fetch(url, { method: "GET", next: { revalidate: 300 } });
    return res.ok || res.status === 405 || res.status === 401 ? "green" : "red";
  } catch {
    return "red";
  }
}

async function buildServices(): Promise<Category> {
  const [mcp, site] = await Promise.all([
    ping(process.env.MCP_URL),
    ping(process.env.MAIN_SITE_URL),
  ]);
  const items: LedgerItem[] = [
    {
      id: "mcp",
      label: "MCP endpoint",
      status: mcp,
      updatedAt: null,
      cols: { Target: process.env.MCP_URL ?? "—" },
    },
    {
      id: "site",
      label: "Main site (swfldatagulf.com)",
      status: site,
      updatedAt: null,
      cols: { Target: process.env.MAIN_SITE_URL ?? "—" },
    },
    {
      id: "supabase",
      label: "Supabase",
      status: supabaseMeta.hasEnv ? "green" : "red",
      updatedAt: null,
      cols: { Target: supabaseMeta.hasEnv ? "configured" : "no env" },
    },
    {
      id: "github",
      label: "GitHub signal",
      status: githubMeta.hasPat ? "green" : "red",
      updatedAt: null,
      cols: { Target: githubMeta.hasPat ? githubMeta.repo : "no PAT" },
    },
  ];
  return {
    key: "services",
    title: "Services & Health",
    dot: DOT.services,
    columns: ["Service", "Target", "Status"],
    items,
  };
}

export async function buildLedger(): Promise<Ledger> {
  const queueRaw = await rawText("_AUDIT_AND_ROADMAP/build-queue.md");
  const queue = parseQueue(queueRaw);

  const categories = await Promise.all([
    buildPipelines(),
    buildWorkflows(),
    buildBrains(),
    buildServices(),
  ]);

  for (const c of categories) applyQueueOverlay(c.items, queue);

  return {
    generatedAt: new Date().toISOString(),
    signals: { github: githubMeta.hasPat, supabase: supabaseMeta.hasEnv },
    categories,
    queue,
  };
}
