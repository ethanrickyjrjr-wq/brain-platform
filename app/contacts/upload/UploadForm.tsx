"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * Contact import surface. Two entry points into the SAME email_contacts pipeline:
 *
 *  1. Google Contacts — a full-page redirect to /api/email/contacts/google/start
 *     (OAuth), returning here with ?source=google&imported=…; we then run /sync.
 *  2. CSV — POST /api/email/contacts/upload (tagged with the list name) then
 *     POST /api/email/contacts/sync to materialize the Resend segment.
 *
 * The "Work emails only" toggle rides both paths: it's a query flag on the Google
 * link and a body flag on the CSV upload.
 */

interface UploadResult {
  inserted: number;
  updated: number;
  skipped: number;
  skippedPersonal?: number;
  errors?: string[];
}

const SAMPLE = "email,name,tags\njane@example.com,Jane Buyer,\njohn@example.com,John Client,";

const GOOGLE_ERRORS: Record<string, string> = {
  not_configured: "Google import isn’t switched on yet — use CSV for now.",
  denied: "Google sign-in was cancelled.",
  state: "That sign-in link expired — please try Google again.",
  fetch: "Couldn’t read your Google contacts — please try again.",
};

export function UploadForm({
  backHref,
  qrAll,
  qrWork,
}: {
  backHref: string;
  qrAll?: string | null;
  qrWork?: string | null;
}) {
  const params = useSearchParams();
  const [csv, setCsv] = useState("");
  const [vcard, setVcard] = useState("");
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [workOnly, setWorkOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [synced, setSynced] = useState(false);

  const qr = workOnly ? qrWork : qrAll;

  // ---- Google import return (?source=google | ?google_error=…) -----------------
  const googleError = params.get("google_error");
  const fromGoogle = params.get("source") === "google";
  const googleImported = Number(params.get("imported") ?? 0);
  const googlePersonal = Number(params.get("personal") ?? 0);
  const googleSkipped = Number(params.get("skipped") ?? 0);
  const [googleSynced, setGoogleSynced] = useState(false);

  useEffect(() => {
    // Materialize the freshly-imported Google contacts into a pickable audience.
    if (fromGoogle && googleImported > 0 && !googleSynced) {
      void fetch("/api/email/contacts/sync", { method: "POST" }).finally(() =>
        setGoogleSynced(true),
      );
    }
  }, [fromGoogle, googleImported, googleSynced]);

  async function onFile(file: File) {
    setError(null);
    const text = await file.text();
    const isVcard = /\.vcf$/i.test(file.name) || /^\s*BEGIN:VCARD/i.test(text);
    if (isVcard) {
      setVcard(text);
      setCsv("");
      setFileLabel(`${file.name} (vCard ready)`);
    } else {
      setCsv(text);
      setVcard("");
      setFileLabel(`${file.name} (CSV ready)`);
    }
  }

  const submit = useCallback(async () => {
    setError(null);
    setResult(null);
    setSynced(false);
    const tag = listName.trim().toLowerCase();
    if (!csv.trim() && !vcard.trim()) {
      setError("Paste a CSV, or choose a .csv / .vcf file first.");
      return;
    }
    if (!tag) {
      setError("Give the list a name — it becomes the audience you send to.");
      return;
    }
    setBusy(true);
    try {
      const payload = vcard.trim()
        ? { vcard, tags: [tag], workOnly }
        : { csv, tags: [tag], workOnly };
      const up = await fetch("/api/email/contacts/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const upJson = (await up.json().catch(() => ({}))) as UploadResult & { error?: string };
      if (!up.ok) throw new Error(upJson.error || `upload failed (${up.status})`);
      setResult(upJson);

      // Materialize the audience (Resend segment + email_audiences row). Non-fatal.
      const sync = await fetch("/api/email/contacts/sync", { method: "POST" });
      setSynced(sync.ok);
      if (!sync.ok) {
        setError(
          "Contacts saved, but the audience list didn’t finish building — try again shortly.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed — please try again.");
    } finally {
      setBusy(false);
    }
  }, [csv, vcard, listName, workOnly]);

  // ---- Google success banner --------------------------------------------------
  if (fromGoogle && googleImported > 0) {
    return (
      <div className="mt-6 rounded-xl border border-[#0a8078]/30 bg-[#0a8078]/10 p-4">
        <p className="text-sm text-[#0a8078]">
          ✓ Imported {googleImported} contact{googleImported === 1 ? "" : "s"} from Google
          {googlePersonal > 0 ? `, skipped ${googlePersonal} personal` : ""}
          {googleSkipped > 0 ? `, ${googleSkipped} skipped` : ""}.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {googleSynced
            ? "They’re now a pickable “google” audience on your reports’ Send weekly."
            : "Building your audience list…"}
        </p>
        <Link
          href={backHref}
          className="mt-3 inline-block rounded-full bg-[#00d4aa] px-4 py-2 text-sm font-medium text-[#04121b]"
        >
          Back to your work
        </Link>
      </div>
    );
  }

  // ---- CSV success banner -----------------------------------------------------
  if (result && synced) {
    const total = result.inserted + result.updated;
    const personal = result.skippedPersonal ?? 0;
    return (
      <div className="mt-6 rounded-xl border border-[#0a8078]/30 bg-[#0a8078]/10 p-4">
        <p className="text-sm text-[#0a8078]">
          ✓ Added {total} contact{total === 1 ? "" : "s"} to “{listName.trim().toLowerCase()}”
          {personal > 0 ? `, skipped ${personal} personal` : ""}
          {result.skipped > 0 ? ` (${result.skipped} skipped)` : ""}.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          It’s now a pickable audience on your reports’ Send weekly.
        </p>
        <Link
          href={backHref}
          className="mt-3 inline-block rounded-full bg-[#00d4aa] px-4 py-2 text-sm font-medium text-[#04121b]"
        >
          Back to your work
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* Work-emails-only toggle — applies to BOTH Google and CSV. */}
      <label className="flex items-start gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={workOnly}
          onChange={(e) => setWorkOnly(e.target.checked)}
          className="mt-0.5 accent-[#00d4aa]"
        />
        <span>
          Work emails only
          <span className="block text-xs text-gray-500">
            Skip personal addresses (gmail, icloud, yahoo…) and keep company/professional ones.
          </span>
        </span>
      </label>

      {/* Google Contacts — full-page OAuth redirect (carries the toggle as a query flag). */}
      <div className="rounded-xl border border-white/10 bg-[#0d1e2b]/50 p-4">
        <h2 className="text-sm font-semibold text-white">Import from Google Contacts</h2>
        <p className="mt-1 text-xs text-gray-500">
          One tap — works on your phone or computer if your contacts live in Google.
        </p>
        <a
          href={`/api/email/contacts/google/start?work_only=${workOnly ? "1" : "0"}`}
          className="mt-3 inline-block rounded-full bg-[#00d4aa] px-4 py-2 text-sm font-semibold text-[#04121b]"
        >
          Import from Google
        </a>
        {googleError && (
          <p className="mt-2 text-xs text-red-400">
            {GOOGLE_ERRORS[googleError] ?? "Google import didn’t complete — please try again."}
          </p>
        )}
      </div>

      {/* Grab from your phone — scan the QR; the token already carries the toggle. */}
      {qr && (
        <div className="rounded-xl border border-white/10 bg-[#0d1e2b]/50 p-4">
          <h2 className="text-sm font-semibold text-white">Grab contacts from your phone</h2>
          <p className="mt-1 text-xs text-gray-500">
            Scan with an Android phone to pick contacts straight from your address book. (iPhone
            can’t share contacts to the web — use Google above.)
          </p>
          <div className="mt-3 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr}
              alt="QR code to import contacts from your phone"
              width={132}
              height={132}
              className="rounded-lg bg-white p-2"
            />
            <p className="text-xs text-gray-400">
              {workOnly
                ? "This code imports work emails only."
                : "This code imports all contacts you pick."}{" "}
              The link expires in a few minutes.
            </p>
          </div>
        </div>
      )}

      <div className="text-center text-xs uppercase tracking-wide text-gray-600">or paste a CSV</div>

      <label className="flex flex-col gap-1 text-sm text-gray-400">
        List name
        <input
          value={listName}
          onChange={(e) => setListName(e.target.value)}
          placeholder="e.g. buyers"
          className="rounded-lg border border-white/10 bg-[#0d1e2b] px-3 py-2 text-white outline-none focus:border-[#00d4aa]/40"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-400">
        Contacts CSV
        <span className="text-xs text-gray-500">Header row required: email, name, tags</span>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={SAMPLE}
          rows={8}
          className="rounded-lg border border-white/10 bg-[#0d1e2b] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#00d4aa]/40"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer text-xs text-[#00d4aa] underline underline-offset-2">
          Choose a .csv or .vcf file
          <input
            type="file"
            accept=".csv,text/csv,.vcf,text/vcard"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </label>
        {fileLabel && <span className="text-xs text-gray-400">{fileLabel}</span>}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {result && !synced && (
        <p className="text-xs text-gray-400">
          {result.inserted} added, {result.updated} updated, {result.skipped} skipped.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="rounded-full bg-[#00d4aa] px-5 py-2 text-sm font-semibold text-[#04121b] disabled:opacity-40"
        >
          {busy ? "Uploading…" : "Upload + create list"}
        </button>
        <Link
          href={backHref}
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-gray-300 hover:text-white"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
