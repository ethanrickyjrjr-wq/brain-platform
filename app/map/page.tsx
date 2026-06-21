"use client";

import { ZipChoropleth } from "@/components/charts/ZipChoropleth";

const FLOOD_DATA = {
  "33931": { value: 0.95, label: "$30,074 AAL" },
  "33922": { value: 0.88, label: "$24,100 AAL" },
  "34145": { value: 0.8, label: "$19,200 AAL" },
  "34140": { value: 0.75, label: "$16,800 AAL" },
  "33901": { value: 0.55, label: "$11,400 AAL" },
  "34102": { value: 0.42, label: "$8,900 AAL" },
  "33912": { value: 0.2, label: "$3,100 AAL" },
  "34119": { value: 0.15, label: "$2,400 AAL" },
  "33913": { value: 0.1, label: "$1,800 AAL" },
  "34120": { value: 0.08, label: "$1,200 AAL" },
};

const MAP_PROPS = {
  colorLow: "#dbeafe",
  colorHigh: "#1e3a8a",
  data: FLOOD_DATA,
} as const;

export default function MapPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-16 px-8 py-12">
      <section>
        <h1 className="text-2xl font-semibold">Lee + Collier Counties</h1>
        <p className="mt-1 text-sm text-gray-400">
          Average annual flood loss by ZIP code. Hover a ZIP for detail.
        </p>
        <ZipChoropleth
          {...MAP_PROPS}
          county="both"
          className="mt-6 h-[560px] rounded-xl border border-white/10"
        />
      </section>

      <section>
        <h2 className="text-xl font-semibold">Lee County</h2>
        <p className="mt-1 text-sm text-gray-400">
          Fort Myers, Cape Coral, Lehigh Acres and surrounding ZIPs.
        </p>
        <ZipChoropleth
          {...MAP_PROPS}
          county="Lee"
          className="mt-6 h-[480px] rounded-xl border border-white/10"
        />
      </section>

      <section>
        <h2 className="text-xl font-semibold">Collier County</h2>
        <p className="mt-1 text-sm text-gray-400">
          Naples, Marco Island, Immokalee and surrounding ZIPs.
        </p>
        <ZipChoropleth
          {...MAP_PROPS}
          county="Collier"
          className="mt-6 h-[480px] rounded-xl border border-white/10"
        />
      </section>
    </div>
  );
}
