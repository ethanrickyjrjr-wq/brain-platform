import Link from "next/link";
import type { ProjectItem } from "@/lib/project/items";
import { ChartBlockView } from "@/components/charts/ChartBlockView";
import { asOfFromToken } from "@/lib/project/as-of";
import { cleanCitation } from "@/lib/citations/clean-url";
import type { SavedChart } from "./types";

/** A plain "as of {date}" citation line — the only v1 freshness surface (no badge). */
export function AsOf({ token }: { token: string | null | undefined }) {
  const date = asOfFromToken(token);
  if (!date) return null;
  return <p className="mt-1 text-[11px] font-mono text-gray-500">as of {date}</p>;
}

/**
 * The full per-kind render of a single filed item — the expanded body inside an
 * `ItemCard`. Extracted verbatim from the monolith's `renderItem` (every kind
 * renders identically). Cross-build contract: P4 swaps edit controls in around
 * this; the render stays here.
 */
export function ItemDetail({
  item,
  charts,
  fileUrls,
  localPreviews,
}: {
  item: ProjectItem;
  charts: Record<string, SavedChart>;
  fileUrls: Record<string, string>;
  localPreviews: Record<string, string>;
}) {
  switch (item.kind) {
    case "chart": {
      const saved = charts[item.chart_id];
      if (!saved) return <p className="text-sm text-gray-400">{item.title} (chart unavailable)</p>;
      return (
        <div className="overflow-hidden rounded-lg">
          <ChartBlockView
            block={saved.block}
            asOf={asOfFromToken(saved.freshness_token) ?? undefined}
          />
        </div>
      );
    }
    case "metric":
      return (
        <div>
          <p className="text-sm text-gray-300">{item.label}</p>
          <p className="text-lg font-semibold text-white">{item.value}</p>
          {(item.source_url || item.source_label) &&
            (() => {
              // Shared root: internal/supabase/api never render as a link.
              const c = cleanCitation({ url: item.source_url, label: item.source_label });
              return c.linkable && c.href ? (
                <a
                  href={c.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#00d4aa] underline underline-offset-2"
                >
                  {c.label}
                </a>
              ) : (
                <span className="text-xs text-gray-500" title={c.label}>
                  {c.label}
                </span>
              );
            })()}
          <AsOf token={item.freshness_token} />
        </div>
      );
    case "qa":
      return (
        <div>
          <p className="text-sm font-medium text-white">{item.question}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">{item.answer}</p>
          <AsOf token={item.freshness_token} />
        </div>
      );
    case "report":
      return (
        <Link
          href={`/r/${item.slug}`}
          className="text-sm text-[#00d4aa] underline underline-offset-2"
        >
          {item.title || item.slug}
        </Link>
      );
    case "source":
      return (
        <a href={item.url} className="text-sm text-[#00d4aa] underline underline-offset-2">
          {item.label}
        </a>
      );
    case "note":
      return <p className="whitespace-pre-wrap text-sm text-gray-300">{item.text}</p>;
    case "frame":
      return <p className="text-sm text-gray-300">{item.title}</p>;
    case "table_slice":
      return (
        <div>
          <p className="mb-2 text-sm font-medium text-white">{item.title}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-300">
              <thead>
                <tr>
                  {item.columns.map((c) => (
                    <th
                      key={c}
                      className="border-b border-white/10 px-2 py-1 font-medium text-gray-400"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {item.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border-b border-white/5 px-2 py-1">
                        {cell ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AsOf token={item.freshness_token} />
        </div>
      );
    case "file": {
      // Server signed URL (re-signed each page load) ?? this-session object-URL preview.
      const url = fileUrls[item.storage_path] ?? localPreviews[item.id];
      const isImage = item.mime.startsWith("image/");
      if (isImage) {
        return (
          <figure>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={item.caption || "Uploaded image"}
                className="max-w-full rounded-lg"
              />
            ) : (
              <p className="text-sm text-gray-500 italic">Image unavailable</p>
            )}
            {item.caption && (
              <figcaption className="mt-2 text-sm text-gray-300">{item.caption}</figcaption>
            )}
            <p className="mt-1 text-[11px] text-gray-500">Provided by agent</p>
          </figure>
        );
      }
      // PDF (or any non-image) → appendix link.
      return (
        <div>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#00d4aa] underline underline-offset-2"
            >
              {item.caption || "View attachment (PDF)"}
            </a>
          ) : (
            <p className="text-sm text-gray-500 italic">
              {item.caption || "Attachment"} (unavailable)
            </p>
          )}
          <p className="mt-1 text-[11px] text-gray-500">Provided by agent</p>
        </div>
      );
    }
  }
}
