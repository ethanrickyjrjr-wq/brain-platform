import type { ProjectItem } from "@/lib/project/items";
import { groupItemsByKind } from "@/lib/project/group-items";
import { ItemCard } from "./ItemCard";
import type { SavedChart } from "./types";

/** Customer-clean group headings (no internal kind ids). */
const KIND_LABEL: Record<ProjectItem["kind"], string> = {
  qa: "Answers",
  chart: "Charts",
  metric: "Figures",
  report: "Reports",
  source: "Sources",
  note: "Notes",
  table_slice: "Tables",
  file: "Files",
  frame: "Live frames",
};

/**
 * The grouped item board: items bucketed by kind (fixed order via
 * `groupItemsByKind`) into labelled sections of compact `ItemCard`s. Replaces the
 * monolith's flat list. Move/remove operate by id (the orchestrator swaps within
 * the kind so the grouping stays stable).
 */
export function ItemsBoard({
  items,
  charts,
  fileUrls,
  localPreviews,
  onMove,
  onRemove,
}: {
  items: ProjectItem[];
  charts: Record<string, SavedChart>;
  fileUrls: Record<string, string>;
  localPreviews: Record<string, string>;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="mt-6 text-sm text-gray-400">No items in this project yet.</p>;
  }
  const groups = groupItemsByKind(items);
  return (
    <div className="mt-6 flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.kind}>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            {KIND_LABEL[g.kind]} · {g.items.length}
          </h3>
          <ul className="flex flex-col gap-2">
            {g.items.map((item, i) => (
              <ItemCard
                key={item.id}
                item={item}
                charts={charts}
                fileUrls={fileUrls}
                localPreviews={localPreviews}
                isFirst={i === 0}
                isLast={i === g.items.length - 1}
                onMove={onMove}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
