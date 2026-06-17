"use client";

/** Editable project title + Save. State is owned by the orchestrator. */
export function ProjectTitle({
  title,
  onChange,
  onSave,
  dirty,
  saving,
  savedMsg,
}: {
  title: string;
  onChange: (next: string) => void;
  onSave: () => void;
  dirty: boolean;
  saving: boolean;
  savedMsg: string | null;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Untitled project"
          className="flex-1 rounded-lg border border-white/10 bg-[#0d1e2b]/80 px-3 py-2 text-lg font-semibold text-white outline-none focus:border-[#00d4aa]/40"
        />
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onSave}
          className="rounded-full bg-[#00d4aa] px-4 py-2 text-sm font-medium text-[#04121b] disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {savedMsg && <p className="mt-2 text-xs text-gray-400">{savedMsg}</p>}
    </>
  );
}
