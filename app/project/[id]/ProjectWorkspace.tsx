"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectItem } from "@/lib/project/items";
import { ADD_ITEM_EVENT, type AddItemDetail } from "@/lib/project/add-item-event";
import type { TemplateId } from "@/lib/deliverable/templates";
import { templateLabel } from "@/lib/deliverable/template-labels";
import { reorderWithinKind } from "@/lib/project/reorder";
import { buildProjectDigest } from "@/lib/project/digest";
import type { SignificantChange, ScoredEventSummary } from "@/lib/signals/types";
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
  DeliverableEditPatch,
  EmailScheduleRow,
  ProjectUiState,
} from "./workspace/types";

// Agent fields that BrandingBlock edits — used for pre-fill detection.
const AGENT_KEYS = ["agent_name", "photo_url", "license", "brokerage"] as const;

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
  trashedDeliverables: DeliverableRow[];
  emailSchedules: EmailScheduleRow[];
  feedRows: FeedRow[];
  uiState: ProjectUiState;
  fileUrls: Record<string, string>;
  mcpKey: string | null;
  seed: Seed | null;
  /** Pre-computed from computeSignificantChanges() server-side. */
  significantChanges: SignificantChange[];
  /** Scored nearby events from project_events (inject_ai=true, dismissed_at=null, 180d). */
  activeEvents: ScoredEventSummary[];
}

interface BuildOpts {
  template?: string;
  scopeKind?: string | null;
  scopeValue?: string | null;
}

/**
 * The project workspace orchestrator (Piece 1 §A). Owns per-project session state
 * and composes the workspace/* presentational components.
 *
 * Layout: Title → Brand+AI pills (popovers) → ItemsBoard → UploadDrop →
 *         DeliverableLanes → BuildActions → ProjectActionBar.
 */
export function ProjectWorkspace({
  id,
  title: initialTitle,
  branding: initialBranding,
  items: initialItems,
  charts,
  deliverables,
  trashedDeliverables,
  emailSchedules,
  feedRows,
  uiState: initialUiState,
  fileUrls,
  mcpKey,
  seed,
  significantChanges,
  activeEvents,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState<ProjectItem[]>(initialItems);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [branding, setBranding] = useState<Record<string, string>>(initialBranding ?? {});
  const [uiState, setUiState] = useState<ProjectUiState>(initialUiState);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<TemplateId>("market-overview");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  // Which pill popover is open (null = both closed).
  const [activePill, setActivePill] = useState<"brand" | "mcp" | null>(null);
  // Tracks whether a per-project MCP key is active this session (stays in sync with
  // ConnectMcpBlock's internal key state via the onKeyChange callback).
  const [hasMcpKey, setHasMcpKey] = useState(!!mcpKey);
  // Phase 3B: refresh state for the significant-changes nudge chip.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDismissed, setRefreshDismissed] = useState(false);

  // True when this project has at least one agent branding field saved.
  const hasBranding = AGENT_KEYS.some((k) => !!branding[k]);

  // Pre-fill branding from the user's saved brand profile on first pill-open
  // when the project has no agent fields yet (funnel arrivals, new projects).
  const brandPrefillAttempted = useRef(false);

  useEffect(() => {
    if (activePill !== "brand") return;
    if (brandPrefillAttempted.current) return;
    brandPrefillAttempted.current = true;

    const hasAny = AGENT_KEYS.some((k) => branding[k]);
    if (hasAny) return;

    fetch("/api/user/brand")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, unknown>) => {
        setBranding((prev) => {
          const filled = Object.fromEntries(
            AGENT_KEYS.filter((k) => typeof data[k] === "string" && data[k]).map((k) => [
              k,
              data[k] as string,
            ]),
          );
          return Object.keys(filled).length > 0 ? { ...prev, ...filled } : prev;
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePill]);

  const fileCount = items.filter((i) => i.kind === "file").length;

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
      window.location.assign(`/p/${data.id}`);
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : "Build failed — please try again.");
      setBuilding(false);
    }
  }

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

  async function saveBrandGlobal(): Promise<boolean> {
    // Fire the user-level brand save in parallel — best-effort (failure is silent;
    // the project save is the authoritative gate for the OK/close signal).
    void fetch("/api/user/brand", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(branding),
    });
    return patch({ branding }, "Branding saved");
  }

  async function saveBrandProjectOnly(): Promise<boolean> {
    return patch({ branding }, "Saved to this project");
  }

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
    if (res.ok) router.refresh();
  }

  async function refreshDeliverable(deliverableId: string): Promise<string | null> {
    const res = await fetch(`/api/deliverables/${deliverableId}/refresh`, { method: "POST" });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    router.refresh();
    return data.id ?? null;
  }

  async function editDeliverable(
    deliverableId: string,
    body: DeliverableEditPatch,
  ): Promise<{ id: string; inPlace: boolean } | null> {
    const res = await fetch(`/api/deliverables/${deliverableId}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { id?: string; inPlace?: boolean };
    router.refresh();
    return { id: data.id ?? deliverableId, inPlace: !!data.inPlace };
  }

  async function refreshItems() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/projects/${id}/refresh`, { method: "POST" });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { items?: ProjectItem[] };
        if (Array.isArray(data.items)) setItems(data.items);
      }
    } finally {
      setRefreshing(false);
      setRefreshDismissed(true);
    }
  }

  async function trashDeliverable(deliverableId: string, restore = false): Promise<boolean> {
    const res = await fetch(`/api/deliverables/${deliverableId}/trash`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ restore }),
    });
    if (res.ok) router.refresh();
    return res.ok;
  }

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
        significantChanges,
        activeEvents,
      }),
    [
      id,
      title,
      items,
      deliverables,
      emailSchedules,
      lastFreshnessSeen,
      feedRows,
      significantChanges,
      activeEvents,
    ],
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

      {/* Brand + Connect AI pills — each opens a popover panel */}
      <div className="relative mt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActivePill((p) => (p === "brand" ? null : "brand"))}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              activePill === "brand"
                ? "bg-[#00d4aa] text-[#04121b]"
                : "border border-[#00d4aa]/40 bg-[#00d4aa]/10 text-[#00d4aa] hover:bg-[#00d4aa]/20"
            }`}
          >
            {hasBranding ? "✓ Brand" : "Brand"}
          </button>
          <button
            type="button"
            onClick={() => setActivePill((p) => (p === "mcp" ? null : "mcp"))}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              activePill === "mcp"
                ? "bg-[#00d4aa] text-[#04121b]"
                : "border border-[#00d4aa]/40 bg-[#00d4aa]/10 text-[#00d4aa] hover:bg-[#00d4aa]/20"
            }`}
          >
            {hasMcpKey ? "✓ AI" : "Connect AI"}
          </button>
        </div>

        {/* Click-outside backdrop */}
        {activePill && <div className="fixed inset-0 z-40" onClick={() => setActivePill(null)} />}

        {/* Floating popover panel */}
        {activePill && (
          <div className="absolute inset-x-0 top-full z-50 mt-2 rounded-xl border border-white/15 bg-[#0d1e2b] p-4 shadow-2xl">
            {activePill === "brand" && (
              <BrandingBlock
                branding={branding}
                onChange={setBranding}
                onSaveGlobal={saveBrandGlobal}
                onSaveProjectOnly={saveBrandProjectOnly}
                saving={saving}
                savedMsg={savedMsg}
                onClose={() => setActivePill(null)}
              />
            )}
            {activePill === "mcp" && (
              <ConnectMcpBlock
                projectId={id}
                initialKey={mcpKey}
                dismissedCount={uiState.mcp_dismissed_count ?? 0}
                onDismiss={() =>
                  void patchUiState({
                    mcp_dismissed_count: (uiState.mcp_dismissed_count ?? 0) + 1,
                  })
                }
                onClose={() => setActivePill(null)}
                onKeyChange={(k) => setHasMcpKey(!!k)}
              />
            )}
          </div>
        )}
      </div>

      {/* §8 freshness nudge — specific when significantChanges present, generic fallback */}
      {digest.freshnessChangedSinceSeen && digest.freshnessToken && !refreshDismissed && (
        <div className="mb-4 mt-4 flex items-center justify-between rounded-lg border border-[#00d4aa]/20 bg-[#00d4aa]/5 px-3 py-2">
          <span className="flex items-center gap-2 text-xs text-gray-300">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#00d4aa]" />
            {significantChanges.length > 0
              ? significantChanges.length === 1
                ? significantChanges[0]!.delta_description.charAt(0).toUpperCase() +
                  significantChanges[0]!.delta_description.slice(1) +
                  " since you last visited."
                : `${significantChanges.length} of your metrics moved significantly since your last visit.`
              : "Your filed data has fresh figures."}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void refreshItems()}
              className="text-xs font-medium text-[#00d4aa] hover:underline disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh items →"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRefreshDismissed(true);
                void patchUiState({ last_freshness_token_seen: digest.freshnessToken });
              }}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Dismiss
            </button>
          </div>
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

      <div className="mt-6">
        <UploadDrop projectId={id} fileCount={fileCount} onUploaded={addFileItem} />
      </div>

      {/* Built deliverables + emailing lanes — immediately below UploadDrop */}
      <DeliverableLanes
        projectId={id}
        deliverables={deliverables}
        trashedDeliverables={trashedDeliverables}
        emailSchedules={emailSchedules}
        items={items}
        projectBranding={branding}
        mcpConnected={hasMcpKey}
        onConnectMcp={() => setActivePill("mcp")}
        onToggleRevoke={toggleRevoke}
        onRefresh={refreshDeliverable}
        onEdit={editDeliverable}
        onTrash={trashDeliverable}
      />

      <BuildActions
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
