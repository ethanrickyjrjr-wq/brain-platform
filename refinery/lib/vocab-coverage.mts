import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BrainOutput } from "../types/brain-output.mts";

/**
 * Vocab-coverage assertion helper for pack tests.
 *
 * Background: every metric a pack emits via its `outputProducer` must be
 * registered in `refinery/vocab/brain-vocabulary.json` — either as a `raw_slug`
 * on a concept OR as a string entry in the top-level `slug_aliases` map.
 * Unregistered metrics produce orphan-concept errors at Stage 2.5 normalize
 * when `master` rebuilds, which only surfaces during a full DAG run.
 *
 * Pack-level tests historically did NOT catch this gap. Lane 2D shipped 9
 * unregistered metrics that pack tests passed in isolation; the orphan-concept
 * error only fired when `npm run refinery -- master --force` rebuilt the full
 * chain. The fix landed at commit `ade2485`; this helper prevents the same
 * class of failure from shipping again.
 *
 * Convention for NEW packs: add the following to your pack's `.test.mts` file:
 *
 *   test("yourPackId: vocab coverage — every emitted metric is registered", async () => {
 *     const { assertEveryMetricRegistered, parseOutputFromBrainMd } = await import(
 *       "../lib/vocab-coverage.mts"
 *     );
 *     const output = await parseOutputFromBrainMd("your-pack-id");
 *     await assertEveryMetricRegistered(output, "your-pack-id");
 *   });
 */

interface VocabShape {
  concepts: Record<string, { raw_slugs?: string[] }>;
  slug_aliases: Record<string, unknown>;
}

/**
 * Build the set of vocab-registered raw_slugs by walking concept.raw_slugs
 * AND the top-level slug_aliases keys. String-valued aliases map raw → concept;
 * object-valued entries (e.g. `_direction_ambiguous`) are documentation and
 * not actual slug mappings — those are skipped.
 */
export async function loadRegisteredSlugs(): Promise<Set<string>> {
  const vocabPath = path.join(
    process.cwd(),
    "refinery",
    "vocab",
    "brain-vocabulary.json",
  );
  const vocab = JSON.parse(await readFile(vocabPath, "utf-8")) as VocabShape;
  const slugs = new Set<string>();
  for (const concept of Object.values(vocab.concepts ?? {})) {
    for (const slug of concept.raw_slugs ?? []) slugs.add(slug);
  }
  for (const [key, value] of Object.entries(vocab.slug_aliases ?? {})) {
    if (typeof value === "string") slugs.add(key);
  }
  return slugs;
}

/**
 * Assert every metric the pack emits in `output.key_metrics` is registered in
 * brain-vocabulary.json. Throws on the FIRST unregistered metric with a
 * remediation hint naming the slug.
 */
export async function assertEveryMetricRegistered(
  output: BrainOutput,
  packId: string,
): Promise<void> {
  const registered = await loadRegisteredSlugs();
  for (const metric of output.key_metrics ?? []) {
    if (!registered.has(metric.metric)) {
      throw new Error(
        `Pack "${packId}": emitted metric "${metric.metric}" is not registered ` +
          `in refinery/vocab/brain-vocabulary.json. Add either (a) a concept ` +
          `with raw_slugs:["${metric.metric}"], or (b) a slug_aliases entry ` +
          `mapping "${metric.metric}" to an existing concept id. This check ` +
          `prevents the orphan-concept failure that Lane 2D shipped and Wave 5 ` +
          `caught (see commit ade2485).`,
      );
    }
  }
}

/**
 * Parse the `--- OUTPUT ---` JSON block from a rendered brain `.md` file.
 * Pack tests that don't want to re-invoke outputProducer can use this against
 * the on-disk brain file. Trade-off: if the pack changed and the brain hasn't
 * been re-rendered, the test passes against stale data — but the next
 * `npm run refinery -- <pack>` run rebuilds and catches the gap at that point.
 */
export async function parseOutputFromBrainMd(
  packId: string,
): Promise<BrainOutput> {
  const mdPath = path.join(process.cwd(), "brains", `${packId}.md`);
  const md = await readFile(mdPath, "utf-8");
  // The OUTPUT block is raw JSON between `--- OUTPUT ---` and the next
  // `--- SECTION ---` separator (or end of file). NOT wrapped in a code fence.
  const match = md.match(/--- OUTPUT ---\s*\n([\s\S]+?)(?:\n--- |\s*$)/);
  if (!match) {
    throw new Error(
      `brains/${packId}.md: --- OUTPUT --- block not found. ` +
        `Has the brain been rendered? Run \`REFINERY_SOURCE=fixture npm run refinery -- ${packId}\`.`,
    );
  }
  return JSON.parse(match[1].trim()) as BrainOutput;
}
