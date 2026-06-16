#!/usr/bin/env bun
/**
 * Generates style-gallery-preview.html — a visual showcase of all 6 email templates
 * rendered at 3 brand variants, with lightbox-enabled thumbnails.
 *
 * Usage: bun scripts/preview-style-gallery.mts
 * Output: style-gallery-preview.html (open in browser)
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Embed the real SWFL logo as a data URI so the preview works without network access
const SWFL_LOGO_DATA_URI = (() => {
  try {
    const b64 = readFileSync(join(import.meta.dirname, "..", "public", "logo-name.png")).toString(
      "base64",
    );
    return `data:image/png;base64,${b64}`;
  } catch {
    return "https://www.swfldatagulf.com/logo-name.png";
  }
})();

// ── Brand variants ──────────────────────────────────────────────────────────
const VARIANTS = [
  {
    id: "swfl",
    label: "SWFL Data Gulf",
    primary: "#0f1d24",
    accent: "#1BB8C9",
    logoUrl: SWFL_LOGO_DATA_URI,
    companyName: "SWFL Data Gulf",
    tagline: "Southwest Florida Intelligence",
    websiteUrl: "https://www.swfldatagulf.com",
  },
  {
    id: "purple",
    label: "Purple Brand (Light)",
    primary: "#ffffff",
    accent: "#7C3AED",
    logoUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='26'><rect width='120' height='26' rx='4' fill='%237C3AED'/><text x='10' y='18' font-family='Arial' font-size='12' font-weight='bold' fill='white'>AcmeCo</text></svg>",
    companyName: "AcmeCo Realty",
    tagline: "Precision Market Intelligence",
    websiteUrl: "https://acmeco.example.com",
  },
  {
    id: "slate",
    label: "Slate Brand",
    primary: "#1a1f2e",
    accent: "#F97316",
    logoUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='26'><rect width='120' height='26' rx='4' fill='%23F97316'/><text x='10' y='18' font-family='Arial' font-size='12' font-weight='bold' fill='white'>ProData</text></svg>",
    companyName: "ProData Analytics",
    tagline: "Data You Can Act On",
    websiteUrl: "https://prodata.example.com",
  },
] as const;

// ── Templates ────────────────────────────────────────────────────────────────
const TEMPLATES = [
  { slug: "hero", label: "Hero Metric", file: "email-hero.html" },
  { slug: "report", label: "Full Report", file: "email-report.html" },
  { slug: "hbar", label: "H-Bar Chart", file: "email-hbar.html" },
  { slug: "table", label: "Data Table", file: "email-table.html" },
  { slug: "compare", label: "Period Compare", file: "email-compare.html" },
  { slug: "ranked", label: "Ranked ZIPs", file: "email-ranked.html" },
] as const;

const TEMPLATE_DIR = join(import.meta.dirname, "..", "templates", "html", "email");

const _MAPBOX_TOKEN = process.env.MAPBOX_TOKEN ?? "";
const _MAPBOX_QS = _MAPBOX_TOKEN ? `?access_token=${_MAPBOX_TOKEN}` : "";
const MAP_OVERVIEW_URL = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-l-star+1BB8C9(-81.9548,26.4615),pin-s-city+5bc97a(-81.8724,26.6406),pin-s-city+5bc97a(-81.7948,26.142)/-81.88,26.42,9.2/536x220${_MAPBOX_QS}`;
const MAP_CORRIDOR_URL = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-s-car+1BB8C9(-81.8949,26.5887),pin-s-car+5bc97a(-81.8196,26.5673),pin-s-car+5bc97a(-81.8549,26.5355),pin-s-star+e08158(-81.8724,26.6406)/-81.87,26.6,11.8/536x200${_MAPBOX_QS}`;

async function fetchAsBase64(url: string): Promise<string> {
  if (!url) return "";
  try {
    const res = await fetch(url, {
      headers: { Referer: "https://www.swfldatagulf.com", Origin: "https://www.swfldatagulf.com" },
    });
    if (!res.ok) {
      console.warn(`Map fetch ${res.status} — map will be absent in gallery`);
      return "";
    }
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") ?? "image/png";
    return `data:${ct};base64,${Buffer.from(new Uint8Array(buf)).toString("base64")}`;
  } catch (e) {
    console.warn(`Map fetch error: ${e}`);
    return "";
  }
}

console.log("Fetching map images...");
const MAP_OVERVIEW_URI = await fetchAsBase64(MAP_OVERVIEW_URL);
const MAP_CORRIDOR_URI = await fetchAsBase64(MAP_CORRIDOR_URL);

// ── Token replacement ────────────────────────────────────────────────────────
function renderTokens(
  html: string,
  v: (typeof VARIANTS)[number],
  slug: string,
  ovUri: string,
  corrUri: string,
): string {
  const isPrint = v.id === "purple";
  const tokens: Record<string, string> = {
    PRIMARY: v.primary,
    ACCENT: v.accent,
    MANGROVE: isPrint ? "#166534" : "#5bc97a", // very dark green on white — visible
    CORAL: isPrint ? "#9a3412" : "#e08158", // very dark orange on white — visible
    TEXT_PRIMARY: isPrint ? "#0f172a" : "#f0ede6",
    TEXT_DIM: isPrint ? "#475569" : "#b8b4a8",
    BAR_TRACK: isPrint ? "#e2e8f0" : "rgba(255,255,255,0.10)",
    // Print: 6 fully distinct bar colors — all legible on white
    BAR_ACCENT2: isPrint ? "#0e7490" : "rgba(255,255,255,0.48)", // teal — clearly ≠ purple & green
    BAR_MID: isPrint ? "#4338ca" : "rgba(255,255,255,0.35)", // indigo — clearly ≠ teal & green
    BAR_LOW: isPrint ? "#374151" : "rgba(255,255,255,0.20)", // dark slate — clearly ≠ indigo
    BADGE_DIM: isPrint ? "#dde3ec" : "rgba(255,255,255,0.15)",
    SURFACE: "#ffffff",
    TEXT: "#111827",
    FONT_FAMILY: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    BORDER_RADIUS: "8px",
    COMPANY_NAME: v.companyName,
    LOGO_URL: v.logoUrl,
    TAGLINE: v.tagline,
    WEBSITE_URL: v.websiteUrl,
    CONTACT_EMAIL: `hello@${new URL(v.websiteUrl).hostname}`,
    CONTACT_PHONE: "(239) 555-5555",
    MAP_URL: slug === "hbar" ? corrUri : ovUri,
    DISCLAIMER:
      "You are receiving this because you subscribed to market intelligence from " +
      v.companyName +
      ". Unsubscribe · Update preferences",
  };
  let out = html;
  for (const [k, val] of Object.entries(tokens)) {
    out = out.replaceAll(`{{${k}}}`, val);
  }
  return out;
}

// ── Build rendered pairs ─────────────────────────────────────────────────────
type Rendered = {
  slug: string;
  label: string;
  variantId: string;
  variantLabel: string;
  html: string;
};
const rendered: Rendered[] = [];

for (const tmpl of TEMPLATES) {
  const src = readFileSync(join(TEMPLATE_DIR, tmpl.file), "utf-8");
  for (const v of VARIANTS) {
    rendered.push({
      slug: tmpl.slug,
      label: tmpl.label,
      variantId: v.id,
      variantLabel: v.label,
      html: renderTokens(src, v, tmpl.slug, MAP_OVERVIEW_URI, MAP_CORRIDOR_URI),
    });
  }
}

// ── Encode iframes as srcdoc ─────────────────────────────────────────────────
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ── Build the gallery page ────────────────────────────────────────────────────
const CARD_W = 360;
const CARD_H = 480;
const SCALE = 0.5; // iframe scale factor (thumbnail)
const THUMB_W = CARD_W;
const THUMB_H = CARD_H;
const IFRAME_W = Math.round(CARD_W / SCALE);
const IFRAME_H = Math.round(CARD_H / SCALE);

// Group by template for the grid sections
const byTemplate = new Map<string, Rendered[]>();
for (const r of rendered) {
  if (!byTemplate.has(r.slug)) byTemplate.set(r.slug, []);
  byTemplate.get(r.slug)!.push(r);
}

let sections = "";
for (const [_slug, items] of byTemplate.entries()) {
  const templateLabel = items[0].label;
  let cards = "";
  for (const item of items) {
    const id = `${item.slug}-${item.variantId}`;
    cards += `
      <div class="card" onclick="openLightbox('${id}')">
        <div class="thumb-wrap">
          <iframe
            id="thumb-${id}"
            srcdoc="${esc(item.html)}"
            width="${IFRAME_W}"
            height="${IFRAME_H}"
            scrolling="no"
            style="transform:scale(${SCALE});transform-origin:top left;pointer-events:none;border:0;"
          ></iframe>
        </div>
        <div class="card-meta">
          <span class="variant-dot" style="background:${items.find((i) => i.variantId === item.variantId)?.html.match(/background-color:([^;]+)/)?.[1] ?? "#0f1d24"}"></span>
          ${item.variantLabel}
        </div>
      </div>`;

    // Full-size lightbox iframe (hidden)
    cards += `
      <div id="lb-${id}" class="lightbox" onclick="closeLightbox(event)">
        <div class="lb-inner">
          <div class="lb-header">
            <strong>${templateLabel}</strong> &mdash; ${item.variantLabel}
            <button onclick="closeLightbox(event)" class="lb-close">&#10005;</button>
          </div>
          <div class="lb-body">
            <iframe
              srcdoc="${esc(item.html)}"
              width="600"
              height="800"
              scrolling="yes"
              style="border:0;width:600px;height:800px;"
            ></iframe>
          </div>
        </div>
      </div>`;
  }

  sections += `
    <section>
      <h2 class="section-label">${templateLabel}</h2>
      <div class="card-row">${cards}</div>
    </section>`;
}

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Email Style Gallery — SWFL Data Gulf</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0f1a; color: #f0ede6; font-family: 'Inter', system-ui, sans-serif; padding: 32px 24px 80px; }
  h1 { font-size: 22px; font-weight: 800; color: #f0ede6; margin-bottom: 6px; letter-spacing: -0.5px; }
  .subtitle { font-size: 13px; color: #8b8680; margin-bottom: 48px; }
  .section-label {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 2.5px;
    color: #1BB8C9; margin-bottom: 20px; padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  section { margin-bottom: 56px; }
  .card-row { display: flex; flex-wrap: wrap; gap: 20px; }
  .card {
    cursor: pointer; border-radius: 10px; overflow: hidden;
    border: 1px solid rgba(255,255,255,0.10);
    background: #131820;
    transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
    width: ${THUMB_W}px;
  }
  .card:hover {
    transform: translateY(-3px);
    border-color: rgba(27,184,201,0.50);
    box-shadow: 0 8px 32px rgba(27,184,201,0.15);
  }
  .thumb-wrap {
    width: ${THUMB_W}px;
    height: ${THUMB_H}px;
    overflow: hidden;
    position: relative;
  }
  .card-meta {
    padding: 10px 14px;
    font-size: 12px;
    color: #8b8680;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid rgba(255,255,255,0.07);
  }
  .variant-dot {
    width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
  }

  /* Lightbox */
  .lightbox {
    display: none;
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.85);
    z-index: 1000;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .lightbox.open { display: flex; }
  .lb-inner {
    background: #131820;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    overflow: hidden;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
  }
  .lb-header {
    padding: 14px 20px;
    font-size: 13px;
    font-weight: 600;
    color: #f0ede6;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    background: #0f1d24;
  }
  .lb-close {
    background: none; border: none; color: #8b8680; font-size: 16px;
    cursor: pointer; padding: 0 4px; line-height: 1;
  }
  .lb-close:hover { color: #f0ede6; }
  .lb-body { overflow: auto; }
</style>
</head>
<body>
<h1>Email Style Gallery</h1>
<p class="subtitle">6 templates &times; 3 brand variants &mdash; click any thumbnail to expand</p>

${sections}

<script>
function openLightbox(id) {
  document.getElementById('lb-' + id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLightbox(e) {
  if (e.target === e.currentTarget || e.currentTarget.classList.contains('lb-close')) {
    document.querySelectorAll('.lightbox').forEach(el => el.classList.remove('open'));
    document.body.style.overflow = '';
  }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.lightbox').forEach(el => el.classList.remove('open'));
    document.body.style.overflow = '';
  }
});
</script>
</body>
</html>`;

const outPath = join(import.meta.dirname, "..", "style-gallery-preview.html");
writeFileSync(outPath, page, "utf-8");
console.log(
  `✓ style-gallery-preview.html — ${rendered.length} previews (${TEMPLATES.length} templates × ${VARIANTS.length} variants)`,
);
