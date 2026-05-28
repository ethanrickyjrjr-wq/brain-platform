/**
 * The fixed "read" every section + the overall view shows:
 *   last 2 GREENS · next 3–6 REDS · any YELLOWS
 *
 * Greens are ordered most-recently-updated first. Reds are ordered by the
 * build-queue priority when the item appears there, else by label. Yellows are
 * whatever is currently being built.
 */
import type { LedgerItem, QueueItem } from "./ledger";

export interface Read {
  greens: LedgerItem[];
  reds: LedgerItem[];
  yellows: LedgerItem[];
}

export function computeRead(
  items: LedgerItem[],
  queue: QueueItem[] = [],
): Read {
  const order = new Map<string, number>();
  queue.forEach((q) => order.set(q.label.toLowerCase(), q.order));
  const rank = (it: LedgerItem): number => {
    const hay = `${it.id} ${it.label}`.toLowerCase();
    for (const [label, ord] of order) {
      if (hay.includes(label) || label.includes(it.id.toLowerCase()))
        return ord;
    }
    return Number.MAX_SAFE_INTEGER;
  };

  const greens = items
    .filter((i) => i.status === "green")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 2);

  const reds = items
    .filter((i) => i.status === "red")
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
    .slice(0, 6);

  const yellows = items.filter((i) => i.status === "yellow");

  return { greens, reds, yellows };
}
