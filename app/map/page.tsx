import { ZipChoropleth } from "@/components/viz/ZipChoropleth";

export default function MapPage() {
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-2">Lee + Collier ZIP Map</h1>
      <p className="text-sm text-gray-500 mb-6">Hover a ZIP to see it. Flood AAL sample data.</p>
      <ZipChoropleth
        className="h-[600px] rounded-lg border border-gray-200"
        colorLow="#dbeafe"
        colorHigh="#1e3a8a"
        data={{
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
        }}
      />
    </div>
  );
}
