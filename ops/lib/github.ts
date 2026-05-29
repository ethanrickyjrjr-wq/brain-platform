/**
 * GitHub signal adapter. Read-only. All calls degrade gracefully when
 * GITHUB_PAT is unset (returns { available:false }) so the app builds and runs
 * locally without secrets.
 */

const REPO = process.env.GITHUB_REPO ?? "ethanrickyjrjr-wq/brain-platform";
const BRANCH = process.env.GITHUB_BRANCH ?? "main";
const PAT = process.env.GITHUB_PAT;

const API = "https://api.github.com";

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (PAT) h.Authorization = `Bearer ${PAT}`;
  return h;
}

export interface WorkflowRun {
  name: string;
  path: string; // .github/workflows/foo.yml
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | null
  created_at: string;
  html_url: string;
}

/** Latest run per workflow file. One API call (per_page=100). */
export async function latestWorkflowRuns(): Promise<{
  available: boolean;
  runs: WorkflowRun[];
}> {
  if (!PAT) return { available: false, runs: [] };
  try {
    const res = await fetch(`${API}/repos/${REPO}/actions/runs?per_page=100`, {
      headers: headers(),
      next: { revalidate: 300 },
    });
    if (!res.ok) return { available: false, runs: [] };
    const data = (await res.json()) as {
      workflow_runs?: Array<{
        name: string;
        path: string;
        status: string;
        conclusion: string | null;
        created_at: string;
        html_url: string;
      }>;
    };
    const byPath = new Map<string, WorkflowRun>();
    for (const r of data.workflow_runs ?? []) {
      // runs come newest-first; keep the first seen per path
      if (!byPath.has(r.path)) {
        byPath.set(r.path, {
          name: r.name,
          path: r.path,
          status: r.status,
          conclusion: r.conclusion,
          created_at: r.created_at,
          html_url: r.html_url,
        });
      }
    }
    return { available: true, runs: [...byPath.values()] };
  } catch {
    return { available: false, runs: [] };
  }
}

/** Raw text of a repo file. Uses the contents API (works on private repos). */
export async function rawText(path: string): Promise<string | null> {
  if (!PAT) return null;
  try {
    const res = await fetch(
      `${API}/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
      {
        headers: { ...headers(), Accept: "application/vnd.github.raw" },
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** List a directory's file names via the contents API. */
export async function listDir(path: string): Promise<string[]> {
  if (!PAT) return [];
  try {
    const res = await fetch(
      `${API}/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
      { headers: headers(), next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ name: string; type: string }>;
    return data.filter((e) => e.type === "file").map((e) => e.name);
  } catch {
    return [];
  }
}

export const githubMeta = { repo: REPO, branch: BRANCH, hasPat: Boolean(PAT) };
