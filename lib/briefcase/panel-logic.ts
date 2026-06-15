/**
 * A-5 panel logic — pure decisions the BriefcasePanel renders on. No React, no DOM.
 */

export type PanelState = "pitch" | "draft";

/** Empty draft → the pitch + example cards; anything filed → the draft + build path. */
export function panelState(draftCount: number): PanelState {
  return draftCount > 0 ? "draft" : "pitch";
}

export type BuildGate = "login" | "build";

/**
 * Create-gate: a logged-out "Build" opens the login wall and MUST NOT POST the build
 * API. Returns "build" ONLY when authed. (Builds are free — the wall is the auth
 * sign-up, not a paywall; the only paywall is branded SEND, a Tier-2 follow-on.)
 */
export function resolveBuildAction(authed: boolean): BuildGate {
  return authed ? "build" : "login";
}
