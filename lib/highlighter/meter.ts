import { createServiceRoleClient } from "../../utils/supabase/service-role";

export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function capEnabled(): boolean {
  return Boolean(process.env.HIGHLIGHTER_FREE_WEEKLY_CAP);
}

/** Anonymous client id from a signed cookie; falls back to "anon". */
function clientIdFrom(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const m = cookie.match(/sdg_cid=([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? "anon";
}

export async function recordUse(
  request: Request,
  meta: { report_id: string; reach: string[] },
): Promise<number> {
  try {
    const db = createServiceRoleClient();
    const week = isoWeek(new Date());
    await db.from("usage_events").insert({
      client_id: clientIdFrom(request),
      iso_week: week,
      report_id: meta.report_id,
      reach: meta.reach,
    });
    return 1;
  } catch {
    return 0; // metering must never break an answer
  }
}

/**
 * Log an ask to `data_requests`.
 * Runs fire-and-forget alongside the existing `recordUse()` meter — must never
 * throw (errors are swallowed so they don't break a streaming answer).
 *
 * `answered` should be false when the AI response signals it couldn't answer
 * from the payload (data-gap detection at the call site).
 */
export async function recordAsk(meta: {
  report_id: string;
  fact?: string;
  question: string;
  reach: string[];
  answered: boolean;
}): Promise<void> {
  try {
    const db = createServiceRoleClient();
    await db.from("data_requests").insert({
      report_id: meta.report_id,
      fact: meta.fact ?? null,
      question: meta.question,
      reach: meta.reach,
      answered: meta.answered,
    });
  } catch {
    // metering must never break an answer
  }
}

export async function weeklyCount(clientId: string): Promise<number> {
  try {
    const db = createServiceRoleClient();
    const { count } = await db
      .from("usage_events")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("iso_week", isoWeek(new Date()));
    return count ?? 0;
  } catch {
    return 0;
  }
}
