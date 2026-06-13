import { createServiceRoleClient } from "../../utils/supabase/service-role";
import { clientIdFromRequest } from "../highlighter/meter";

function ipFrom(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip");
}

/**
 * Insert-only telemetry for the welcome chat. Zero enforcement — Phase 3 reads
 * welcome_chat_usage to tune the gate. Never throws (must not break the stream).
 */
export async function recordWelcomeChat(request: Request, turnCount: number): Promise<void> {
  try {
    const db = createServiceRoleClient();
    await db.from("welcome_chat_usage").insert({
      cid: clientIdFromRequest(request),
      ip: ipFrom(request),
      turn_count: turnCount,
    });
  } catch {
    // telemetry must never break the chat
  }
}
