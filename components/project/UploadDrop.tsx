"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import type { ProjectItem } from "@/lib/project/items";
import { UPLOADS_BUCKET } from "@/lib/project/signed-upload-url";

/** A filed file item plus a local object-URL preview for instant in-session render. */
type FileItem = Extract<ProjectItem, { kind: "file" }>;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MiB — mirrors the bucket file_size_limit
const MAX_FILES = 10; // per project

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function isHeic(file: File): boolean {
  return file.type === "image/heic" || file.type === "image/heif" || /\.hei[cf]$/i.test(file.name);
}

interface Props {
  projectId: string;
  /** Current count of `{kind:"file"}` items — gates the 10/project limit. */
  fileCount: number;
  /** Called after a successful upload + filing; parent appends + persists. */
  onUploaded: (item: FileItem, objectUrl: string) => void;
}

export function UploadDrop({ projectId, fileCount, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  async function handleFile(file: File) {
    setError(null);

    // ---- Client-side limits (fail fast; the bucket is the real gate) ----------
    if (fileCount >= MAX_FILES) {
      setError(`Limit reached — ${MAX_FILES} files per project.`);
      return;
    }
    if (isHeic(file)) {
      setError("HEIC isn't supported — convert to JPG or PNG first, then upload.");
      return;
    }
    if (!ALLOWED_MIME.has(file.type)) {
      setError("Only JPG, PNG, WebP, or PDF files are allowed.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File is over 10 MB. Compress or resize it first.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setNeedsLogin(true);
        return;
      }

      const ext = EXT_BY_MIME[file.type] ?? "bin";
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;

      // Upload under the user's JWT → Storage RLS scopes it to their uid prefix.
      const { error: upErr } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`);
        return;
      }

      const item: FileItem = {
        id: crypto.randomUUID(),
        added_at: new Date().toISOString(),
        origin: "web",
        kind: "file",
        storage_path: path,
        mime: file.type,
        size: file.size,
        ...(caption.trim() ? { caption: caption.trim() } : {}),
      };

      onUploaded(item, URL.createObjectURL(file));
      setCaption("");

      // Best-effort meter — never block the UI on it.
      void fetch("/api/meter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "upload", report_id: projectId }),
      }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = ""; // allow re-picking the same file
    }
  }

  if (needsLogin) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0d1e2b]/50 p-4 text-sm text-gray-300">
        Sign in to attach files.{" "}
        <Link
          href={`/login?next=/project/${projectId}`}
          className="text-[#0a8078] underline underline-offset-2"
        >
          Log in
        </Link>
      </div>
    );
  }

  const atLimit = fileCount >= MAX_FILES;

  return (
    <section className="rounded-xl border border-dashed border-white/15 bg-[#0d1e2b]/50 p-4">
      <h2 className="text-sm font-semibold text-white">Attach a file</h2>
      <p className="mt-1 text-xs text-gray-500">
        Images (JPG/PNG/WebP) or PDF · 10 MB max · {fileCount}/{MAX_FILES} used
      </p>

      <input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Caption (optional)"
        className="mt-3 w-full rounded-lg border border-white/10 bg-[#0d1e2b] px-3 py-2 text-sm text-white outline-none focus:border-[#0a8078]/40"
      />

      <div className="mt-3 flex items-center gap-3">
        <label
          className={
            "cursor-pointer rounded-full px-4 py-2 text-sm font-medium " +
            (busy || atLimit
              ? "cursor-not-allowed bg-white/10 text-gray-500"
              : "bg-[#0a8078] text-[#04121b]")
          }
        >
          {busy ? "Uploading…" : "Choose image or PDF"}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={busy || atLimit}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </label>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
