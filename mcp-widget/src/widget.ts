/**
 * SWFL Data Gulf — interactive tool (MCP App "View").
 *
 * Renders inside the Claude conversation as a sandboxed iframe below the
 * assistant message (MCP Apps, spec 2026-01-26). It is the ONLY surface in
 * claude.ai that can show our logo + a chart + branded layout — the plain text
 * reply can't render images or inline UI.
 *
 * Data path (verified against @modelcontextprotocol/ext-apps app.d.ts):
 *   1. host calls swfl_fetch on our server
 *   2. server returns a tool result whose `structuredContent` carries the
 *      WidgetView (see app/api/mcp/widget-view.mts)
 *   3. host forwards it to this View via the `ui/notifications/tool-result`
 *      notification — we read `params.structuredContent`
 *
 * Handlers are registered BEFORE connect() so the one-shot tool-result
 * notification is never missed (app.d.ts ONE_SHOT_EVENTS race guard).
 *
 * Self-contained: bundled to a single inline <script> (no external CDN — the
 * host sandbox CSP blocks remote loads). Build: mcp-widget/build.mts.
 */
import { App } from "@modelcontextprotocol/ext-apps";

/** Shape the server packs into the tool result's `structuredContent`. */
interface WidgetMetric {
  label: string;
  value: string; // pre-formatted by the server (e.g. "$9,028,029", "4.90%")
  direction?: "rising" | "falling" | "stable";
  /** 0..1 share of the largest metric — drives the bar width. */
  bar?: number;
  /** "ours" => our computed data, gets the logo. "web" => highlight + link. */
  provenance: "ours" | "web";
  source_url?: string;
  source_name?: string;
}

interface WidgetSpeculation {
  condition: string;
  then: string;
  falsifier: string;
}

interface WidgetView {
  title: string;
  freshness_token: string;
  answer: string;
  metrics: WidgetMetric[];
  speculation?: WidgetSpeculation | null;
  report_url?: string;
  /** Web-sourced current-event facts (City Pulse / LLM layer) → highlighted links. */
  web_facts?: Array<{ text: string; source_url: string; source_name?: string }>;
}

const TEAL = "#0a8078";

/** The three-wave SWFL mark, inline so it renders with no network. */
function logoSvg(size = 18): string {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-label="SWFL Data Gulf" style="vertical-align:-3px;flex:0 0 auto">
    <g fill="none" stroke="${TEAL}" stroke-width="6" stroke-linecap="round">
      <path d="M10 20 q11 -10 22 0 t22 0"/>
      <path d="M10 33 q11 -10 22 0 t22 0" opacity="0.85"/>
      <path d="M10 46 q11 -10 22 0 t22 0" opacity="0.6"/>
    </g>
  </svg>`;
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function arrow(dir?: string): string {
  if (dir === "rising") return `<span style="color:${TEAL}">▲</span>`;
  if (dir === "falling") return `<span style="color:#ff7a7a">▼</span>`;
  return `<span style="color:#7a8a93">●</span>`;
}

function renderMetricsTable(metrics: WidgetMetric[]): string {
  if (!metrics.length) return "";
  const rows = metrics
    .map((m) => {
      const mark =
        m.provenance === "ours"
          ? `<span title="SWFL Data Gulf — our data">${logoSvg(14)}</span>`
          : m.source_url
            ? `<a href="${esc(m.source_url)}" target="_blank" rel="noopener" style="color:${TEAL};text-decoration:underline;text-underline-offset:2px">${esc(m.source_name || "source")}</a>`
            : "";
      const barPct = Math.max(2, Math.round((m.bar ?? 0) * 100));
      const bar =
        m.bar != null
          ? `<div style="height:6px;border-radius:3px;background:rgba(0,212,170,.18);margin-top:4px">
               <div style="height:6px;width:${barPct}%;border-radius:3px;background:${TEAL}"></div>
             </div>`
          : "";
      return `<tr>
        <td style="padding:7px 8px;vertical-align:top">
          <div style="display:flex;gap:6px;align-items:center;color:#cdd8de;font-size:12.5px">${mark}<span>${esc(m.label)}</span></div>
          ${bar}
        </td>
        <td style="padding:7px 8px;text-align:right;white-space:nowrap;font-weight:600;color:#eaf3f5;font-size:13px">${esc(m.value)} ${arrow(m.direction)}</td>
      </tr>`;
    })
    .join("");
  return `<table style="width:100%;border-collapse:collapse;margin-top:6px">${rows}</table>`;
}

function renderWebFacts(facts?: WidgetView["web_facts"]): string {
  if (!facts || !facts.length) return "";
  const items = facts
    .slice(0, 6)
    .map(
      (f) =>
        `<li style="margin:4px 0;color:#cdd8de;font-size:12.5px;line-height:1.45">
          <a href="${esc(f.source_url)}" target="_blank" rel="noopener" style="color:${TEAL};text-decoration:underline;text-underline-offset:2px">${esc(f.text)}</a>
        </li>`,
    )
    .join("");
  return `<div style="margin-top:14px">
    <div style="${sectionLabel}">From the web</div>
    <ul style="margin:4px 0 0;padding-left:16px">${items}</ul>
  </div>`;
}

const sectionLabel =
  "text-transform:uppercase;letter-spacing:.08em;font-size:10.5px;color:#7a8a93;font-weight:700;margin-bottom:2px";

function render(view: WidgetView): void {
  const spec = view.speculation
    ? `<div style="margin-top:14px">
         <div style="${sectionLabel}">Speculation <span style="color:#5a6b73;font-weight:500">[inference]</span></div>
         <div style="color:#cdd8de;font-size:12.5px;line-height:1.5;margin-top:2px">
           <b style="color:#eaf3f5">If</b> ${esc(view.speculation.condition)} → ${esc(view.speculation.then)}.
           <span style="color:#8a99a0"><b>Falsifier:</b> ${esc(view.speculation.falsifier)}</span>
         </div>
       </div>`
    : "";

  const link = view.report_url
    ? `<a href="${esc(view.report_url)}" target="_blank" rel="noopener" style="color:${TEAL};text-decoration:none;font-size:12.5px;font-weight:600">Full report →</a>`
    : "";

  document.body.innerHTML = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b1620;color:#eaf3f5;border:1px solid rgba(0,212,170,.22);border-radius:14px;padding:16px 18px;max-width:680px">
      <div style="display:flex;align-items:center;gap:9px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:10px;margin-bottom:12px">
        ${logoSvg(22)}
        <span style="font-weight:700;font-size:14px;letter-spacing:.01em">${esc(view.title || "SWFL Data Gulf")}</span>
      </div>

      <div style="${sectionLabel}">Answer</div>
      <div style="color:#dce7ea;font-size:13px;line-height:1.55;margin-top:2px">${esc(view.answer)}</div>

      <div style="margin-top:14px">
        <div style="${sectionLabel}">Data ${logoSvg(12)} <span style="color:#5a6b73;font-weight:500">= our data</span></div>
        ${renderMetricsTable(view.metrics || [])}
      </div>

      ${spec}
      ${renderWebFacts(view.web_facts)}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px">
        ${link}
        <span style="color:#5a6b73;font-size:11px;font-family:ui-monospace,monospace">${esc(view.freshness_token)}</span>
      </div>
    </div>`;
}

function renderError(msg: string): void {
  document.body.innerHTML = `<div style="font-family:-apple-system,sans-serif;background:#0b1620;color:#9fb0b7;border-radius:12px;padding:16px;font-size:12.5px">${logoSvg(16)} Loading the SWFL read… <span style="color:#5a6b73">(${esc(msg)})</span></div>`;
}

async function main(): Promise<void> {
  renderError("waiting for data");
  const app = new App({ name: "swfl-fetch-view", version: "1.0.0" }, {});

  // Register BEFORE connect() so the one-shot tool-result notification is not missed.
  app.addEventListener("toolresult", (params) => {
    try {
      const sc = params.structuredContent as unknown as WidgetView | undefined;
      if (sc && typeof sc === "object" && "answer" in sc) {
        render(sc);
        return;
      }
      // Fallback: nothing structured arrived — keep the holding state.
      renderError("no structured view in tool result");
    } catch (e) {
      renderError((e as Error).message);
    }
  });

  await app.connect();
}

main().catch((e) => renderError((e as Error).message));
