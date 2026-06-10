"use client";

import { useState, useCallback } from "react";

interface Props {
  id: string;
  title: string;
  execSummary: string;
  agentName?: string;
}

async function meter(action: "deliver_email" | "deliver_share") {
  await fetch("/api/meter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  }).catch(() => {});
}

export function DeliveryButtons({ id, title, execSummary, agentName }: Props) {
  const [copied, setCopied] = useState(false);

  // Build full URL in handlers only (window safe — these only fire in browser).
  const pageUrl = `/p/${id}`;

  const getFullUrl = () =>
    typeof window !== "undefined" ? `${window.location.origin}${pageUrl}` : pageUrl;

  // Full body for clipboard — no length restriction.
  const buildEmailBody = () => {
    const url = getFullUrl();
    const sig = agentName ? `\n\n— ${agentName}` : "";
    return `${title}\n\n${execSummary}\n\nFull report: ${url}${sig}`;
  };

  // Short body for mailto — mobile clients truncate at ~2 KB.
  const buildMailto = () => {
    const url = getFullUrl();
    const lead = execSummary.length > 160 ? execSummary.slice(0, 157) + "…" : execSummary;
    const body = `${lead}\n\nFull report: ${url}`;
    return `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  };

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildEmailBody());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked (non-HTTPS / denied) — silent fail; user can still use Share.
    }
    await meter("deliver_email");
  }, [id, title, execSummary, agentName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleShare = useCallback(async () => {
    const url = getFullUrl();
    const text = execSummary.length > 200 ? execSummary.slice(0, 197) + "…" : execSummary;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        // User cancelled — don't meter.
        return;
      }
    } else {
      // Desktop fallback: copy the link.
      await navigator.clipboard.writeText(url).catch(() => {});
    }
    await meter("deliver_share");
  }, [id, title, execSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-gray-300 hover:border-white/20 hover:text-white"
      >
        {copied ? "Copied!" : "Copy email"}
      </button>
      {/* mailto: subject + short lead + link — body truncated for mobile */}
      <a
        href={buildMailto()}
        onClick={() => void meter("deliver_email")}
        className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-gray-300 hover:border-white/20 hover:text-white"
      >
        Open in mail
      </a>
      <button
        type="button"
        onClick={handleShare}
        className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-gray-300 hover:border-white/20 hover:text-white"
      >
        Share
      </button>
    </div>
  );
}
