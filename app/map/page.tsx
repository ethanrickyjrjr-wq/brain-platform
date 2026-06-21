import { MapCanvas } from "@/components/charts/MapCanvas";
import "@/components/landing/home-explorer.css";

export default function MapPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-8 py-12">
      <section>
        <h1 className="text-2xl font-semibold">Lee + Collier Counties</h1>
        <p className="mt-1 text-sm text-gray-400">
          Flood risk by ZIP — hover to explore, click to open report.
        </p>
        <MapCanvas county="both" metric="flood" className="mt-6 h-[560px] rounded-xl" />
      </section>

      <section className="space-y-10">
        <h2 className="text-xl font-semibold">County Breakdown</h2>
        <div>
          <h3 className="text-base font-medium mb-1">Lee County</h3>
          <p className="text-sm text-gray-400 mb-4">Fort Myers, Cape Coral, Lehigh Acres</p>
          <MapCanvas county="Lee" metric="flood" className="h-[560px] rounded-xl" />
        </div>
        <div>
          <h3 className="text-base font-medium mb-1">Collier County</h3>
          <p className="text-sm text-gray-400 mb-4">Naples, Marco Island, Immokalee</p>
          <MapCanvas county="Collier" metric="flood" className="h-[560px] rounded-xl" />
        </div>
      </section>
    </div>
  );
}
