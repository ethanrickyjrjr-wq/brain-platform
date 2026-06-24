"use client";

import { useState, useEffect, useRef } from "react";
import type { Contact, ImportResult } from "@/lib/contacts/types";
import { PageShell } from "@/components/PageShell";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", phone: "", tags: "" });
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/contacts");
    if (res.ok) setContacts(await res.json());
  }
  useEffect(() => {
    // Inline fetch (not `load()`) so the linter sees the async boundary —
    // setState happens in a .then callback, never synchronously in the effect.
    fetch("/api/contacts")
      .then((r) => (r.ok ? r.json() : []))
      .then(setContacts)
      .catch(() => {});
  }, []);

  const allTags = Array.from(new Set(contacts.flatMap((c) => c.tags))).sort();
  const q = search.trim().toLowerCase();
  const visible = contacts.filter((c) => {
    const matchSearch =
      !q || c.email.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q);
    const matchTag = !activeTag || c.tags.includes(activeTag);
    return matchSearch && matchTag;
  });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: addForm.name || null,
        email: addForm.email,
        phone: addForm.phone || null,
        tags: addForm.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setShowAdd(false);
      setAddForm({ name: "", email: "", phone: "", tags: "" });
      await load();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this contact?")) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    await load();
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/contacts/import", { method: "POST", body: fd });
    const data: ImportResult & { error?: string } = await res.json();
    setBusy(false);
    setImportMsg(
      data.error
        ? `Import failed: ${data.error}`
        : `Added ${data.added}${data.skipped ? `, skipped ${data.skipped}` : ""}.`,
    );
    await load();
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <PageShell className="py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">
          Contacts
          <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-sm text-gray-400">
            {contacts.length}
          </span>
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 disabled:opacity-50"
          >
            Import CSV / vCard
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.vcf"
            className="hidden"
            onChange={handleImport}
          />
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-lg bg-[#0a8078] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0a8078]/80"
          >
            Add contact
          </button>
        </div>
      </div>

      {importMsg && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-[#0a8078]/30 bg-[#0a8078]/10 px-4 py-2 text-sm text-[#0a8078]">
          <span>{importMsg}</span>
          <button className="opacity-60 hover:opacity-100" onClick={() => setImportMsg(null)}>
            ×
          </button>
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email…"
        className="mb-4 w-full rounded-lg border border-white/10 bg-[#0d1e2b] px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0a8078]"
      />

      {allTags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTag(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${!activeTag ? "bg-[#0a8078] text-white" : "border border-white/10 text-gray-400 hover:text-white"}`}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${activeTag === tag ? "bg-[#0a8078] text-white" : "border border-white/10 text-gray-400 hover:text-white"}`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">
          {contacts.length === 0
            ? "No contacts yet. Import a CSV / vCard or add one manually."
            : "No contacts match your search."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visible.map((c) => (
                <tr key={c.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-white">
                    {c.name ?? <span className="text-gray-500">—</span>}
                    {c.unsubscribed && (
                      <span className="ml-2 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300">
                        unsubscribed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{c.email}</td>
                  <td className="px-4 py-3 text-gray-400">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-gray-300"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-xs text-red-400 opacity-60 hover:opacity-100"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1e2b] p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Add contact</h2>
            <form onSubmit={handleAdd} className="space-y-3">
              <input
                placeholder="Name (optional)"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <input
                placeholder="Email address"
                required
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <input
                placeholder="Phone (optional)"
                value={addForm.phone}
                onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <input
                placeholder="Tags, comma-separated (e.g. investors, FMB)"
                value={addForm.tags}
                onChange={(e) => setAddForm((f) => ({ ...f, tags: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-[#0a8078] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save contact"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  );
}
