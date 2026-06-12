// scripts/email/build-digest.mts
import { render } from "@react-email/render";
import { Resend } from "resend";
import type { DigestPayload, EmailLog, MetricDelta, ZipMetricSnapshot } from "./types.ts";
import { ZIP_FOCUS } from "./types.ts";
import { fetchDigestData } from "./fetch-digest-data.mts";
import { readMostRecentLog, writeLog, isTodayAlreadySent, getNextIssueNumber } from "./log-io.mts";
import { DigestEmail } from "./DigestEmail.tsx";

// Threshold constants — sourced in EMAIL.md SOURCED THRESHOLDS
const ZIP_PRICE_THRESHOLD = 0.05;
const ZIP_PRICE_FLOOR = 10;
const COUNTY_PRICE_THRESHOLD = 0.03;
const COUNTY_PRICE_FLOOR = 50;
const DOM_DELTA_DAYS = 10;
const INVENTORY_MOM_THRESHOLD = 0.2;

const DRY_RUN = process.env.DRY_RUN === "true";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
const SENDER_NAME = process.env.DIGEST_SENDER_NAME ?? "[PLACEHOLDER — set DIGEST_SENDER_NAME]";
const SENDER_ADDRESS =
  process.env.DIGEST_SENDER_ADDRESS ?? "[PLACEHOLDER — set DIGEST_SENDER_ADDRESS]";
const SENDER_CONTACT =
  process.env.DIGEST_SENDER_CONTACT ?? "[PLACEHOLDER — set DIGEST_SENDER_CONTACT]";

// ── Delta (EMAIL.md Rule 5) ────────────────────────────────────────────────

export function computeDelta(
  current: ZipMetricSnapshot,
  previous: ZipMetricSnapshot | null,
  grain: "zip" | "county",
): MetricDelta[] {
  if (!previous) return [];
  const results: MetricDelta[] = [];
  const priceThreshold = grain === "zip" ? ZIP_PRICE_THRESHOLD : COUNTY_PRICE_THRESHOLD;
  const priceFloor = grain === "zip" ? ZIP_PRICE_FLOOR : COUNTY_PRICE_FLOOR;

  // Median sale price
  if (
    current.median_sale_price !== null &&
    previous.median_sale_price !== null &&
    previous.median_sale_price !== 0
  ) {
    const pct =
      (current.median_sale_price - previous.median_sale_price) / previous.median_sale_price;
    const floorMet = (current.sale_count_period ?? 0) >= priceFloor;
    results.push({
      metric: "median_sale_price",
      current: current.median_sale_price,
      previous: previous.median_sale_price,
      pct_change: pct,
      is_escalation: Math.abs(pct) > priceThreshold && floorMet,
      direction_framing: pct > 0 ? "bullish" : "bearish",
    });
  }

  // DOM (absolute days, not %)
  if (current.dom !== null && previous.dom !== null) {
    const changeDays = current.dom - previous.dom;
    results.push({
      metric: "dom",
      current: current.dom,
      previous: previous.dom,
      pct_change: previous.dom !== 0 ? changeDays / previous.dom : 0,
      is_escalation: Math.abs(changeDays) > DOM_DELTA_DAYS,
      direction_framing: changeDays > 0 ? "bearish" : "bullish",
    });
  }

  // Inventory MoM
  if (current.inventory !== null && previous.inventory !== null && previous.inventory !== 0) {
    const pct = (current.inventory - previous.inventory) / previous.inventory;
    results.push({
      metric: "inventory",
      current: current.inventory,
      previous: previous.inventory,
      pct_change: pct,
      is_escalation: Math.abs(pct) > INVENTORY_MOM_THRESHOLD,
      direction_framing: "context",
    });
  }

  return results;
}

// ── Subject line (EMAIL.md Rule 11) ───────────────────────────────────────

const SPAM_TRIGGERS =
  /\b(free|guarantee|winner|urgent|act now|limited time|exclusive offer|click here|buy now|no cost|risk.free)\b/i;

const BRAND = "SWFL Data Gulf";

/**
 * The data lede — the subject when no city-pulse signal qualifies for the
 * subject (Rule 2.5 allowlist). Always reads the focus ZIP's OWN values, so it
 * never mislabels another ZIP's move. e.g. "33908 DOM hits 87".
 */
function dataLede(payload: DigestPayload, escalations: MetricDelta[]): string {
  const m = payload.zip_metrics["33908"];
  if (!m) {
    const cm = payload.county_metrics?.median_sale_price;
    return cm != null ? `Lee County median $${Math.round(cm / 1000)}k` : "Lee County market pulse";
  }
  const priceMoved = escalations.some((d) => d.metric === "median_sale_price" && d.is_escalation);
  if (priceMoved && m.median_sale_price != null) {
    return `33908 median $${Math.round(m.median_sale_price / 1000)}k`;
  }
  if (m.dom != null) return `33908 DOM hits ${Math.round(m.dom)}`;
  if (m.median_sale_price != null)
    return `33908 median $${Math.round(m.median_sale_price / 1000)}k`;
  return "Lee County market pulse";
}

/** "{lede} | SWFL Data Gulf", truncating the lede so the whole stays ≤50 chars. */
function withBrand(lede: string): string {
  const suffix = ` | ${BRAND}`;
  const max = 50 - suffix.length;
  const head = lede.length > max ? lede.slice(0, max - 1).trimEnd() + "…" : lede;
  return head + suffix;
}

export function buildSubjectLine(payload: DigestPayload, escalations: MetricDelta[]): string {
  // top_story only ever carries a subject-eligible topic (Rule 2.5 allowlist,
  // gated upstream in selectCityVoices), so any top_story here is safe to lead.
  const ts = payload.top_story;
  let s: string;
  if (ts) {
    const prefix = "[SWFL] ";
    const max = 50 - prefix.length;
    s = prefix + (ts.title.length > max ? ts.title.slice(0, max - 1).trimEnd() + "…" : ts.title);
  } else {
    s = withBrand(dataLede(payload, escalations));
  }
  return s.replace(SPAM_TRIGGERS, "").trim().slice(0, 50);
}

// ── Delta narrative ────────────────────────────────────────────────────────

function buildDeltaText(current: DigestPayload, prevLog: EmailLog | null): string {
  if (!prevLog) return "First issue — no prior data to compare.";
  const gap = Math.round(
    (new Date(current.date).getTime() - new Date(prevLog.last_send_date).getTime()) / 86400000,
  );
  const lines = [`Since ${prevLog.last_send_date} (${gap} day${gap !== 1 ? "s" : ""} ago):`];
  for (const zip of ZIP_FOCUS) {
    const curr = current.zip_metrics[zip],
      prev = prevLog.zip_metrics[zip];
    if (!curr || !prev) continue;
    for (const d of computeDelta(curr, prev, "zip").filter((d) => d.is_escalation)) {
      const arrow =
        d.direction_framing === "bullish" ? "↑" : d.direction_framing === "bearish" ? "↓" : "→";
      if (d.metric === "median_sale_price") {
        lines.push(
          `  ${arrow} ${zip} price ${d.pct_change > 0 ? "up" : "down"} ${Math.abs(d.pct_change * 100).toFixed(1)}% (${d.direction_framing})`,
        );
      } else if (d.metric === "dom") {
        lines.push(
          `  ${arrow} ${zip} DOM ${d.pct_change > 0 ? "up" : "down"} ${Math.abs(d.current - d.previous).toFixed(0)}d (${d.direction_framing})`,
        );
      } else if (d.metric === "inventory") {
        lines.push(
          `  ${arrow} ${zip} inventory ${d.pct_change > 0 ? "up" : "down"} ${Math.abs(d.pct_change * 100).toFixed(0)}% (context)`,
        );
      }
    }
  }
  const newSigs = current.city_voices.filter((s) => !prevLog.signals_surfaced.includes(s.title));
  if (newSigs.length)
    lines.push(`  + ${newSigs.length} new city voice signal${newSigs.length > 1 ? "s" : ""}`);
  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // Idempotency guard (EMAIL.md Rule 8)
  if (isTodayAlreadySent(today)) {
    console.log("[DIGEST ABORT] today's log already shows send_status=sent; skipping.");
    process.exit(0);
  }

  const prevLog = readMostRecentLog();
  const issue = getNextIssueNumber();
  const payload = await fetchDigestData();

  const allDeltas: MetricDelta[] = [];
  for (const zip of ZIP_FOCUS) {
    const curr = payload.zip_metrics[zip],
      prev = prevLog?.zip_metrics[zip] ?? null;
    if (curr) allDeltas.push(...computeDelta(curr, prev, "zip"));
  }
  const escalations = allDeltas.filter((d) => d.is_escalation);

  const subject = buildSubjectLine(payload, escalations);
  const deltaText = buildDeltaText(payload, prevLog);
  const unsubscribeUrl = `${SITE_URL}/unsubscribe?token=phase1-static`;

  // No `theme` passed → SWFL house colors (resolveTheme defaults). The agent
  // white-label digest (README Phase 4) and the funnel's prospect-branded send
  // (funnel spec Phase 2) inject a BrandTheme here — no other change needed.
  const html = await render(
    DigestEmail({
      payload,
      escalations,
      deltaText,
      subject,
      unsubscribeUrl,
      issue,
      senderName: SENDER_NAME,
      senderAddress: SENDER_ADDRESS,
      senderContact: SENDER_CONTACT,
    }),
  );

  // Write log BEFORE send — error log allows re-run; avoids double-send on crash
  const log: EmailLog = {
    date: today,
    last_send_date: today,
    issue,
    subject,
    freshness_manifest: payload.freshness_manifest,
    top_story: payload.top_story,
    zip_metrics: payload.zip_metrics,
    county_metrics: payload.county_metrics,
    signals_surfaced: payload.city_voices.map((s) => s.title),
    cta_url: "https://swfldatagulf.com/r/housing-swfl",
    send_status: "error",
    send_error: null,
    recipients: 0,
  };
  writeLog(log);

  if (DRY_RUN) {
    console.log(`[DRY RUN] Subject: ${subject}`);
    console.log(`[DRY RUN] HTML: ${html.length} bytes`);
    console.log(`[DRY RUN] Escalations: ${escalations.length}`);
    log.send_status = "skipped";
    writeLog(log);
    process.exit(0);
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: "SWFL Data Gulf <hello@swfldatagulf.com>",
      to: ["hello@swfldatagulf.com"],
      subject,
      html,
      headers: {
        // RFC 8058 — Gmail/Yahoo bulk-sender requirement (Feb 2024)
        "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:unsubscribe@swfldatagulf.com?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    log.send_status = "sent";
    log.recipients = 1;
    console.log(`[DIGEST] Issue #${issue} sent · Resend ID: ${result.data?.id}`);
  } catch (err) {
    log.send_error = String(err);
    console.error("[DIGEST ERROR]", err);
  }
  writeLog(log);
}

main().catch((err) => {
  console.error("[DIGEST FATAL]", err);
  process.exit(1);
});
