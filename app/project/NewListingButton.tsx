"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * New Listing entry (Build 1 of the New Listing lifecycle). Creates a project with
 * `kind:"listing"` anchored to an optional saved subject address. The address is a
 * single input that may be left blank — when blank, the create route parses it from
 * the title if the title is itself an address, and otherwise leaves it unset (never
 * invented). Distinct from New Project so the listing anchor is set at creation.
 */
export function NewListingButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const subject = address.trim();
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: subject || "Untitled listing",
          kind: "listing",
          ...(subject ? { subject_address: subject } : {}),
        }),
      });
      if (res.ok) {
        const { id } = (await res.json()) as { id?: string };
        if (id) router.push(`/project/${id}`);
      }
    } catch {
      // leave the form open so the user can retry
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-gulf-teal px-4 py-2 text-sm font-medium text-gulf-teal transition-opacity hover:opacity-90"
      >
        New listing
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void create();
      }}
      className="flex items-center gap-2"
    >
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Listing address (optional)"
        aria-label="Listing address (optional)"
        autoFocus
        className="rounded-full border border-white/20 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-gulf-teal focus:outline-none"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-gulf-teal px-4 py-2 text-sm font-medium text-[#04121b] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create"}
      </button>
    </form>
  );
}
