import { notFound } from "next/navigation";
import { buildLedger } from "../../../lib/ledger";
import { CategorySection, Link } from "../../ui";

export const revalidate = 300;

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const ledger = await buildLedger();
  const cat = ledger.categories.find((c) => c.key === category);
  if (!cat) notFound();

  return (
    <main className="wrap">
      <p className="subtitle">
        <Link href="/">← /ops</Link>
      </p>
      <h1>{cat.title}</h1>
      <p className="subtitle mono">
        {ledger.generatedAt.slice(0, 16).replace("T", " ")} UTC · derived from
        live signals
      </p>
      <div style={{ marginTop: 16 }}>
        <CategorySection cat={cat} queue={ledger.queue} />
      </div>
      <footer>
        SWFL Data Gulf · /ops · {cat.title}. Status is derived, never
        hand-typed.
      </footer>
    </main>
  );
}
