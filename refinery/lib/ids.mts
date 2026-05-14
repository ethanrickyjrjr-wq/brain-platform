import { createHash } from "node:crypto";

/** Stable fragment id from a source id + a natural key (idempotent across runs). */
export function fragmentId(sourceId: string, naturalKey: string): string {
  const h = createHash("sha256")
    .update(`${sourceId}::${naturalKey}`)
    .digest("hex")
    .slice(0, 12);
  return `frag_${h}`;
}

/** Sequential SAVED FACTS ids: f001, f002, ... */
export function factId(index: number): string {
  return `f${String(index + 1).padStart(3, "0")}`;
}

/** Sequential CITATION TABLE ids: s01, s02, ... */
export function citationId(index: number): string {
  return `s${String(index + 1).padStart(2, "0")}`;
}

/** SHA-256 of arbitrary content — used for raw-snapshot identity. */
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
