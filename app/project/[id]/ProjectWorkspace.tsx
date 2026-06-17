"use client";

import { useState } from "react";
import type { ProjectItem } from "@/lib/project/items";
import type { TemplateId } from "@/lib/deliverable/templates";
import { reorderWithinKind } from "@/lib/project/reorder";
import { UploadDrop } from "@/components/project/UploadDrop";
import { ProjectTitle } from "./workspace/ProjectTitle";
import { ItemsBoard } from "./workspace/ItemsBoard";
import { BrandingBlock } from "./workspace/BrandingBlock";
import { ConnectMcpBlock } from "./workspace/ConnectMcpBlock";
import { DeliverableLanes } from "./workspace/DeliverableLanes";
import { BuildActions } from "./workspace/BuildActions";
import type { SavedChart, DeliverableRow } from "./workspace/types";

interface Props {
  id: string;
  title: string | null;
  branding: Record<string, string> | null;
  items: ProjectItem[];
  charts: Record<string, SavedChart>;
  deliverables: DeliverableRow[];
  /** Server-minted 1h signed URLs for `{kind:"file"}` items, keyed by storage_path. */
  fileUrls: Record<string, string>;
  /** The per-project capability key (null until first minted). */
  mcpKey: string | null;
}

/**
 * The project workspace orchestrator (Piece 1 §A). Owns the per-project session
 * state (items/title/branding/deliverables/previews/build) and the patch/mutate
 * handlers; composes the `workspace/*` presentational components. Replaces the
 * 743-line `ProjectDetail` monolith. Cross-build contract: P2 adds prompt
 * surfaces and P4 adds edit/trash controls into these same mount points.
 */
export function ProjectWorkspace({
  id,
  title: initialTitle,
  branding: initialBranding,
  items: initialItems,
  charts,
  deliverables: initialDeliverables,
  fileUrls,
  mcpKey,
}: Props) {
  const [items, setItems] = useState<ProjectItem[]>(initialItems);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [branding, setBranding] = useState<Record<string, string>>(initialBranding ?? {});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [deliverables, setDeliverables] = useState<DeliverableRow[]>(initialDeliverables);
  // Object-URL previews for files uploaded THIS session (server signed URLs only
  // arrive on the next full page load). Keyed by item id.
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<TemplateId>("market-overview");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const fileCount = items.filter((i) => i.kind === "file").length;

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

  async function runBuild() {
    if (building || items.length === 0) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const res = await fetch(`/api/projects/${id}/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template }),
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

  async function patch(body: Record<string, unknown>, okMsg: string) {
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
      } else {
        setSavedMsg("Save failed");
      }
    } catch {
      setSavedMsg("Save failed");
    } finally {
      setSaving(false);
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
      setDeliverables((prev) =>
        prev.map((d) =>
          d.id === deliverableId ? { ...d, status: restore ? "ready" : "revoked" } : d,
        ),
      );
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
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
      />

      {/* Connect your AI — per-project capability key (S9) */}
      <ConnectMcpBlock projectId={id} initialKey={mcpKey} />

      {/* Built deliverables — owner kill-switch (S7) + Send-weekly handle */}
      <DeliverableLanes projectId={id} deliverables={deliverables} onToggleRevoke={toggleRevoke} />

      <BuildActions
        projectId={id}
        template={template}
        onTemplate={setTemplate}
        onBuild={() => void runBuild()}
        building={building}
        buildError={buildError}
        itemCount={items.length}
      />
    </main>
  );
}
