import type { ProjectDigest } from "./digest";
import type { Overlap } from "./cross-project-index";
import { asOfFromToken } from "./as-of";
import { promptsForPage, promptSetForVisits, createSuggestion } from "@/lib/briefcase/visits";

/**
 * The deterministic dynamic-prompt engine (Piece 2 §C1) — the free, instant baseline
 * that replaces the static-by-page prompts on a project page. Produces 3 situational
 * prompts + 1 standing action offer, ranked by signal strength, from the project digest,
 * cross-project overlap, and the day-one signals that exist before Piece 3's feed.
 *
 * Rank (plan C1): freshData > staleMetric > readyToSend > crossProject > whereLeftOff,
 * then fill from the static project floor (`promptsForPage({kind:"project"})`) so there
 * are always 3 — a project page never falls back to the generic home set.
 *
 * Pure + deterministic (same inputs → same output): the panel memoizes it on
 * `(projectId, rev, questionCount)` via `useMemo`, so it recomputes ONLY on project
 * switch or after a question — never per click (Piece 2 decision 4). No LLM here; the
 * optional LLM rephrase (`prompt-polish.ts`, gated) caches its result before this reads.
 */

/** Day-one signals (pre-Piece-3) the engine can phrase prompts from. */
export interface ProjectSignals {
  /** An email deliverable is seeded or an active schedule exists → "Ready to send?".
   *  Gated by the caller until the G1 authed action surface exists (don't offer a send
   *  the cockpit can't yet fire). */
  sendReady?: boolean;
}

/** A light per-project summary for the no-project (Outside / list) broad prompts. */
export interface NoProjectSummary {
  projectId: string;
  title: string;
  latestActivityAt?: string;
  freshnessChangedSinceSeen?: boolean;
}

export interface PromptEngineInput {
  /** The open project's digest, or null in no-project (Outside / list) mode. */
  digest: ProjectDigest | null;
  /** Cross-project overlap for the open project (reuse / gap). */
  overlap?: Overlap;
  signals?: ProjectSignals;
  /** Anonymous revisit count — tunes the no-project floor length. */
  visits?: number;
  /** The user's projects, for the no-project broad prompts (most-recent / most-stale). */
  projects?: NoProjectSummary[];
}

export interface ProjectPrompts {
  prompts: string[]; // up to 3 situational
  offer: string; // the standing "+1" action offer
}

const SITUATIONAL_LIMIT = 3;

/** scope.place > scope.zip > title — the plainest name for prompt copy. */
function scopeLabel(digest: ProjectDigest): string {
  return digest.scope.place ?? digest.scope.zip ?? digest.title;
}

/** Ordered, de-duplicated situational prompts for an OPEN project. */
function openProjectCandidates(input: PromptEngineInput, digest: ProjectDigest): string[] {
  const out: string[] = [];

  // freshData — the data behind the project moved since last seen (highest value).
  if (digest.freshnessChangedSinceSeen && digest.freshnessToken) {
    const date = asOfFromToken(digest.freshnessToken);
    out.push(
      date
        ? `New data landed for ${scopeLabel(digest)} (as of ${date}) — want it in your report?`
        : `New data landed for ${scopeLabel(digest)} — want it in your report?`,
    );
  }

  // staleMetric — a filed figure is past its TTL (reconcile verdict; [] when gate off).
  const stale = digest.staleMetrics[0];
  if (stale) out.push(`${stale.label} may be out of date — refresh it?`);

  // readyToSend — J4's closing beat; only when the caller says the send surface is ready.
  if (input.signals?.sendReady) {
    out.push(
      digest.scope.place || digest.scope.zip
        ? `Ready to send your ${scopeLabel(digest)} update?`
        : `Ready to send?`,
    );
  }

  // crossProject — pull-in (reuse) before push-out (gap); one of each at most here.
  const reuse = input.overlap?.reuse[0];
  if (reuse) {
    out.push(`You already have ${reuse.label} in ${reuse.otherProjectTitle} — pull it in here?`);
  }
  const gap = input.overlap?.gap[0];
  if (gap) {
    out.push(
      `${gap.otherProjectTitle} covers the same area but is missing ${gap.label} — add it there?`,
    );
  }

  // whereLeftOff — lowest-rank fallback when there's prior activity.
  if (digest.latestActivityAt) out.push(`Pick up where you left off?`);

  return out;
}

/** Broad prompts for no-project (Outside / list) mode. */
function noProjectCandidates(input: PromptEngineInput): string[] {
  const out: string[] = [];
  const projects = input.projects ?? [];

  const mostRecent = [...projects]
    .filter((p) => p.latestActivityAt)
    // Newest first; break ties on projectId so the pick is order-independent (the
    // determinism contract this module advertises — a bare 1/-1 comparator flips on ties).
    .sort((a, b) =>
      a.latestActivityAt! < b.latestActivityAt!
        ? 1
        : a.latestActivityAt! > b.latestActivityAt!
          ? -1
          : a.projectId.localeCompare(b.projectId),
    )[0];
  if (mostRecent) out.push(`Pick up where you left off in ${mostRecent.title}?`);

  const stale = projects.find(
    (p) => p.freshnessChangedSinceSeen && p.projectId !== mostRecent?.projectId,
  );
  if (stale) out.push(`${stale.title} has new data — refresh it?`);

  return out;
}

/** De-dupe preserving order, then take the first `n`. */
function pickFirst(candidates: string[], n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

export function projectPrompts(input: PromptEngineInput): ProjectPrompts {
  const visits = input.visits ?? 0;

  if (!input.digest) {
    // No-project (Outside / list): broad prompts, filled with the region floor.
    const floor = promptSetForVisits(visits);
    const prompts = pickFirst([...noProjectCandidates(input), ...floor], SITUATIONAL_LIMIT);
    return { prompts, offer: createSuggestion({ kind: "generic" }) };
  }

  const digest = input.digest;
  // Situational candidates, then the static project floor so we always reach 3.
  const floor = promptsForPage({ kind: "project", projectId: digest.projectId }, visits);
  const prompts = pickFirst([...openProjectCandidates(input, digest), ...floor], SITUATIONAL_LIMIT);
  return { prompts, offer: createSuggestion({ kind: "project", projectId: digest.projectId }) };
}
