// lib/project/lab-redirect.ts
// Cockpit D4 — signed-in visits to the standalone labs land in a project's
// Email tab (grid is the default canvas there, so one destination covers both
// /email-lab and /email-lab/grid). Null = no projects; the caller auto-creates.
export function labDestination(projects: { id: string }[]): string | null {
  const first = projects[0];
  return first ? `/project/${first.id}/email-lab` : null;
}
