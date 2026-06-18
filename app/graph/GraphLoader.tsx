"use client";

import dynamic from "next/dynamic";

const Graph3D = dynamic(() => import("../../components/graph/Graph3D"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100%",
        height: "100dvh",
        background: "#0f0f1a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#555",
        fontFamily: "sans-serif",
        fontSize: 14,
      }}
    >
      Loading 3D graph…
    </div>
  ),
});

export default function GraphLoader() {
  return <Graph3D />;
}
