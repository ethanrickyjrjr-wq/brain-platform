"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectItem } from "@/lib/project/items";
import { ADD_ITEM_EVENT, type AddItemDetail } from "@/lib/project/add-item-event";
import type { TemplateId } from "@/lib/deliverable/templates";
import { templateLabel } from "@/lib/deliverable/template-labels";
import { reorderWithinKind } from "@/lib/project/reorder";
import { buildProjectDigest } from "@/lib/project/digest";
import type { FeedRow } from "@/lib/project/feed";
import { deriveProjectName } from "@/lib/project/derive-name";
import { ProjectAiContextBridge } from "./workspace/ProjectAiContextBridge";
import { UploadDrop } from "@/components/project/UploadDrop";
import { ProjectTitle } from "./workspace/ProjectTitle";
import { ItemsBoard } from "./workspace/ItemsBoard";
import { BrandingBlock } from "./workspace/BrandingBlock";
import { ConnectMcpBlock } from "./workspace/ConnectMcpBlock";
import { DeliverableLanes } from "./workspace/DeliverableLanes";
import { BuildActions } from "./workspace/BuildActions";
import { ProjectActionBar } from "./workspace/ProjectActionBar";
import type {
  SavedChart,
  DeliverableRow,
  EmailScheduleRow,
  ProjectUiState,
} from "./workspace/types";

interface Seed {
  template: string;
  scopeKind: string | null;
  scopeValue: string | null;
}

interface Props {
  id: string;
  title: string | null;
  branding: Record<string, string> | null;
  items: ProjectItem[];
  charts: Record<string, SavedChart>;
  deliverables: DeliverableRow[];
  emailSchedules: EmailScheduleRow[];
  /** Piece 3 durable-context-bus signals (`project_feed`), folded into the digest. */
  feedRows: FeedRow[];
  uiState: ProjectUiState;
  /** Server-minted 1h signed URLs for `{kind:"file"}` items, keyed by storage_path. */
  fileUrls: Record<string, string>;
  /** The per-project capability key (null until first minted). */
  mcpKey: string | null;
  /** Email-through-Projects handoff (§I): pre-stage a one-click build. */
  seed: Seed | null;
}

interface BuildOpts {
  template?: string;
  scopeKind?: string | null;
  scopeValue?: string | null;
}

/**
 * The project workspace orchestrator (Piece 1 §A). Owns the per-project session
 * state (items/title/branding/deliverables/ui_state/previews/build) and the
 * patch/mutate handlers; composes the `workspace/*` presentational components.
 * Cross-build contract: P2 adds prompt surfaces and P4 adds edit/trash controls
 * into these same mount points.
 */
export function ProjectWorkspace({
  id,
  title: initialTitle,
  branding: initialBranding,
  items: initialItems,
  charts,
  deliverables,
  emailSchedules,
  feedRows,
  uiState: initialUiState,
  fileUrls,
  mcpKey,
  seed,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState<ProjectItem[]>(initialItems);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [branding, setBranding] = useState<Record<string, string>>(initialBranding ?? {});
  const [uiState, setUiState] = useState<ProjectUiState>(initialUiState);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  // Object-URL previews for files uploaded THIS session (server signed URLs only
  // arrive on the next full page load). Keyed by item id.
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<TemplateId>("market-overview");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const fileCount = items.filter((i) => i.kind === "file").length;

  // Bottom-bar search "Add" (§F) routes here so the workspace stays the SOLE writer
  // of items: append to the CURRENT array (merging any unsaved reorder) + persist —
  // no dual read-modify-write, so an add can't be lost to a concurrent workspace
  // save. The listener re-binds on every `items` change, so it always closes over
  // the current array (React renders between separate click events). Persisting does
  // NOT touch `dirty`: the add is auto-saved; an unsaved title stays dirty.
  useEffect(() => {
    function onAdd(e: Event) {
      const detail = (e as CustomEvent<AddItemDetail>).detail;
      if (!detail || detail.projectId !== id) return;
      if (items.some((i) => i.id === detail.item.id)) return;
      const next = [...items, detail.item];
      setItems(next);
      setSaving(true);
      setSavedMsg(null);
      fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: next }),
      })
        .then((res) => setSavedMsg(res.ok ? "Added" : "Save failed"))
        .catch(() => setSavedMsg("Save failed"))
        .finally(() => setSaving(false));
    }
    window.addEventListener(ADD_ITEM_EVENT, onAdd);
    return () => window.removeEventListener(ADD_ITEM_EVENT, onAdd);
  }, [items, id]);

  function mutate(next: ProjectItem[]) {
    setItems(next);
    setDirty(true);
  }
  function removeById(itemId: string) {
    mutate(items.filter((it) => it.id !== itemId));
  }
  /** Reorder within the item's KIND (keeps the grouped board stable). */
  function move(itemId: string, dir: -1 | 1) {
    const next = reorderWithinKind(items, itemId, dir);
    if (next !== items) mutate(next);
  }

  async function runBuild(opts?: BuildOpts) {
    if (building || items.length === 0) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const body: Record<string, unknown> = { template: opts?.template ?? template };
      if (opts?.scopeKind && opts?.scopeValue) {
        body.scope_kind = opts.scopeKind;
        body.scope_value = opts.scopeValue;
      }
      const res = await fetch(`/api/projects/${id}/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error || "Build failed — please try again.");
      // Success → the deliverable page (page unloads; no need to clear `building`).
      window.location.assign(`/p/${data.id}`);
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : "Build failed — please try again.");
      setBuilding(false);
    }
  }

  /** PATCH the project; returns whether it succeeded (lets callers like the branding
   *  block collapse only on success). */
  async function patch(body: Record<string, unknown>, okMsg: string): Promise<boolean> {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSavedMsg(okMsg);
        if ("items" in body || "title" in body) setDirty(false);
        return true;
      }
      setSavedMsg("Save failed");
      return false;
    } catch {
      setSavedMsg("Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Merge + persist the per-project UI bag (§E). Optimistic, with rollback so a
   *  failed persist doesn't desync the dismiss count from the server. */
  async function patchUiState(partial: Partial<ProjectUiState>) {
    const prevUi = uiState;
    const next = { ...uiState, ...partial };
    setUiState(next);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ui_state: next }),
      });
      if (!res.ok) setUiState(prevUi);
    } catch {
      setUiState(prevUi);
    }
  }

  // Upload success → append the file item, persist the whole array (also saves any
  // pending reorders/title), and keep a local preview so it renders immediately.
  async function addFileItem(item: ProjectItem, objectUrl: string) {
    const next = [...items, item];
    setItems(next);
    setLocalPreviews((p) => ({ ...p, [item.id]: objectUrl }));
    setDirty(false);
    await patch({ items: next, title: title || null }, "File attached");
  }

  async function toggleRevoke(deliverableId: string, currentStatus: string) {
    const restore = currentStatus === "revoked";
    const res = await fetch(`/api/deliverables/${deliverableId}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ restore }),
    });
    if (res.ok) {
      // Deliverables are server-driven props now; refresh re-reads the new status
      // into the lane (and re-adopts non-dirty items via the reconciliation above).
      router.refresh();
    }
  }

  // Piece 2: derive the project digest from the LIVE workspace state so the persistent
  // pill is project-aware and stays current as items are added/edited this session. Pure
  // + cheap; the bridge below seeds it into the context-bus store the pill reads. The
  // (nodejs-only) reconcile read for staleMetrics stays out of the client → [] here.
  const lastFreshnessSeen =
    typeof uiState.last_freshness_token_seen === "string"
      ? uiState.last_freshness_token_seen
      : undefined;
  const digest = useMemo(
    () =>
      buildProjectDigest({
        projectId: id,
        title: title || deriveProjectName(items),
        items,
        deliverables: deliverables.map((d) => ({
          id: d.id,
          template: d.template,
          created_at: d.created_at,
        })),
        schedules: emailSchedules.map((s) => ({
          cadence: s.cadence,
          scope_kind: s.scope_kind,
          scope_value: s.scope_value,
          topic: s.topic,
          last_run_at: s.last_run_at,
        })),
        lastFreshnessTokenSeen: lastFreshnessSeen,
        staleMetrics: [],
        feedRows,
      }),
    [id, title, items, deliverables, emailSchedules, lastFreshnessSeen, feedRows],
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <ProjectAiContextBridge digest={digest} />
      {seed && (
        <div className="mb-6 rounded-xl border border-[#00d4aa]/40 bg-[#00d4aa]/10 p-4">
          <p className="text-sm font-medium text-white">
            Ready to build a {templateLabel(seed.template)}
            {seed.scopeValue ? ` for ${seed.scopeValue.toUpperCase()}` : ""}.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Seeded from your last step — review the items below, then build a preview.
          </p>
          <button
            type="button"
            onClick={() =>
              void runBuild({
                template: seed.template,
                scopeKind: seed.scopeKind,
                scopeValue: seed.scopeValue,
              })
            }
            disabled={building || items.length === 0}
            className="btn-gradient mt-3 rounded-full px-4 py-2 text-sm font-semibold text-navy-dark disabled:opacity-50"
          >
            {building ? "Building…" : `Build ${templateLabel(seed.template)} preview`}
          </button>
          {buildError && <p className="mt-2 text-xs text-red-400">{buildError}</p>}
        </div>
      )}

      <ProjectTitle
        title={title}
        onChange={(t) => {
          setTitle(t);
          setDirty(true);
        }}
        onSave={() => patch({ items, title: title || null }, "Saved")}
        dirty={dirty}
        saving={saving}
        savedMsg={savedMsg}
      />

      {/* §8 — freshness write-back: show when the project's data moved since last seen */}
      {digest.freshnessChangedSinceSeen && digest.freshnessToken && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-[#00d4aa]/20 bg-[#00d4aa]/5 px-3 py-2">
          <span className="flex items-center gap-2 text-xs text-gray-300">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#00d4aa]" />
            Your data has fresh figures.
          </span>
          <button
            type="button"
            onClick={() => void patchUiState({ last_freshness_token_seen: digest.freshnessToken })}
            className="text-xs text-[#00d4aa] hover:underline"
          >
            Got it →
          </button>
        </div>
      )}

      <ItemsBoard
        items={items}
        charts={charts}
        fileUrls={fileUrls}
        localPreviews={localPreviews}
        onMove={move}
        onRemove={removeById}
      />

      {/* Upload (images + PDFs) */}
      <div className="mt-6">
        <UploadDrop projectId={id} fileCount={fileCount} onUploaded={addFileItem} />
      </div>

      <BrandingBlock
        branding={branding}
        onChange={setBranding}
        onSave={() => patch({ branding }, "Branding saved")}
        saving={saving}
        savedMsg={savedMsg}
      />

      {/* Connect your AI — per-project capability key (S9) + §E collapse/dismiss */}
      <ConnectMcpBlock
        projectId={id}
        initialKey={mcpKey}
        dismissedCount={uiState.mcp_dismissed_count ?? 0}
        onDismiss={() =>
          void patchUiState({ mcp_dismissed_count: (uiState.mcp_dismissed_count ?? 0) + 1 })
        }
      />

      {/* Built deliverables (thumbnails → modal) + schedule-driven Emailing lane */}
      <DeliverableLanes
        projectId={id}
        deliverables={deliverables}
        emailSchedules={emailSchedules}
        onToggleRevoke={toggleRevoke}
      />

      <BuildActions
        projectId={id}
        template={template}
        onTemplate={setTemplate}
        onBuild={() => void runBuild()}
        building={building}
        buildError={buildError}
        itemCount={items.length}
      />

      {/* G1 — authenticated free-form action surface (Piece 2) */}
      <ProjectActionBar projectId={id} />
    </main>
  );
}
