/**
 * components/GlobalDigestFallback.tsx — the plain-narrative fallback for an "email"
 * deliverable whose scope can't ground a ZIP report (a non-ZIP scope, or an old row
 * predating the scope_kind/scope_value migration).
 *
 * Renders the deliverable's frozen narrative as readable prose — never an error page,
 * never invented sub-grain precision. Props are intentionally permissive so a partial
 * or legacy `narrative` JSONB still renders without crashing.
 */

interface Props {
  narrative: {
    exec_summary?: string | null;
    sections?: Array<{ title: string; intro: string }>;
  };
}

export function GlobalDigestFallback({ narrative }: Props) {
  return (
    <div className="prose mx-auto max-w-2xl px-4 py-8">
      {narrative.exec_summary && <p className="lead">{narrative.exec_summary}</p>}
      {(narrative.sections ?? []).map((s, i) => (
        <section key={i}>
          <h2>{s.title}</h2>
          <p>{s.intro}</p>
        </section>
      ))}
    </div>
  );
}
