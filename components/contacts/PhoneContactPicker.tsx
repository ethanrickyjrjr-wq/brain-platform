"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * Phone-side contact import via the browser Contact Picker API
 * (`navigator.contacts.select`). Available on Android Chrome and a few other
 * Chromium mobile browsers; NOT on iOS (Apple exposes no web contacts API), so
 * we feature-detect and show a guided fallback instead of a dead button.
 *
 * The selected contacts POST to /api/email/contacts/phone with the signed import
 * `token` (the phone has no login session — the token is the authorization).
 */

// Minimal typing for the Contact Picker API (absent from the DOM lib).
interface ContactInfo {
  name?: string[];
  email?: string[];
  tel?: string[];
}
interface ContactsManager {
  select(properties: string[], options?: { multiple?: boolean }): Promise<ContactInfo[]>;
  getProperties?(): Promise<string[]>;
}

type Phase = "idle" | "picking" | "saving" | "done" | "error";

/** Capability is static per browser, so read it via useSyncExternalStore (no
 *  effect-setState; hydration-safe: server snapshot is always `false`). */
const noopSubscribe = () => () => {};
function getPickerSupported(): boolean {
  const mgr = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  return Boolean(mgr && typeof mgr.select === "function");
}

export function PhoneContactPicker({ token }: { token: string }) {
  const supported = useSyncExternalStore(noopSubscribe, getPickerSupported, () => false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function pick() {
    setMessage(null);
    const mgr = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
    if (!mgr) return;
    try {
      setPhase("picking");
      const picked = await mgr.select(["name", "email"], { multiple: true });
      // One row per email address; the picker returns parallel name[]/email[] arrays.
      const contacts: { email: string; name: string | null }[] = [];
      for (const c of picked) {
        const name = c.name?.find((n) => n.trim())?.trim() ?? null;
        for (const email of c.email ?? []) {
          if (email && email.trim()) contacts.push({ email: email.trim(), name });
        }
      }
      if (contacts.length === 0) {
        setPhase("idle");
        setMessage("No email addresses found on the contacts you picked.");
        return;
      }

      setPhase("saving");
      const res = await fetch("/api/email/contacts/phone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, contacts }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        imported?: number;
        skippedPersonal?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `import failed (${res.status})`);
      setPhase("done");
      setMessage(
        `Imported ${json.imported ?? 0} contact${(json.imported ?? 0) === 1 ? "" : "s"}` +
          (json.skippedPersonal ? `, skipped ${json.skippedPersonal} personal` : "") +
          ". You can close this and finish on your computer.",
      );
    } catch (e) {
      // AbortError = user dismissed the native sheet; treat as a benign cancel.
      if (e instanceof DOMException && e.name === "AbortError") {
        setPhase("idle");
        return;
      }
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "Import failed — please try again.");
    }
  }

  if (!supported) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0d1e2b]/60 p-4 text-sm text-gray-300">
        <p className="font-medium text-white">This phone can’t share contacts to the web</p>
        <p className="mt-1 text-gray-400">
          iPhone (and some browsers) don’t let websites read contacts directly. The easy path:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-400">
          <li>On your computer, use “Import from Google Contacts.”</li>
          <li>Or if your contacts aren’t in Google, export a vCard and upload it.</li>
        </ul>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="rounded-xl border border-[#0a8078]/30 bg-[#0a8078]/10 p-4 text-sm text-[#0a8078]">
        ✓ {message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => void pick()}
        disabled={phase === "picking" || phase === "saving"}
        className="rounded-full bg-[#00d4aa] px-5 py-3 text-base font-semibold text-[#04121b] disabled:opacity-40"
      >
        {phase === "saving" ? "Saving…" : phase === "picking" ? "Choosing…" : "Choose contacts"}
      </button>
      {message && (
        <p className={phase === "error" ? "text-sm text-red-400" : "text-sm text-gray-400"}>
          {message}
        </p>
      )}
    </div>
  );
}
