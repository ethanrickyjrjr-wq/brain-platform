"use client";

import { useEffect, useState } from "react";

export type Session = { authed: boolean; userId?: string };

/**
 * Pure, injectable fetch of the client-readable auth signal (`GET /api/me`).
 *
 * Defensive by design: any failure (network, non-OK status, malformed JSON)
 * degrades to logged-out instead of throwing, so a flaky `/api/me` can never
 * crash the global pill. `fetchImpl` is injected so this is unit-testable
 * without a DOM (this repo tests pure functions, not React renders).
 */
export async function fetchSession(fetchImpl: typeof fetch = fetch): Promise<Session> {
  try {
    const res = await fetchImpl("/api/me", { cache: "no-store" });
    if (!res.ok) return { authed: false };
    const json = (await res.json()) as Session;
    return json?.authed ? { authed: true, userId: json.userId } : { authed: false };
  } catch {
    return { authed: false };
  }
}

// Module-level memo so every useSession() consumer shares ONE /api/me request
// per page load instead of each mount firing its own.
let sessionPromise: Promise<Session> | null = null;

function getSession(): Promise<Session> {
  if (!sessionPromise) sessionPromise = fetchSession();
  return sessionPromise;
}

/** Drop the shared cache so the next useSession() re-reads (e.g. after login). */
export function clearSessionCache(): void {
  sessionPromise = null;
}

/**
 * Client hook exposing the auth signal to components. Returns `null` while the
 * first read is in flight, then `{ authed, userId? }`. The underlying fetch is
 * shared + cached across all consumers via the module-level memo.
 */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let alive = true;
    // setState happens in an async resolution, NOT synchronously in the effect
    // body — so it does not trip react-hooks/set-state-in-effect.
    getSession().then((s) => {
      if (alive) setSession(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  return session;
}
