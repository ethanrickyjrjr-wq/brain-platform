// lib/email/outreach/demo-subjects.ts
//
// Deterministic subject lines for the funnel demo cadence — pure, no LLM.
// Every dynamic figure is passed IN (computed from lake data upstream); a shape
// that calls for a number falls back to a numberless truthful shape when the
// figure isn't held — never an invented value.
// Spec: docs/superpowers/specs/2026-07-02-funnel-demo-email-design.md §6.

import type { DemoTouch } from "./demo-cadence";

export interface SubjectArgs {
  track: "agent" | "broker";
  touch: DemoTouch;
  variant: "a" | "b";
  name: string | null;
  brokerage: string | null;
  place: string;
  /** A real lake figure, already formatted (e.g. "214 active listings"), or null. */
  headlineFigure: string | null;
  /** T2: whole-$K move of the median vs the frozen T1 snapshot. null/0 = no real move. */
  medianDeltaK: number | null;
  /** T2: truthful timing label, e.g. "Tuesday" (T1 send weekday). */
  sinceLabel: string | null;
}

function possessive(s: string): string {
  return s.endsWith("'s") || s.endsWith("’s") ? s : `${s}'s`;
}

export function demoSubject(a: SubjectArgs): string {
  const namePrefix = a.name ? `${a.name}, ` : "";
  const nameSuffix = a.name ? `, ${a.name}` : "";
  switch (a.touch) {
    case "t1": {
      if (a.track === "broker") {
        const who = a.brokerage ?? "your";
        if (a.variant === "b" && a.headlineFigure)
          return `${a.headlineFigure} in ${a.place} — one engine for every ${who} agent`;
        return `${possessive(who)} ${a.place} agents, powered by one data engine`;
      }
      if (a.variant === "b" && a.headlineFigure)
        return `${a.place}: ${a.headlineFigure} — your clients could've had this by 9 AM`;
      return `${namePrefix}the ${a.place} email your clients didn't get this morning`;
    }
    case "t2": {
      if (a.medianDeltaK != null && a.medianDeltaK !== 0) {
        const k = a.medianDeltaK;
        const money = k < 0 ? `-$${Math.abs(k)}K` : `$${k}K`;
        return `${possessive(a.place)} median moved ${money} since ${a.sinceLabel ?? "our last note"}`;
      }
      return `${a.place} re-checked ${a.sinceLabel ?? "today"} — your numbers held`;
    }
    case "t3":
      return a.track === "broker"
        ? `Which ${a.brokerage ?? "your"} listings emails get opened? You'd know`
        : `Your ${a.place} social calendar, already written`;
    case "t4":
      return `Last one from us${nameSuffix} — your ${a.place} setup stays live`;
    case "trial":
      return a.headlineFigure
        ? `${a.place} today: ${a.headlineFigure}`
        : `${a.place} today — your daily market read`;
    case "reengage":
      return `What changed in ${a.place} since we last wrote`;
  }
}
