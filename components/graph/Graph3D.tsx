"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";

// ── palette: 20 distinct hues, cycled across 100 communities ──────────────
const PALETTE = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AC",
  "#499894",
  "#86BCB6",
  "#E15759",
  "#FF9DA7",
  "#79706E",
  "#D37295",
  "#FABFD2",
  "#B6992D",
  "#F1CE63",
  "#A0CBE8",
];
const communityColor = (c: number) => PALETTE[c % PALETTE.length];

const NODE_TYPE_COLOR: Record<string, string> = {
  brain: "#4E79A7",
  pipeline: "#F28E2B",
  slug: "#76B7B2",
};

interface RawNode {
  id: string;
  label: string;
  type: "brain" | "pipeline" | "slug";
  domain?: string;
  scope?: string;
  source_file?: string;
  community: number;
  community_name: string;
}
interface RawLink {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  confidence_score: number;
}
interface GraphData {
  nodes: RawNode[];
  links: RawLink[];
}

interface NodeObj extends RawNode {
  x?: number;
  y?: number;
  z?: number;
  __threeObj?: THREE.Object3D;
  degree?: number;
}

type ColorMode = "community" | "type";

export default function Graph3D() {
  const fgRef = useRef<ReturnType<typeof ForceGraph3D> | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: NodeObj[]; links: RawLink[] } | null>(null);
  const [selected, setSelected] = useState<NodeObj | null>(null);
  const [hovered, setHovered] = useState<NodeObj | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("community");
  const [showLabels, setShowLabels] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  // measure container
  useEffect(() => {
    const update = () => setDims({ w: window.innerWidth - 300, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // load data
  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((raw: GraphData) => {
        // compute per-node degree
        const deg: Record<string, number> = {};
        for (const l of raw.links) {
          deg[l.source] = (deg[l.source] ?? 0) + 1;
          deg[l.target] = (deg[l.target] ?? 0) + 1;
        }
        const nodes: NodeObj[] = raw.nodes.map((n) => ({ ...n, degree: deg[n.id] ?? 1 }));
        setGraphData({ nodes, links: raw.links });
      });
  }, []);

  const getColor = useCallback(
    (node: NodeObj) =>
      colorMode === "type"
        ? (NODE_TYPE_COLOR[node.type] ?? "#aaa")
        : communityColor(node.community),
    [colorMode],
  );

  const handleNodeClick = useCallback((node: NodeObj) => {
    setSelected((prev) => (prev?.id === node.id ? null : node));
    // fly camera toward clicked node
    const fg = fgRef.current as {
      cameraPosition: (pos: object, lookAt: object, ms: number) => void;
    } | null;
    if (fg && node.x != null) {
      const dist = 120;
      const { x = 0, y = 0, z = 0 } = node;
      fg.cameraPosition(
        {
          x: x * (1 + dist / Math.hypot(x, y, z)),
          y: y * (1 + dist / Math.hypot(x, y, z)),
          z: z * (1 + dist / Math.hypot(x, y, z)),
        },
        { x, y, z },
        800,
      );
    }
  }, []);

  const nodeThreeObject = useCallback(
    (node: NodeObj) => {
      const color = getColor(node);
      const radius = 3 + (node.degree ?? 1) * 0.6;
      const geo = new THREE.SphereGeometry(radius, 12, 12);
      const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.9 });
      const mesh = new THREE.Mesh(geo, mat);

      if (showLabels || node.type === "brain") {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 48;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillRect(0, 0, 256, 48);
        ctx.font = "bold 22px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText(node.label, 128, 32);
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(40, 8, 1);
        sprite.position.set(0, radius + 5, 0);
        mesh.add(sprite);
      }

      return mesh;
    },
    [getColor, showLabels],
  );

  const focused = hovered ?? selected;

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100dvh",
        background: "#0f0f1a",
        overflow: "hidden",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* 3D canvas */}
      <div style={{ flex: 1, position: "relative" }}>
        {graphData && (
          <ForceGraph3D
            ref={fgRef as React.MutableRefObject<typeof ForceGraph3D>}
            width={dims.w}
            height={dims.h}
            graphData={graphData}
            backgroundColor="#0f0f1a"
            nodeThreeObject={nodeThreeObject}
            nodeThreeObjectExtend={false}
            linkColor={() => "rgba(120,140,200,0.25)"}
            linkWidth={0.5}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkDirectionalParticles={1}
            linkDirectionalParticleSpeed={0.004}
            onNodeClick={(node) => handleNodeClick(node as NodeObj)}
            onNodeHover={(node) => setHovered(node as NodeObj | null)}
            nodeLabel={(node) =>
              `<span style="font-size:12px;color:#fff;background:rgba(0,0,0,.7);padding:3px 6px;border-radius:4px">${(node as NodeObj).label}</span>`
            }
            enableNodeDrag
            enableNavigationControls
            showNavInfo={false}
          />
        )}
        {!graphData && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#666",
              fontSize: 14,
            }}
          >
            Loading graph…
          </div>
        )}
      </div>

      {/* sidebar */}
      <div
        style={{
          width: 300,
          background: "#1a1a2e",
          borderLeft: "1px solid #2a2a4e",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* controls */}
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid #2a2a4e" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e0e0e0", marginBottom: 10 }}>
            Brain Graph <span style={{ fontSize: 11, color: "#555", fontWeight: 400 }}>3D</span>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {(["community", "type"] as ColorMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setColorMode(m)}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  borderRadius: 5,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  background: colorMode === m ? "#4E79A7" : "#2a2a4e",
                  color: colorMode === m ? "#fff" : "#aaa",
                }}
              >
                {m === "community" ? "By Community" : "By Type"}
              </button>
            ))}
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12,
              color: "#aaa",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              style={{ accentColor: "#4E79A7" }}
            />
            Show all labels
          </label>
        </div>

        {/* node info */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #2a2a4e", minHeight: 150 }}>
          <div
            style={{
              fontSize: 11,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}
          >
            Node Info
          </div>
          {focused ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: getColor(focused),
                    flexShrink: 0,
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    color: "#e0e0e0",
                    wordBreak: "break-all",
                  }}
                >
                  {focused.label}
                </span>
              </div>
              <InfoRow label="Type" value={focused.type} />
              {focused.domain && <InfoRow label="Domain" value={focused.domain} />}
              <InfoRow label="Community" value={focused.community_name} />
              <InfoRow label="Degree" value={String(focused.degree ?? "—")} />
              {focused.source_file && <InfoRow label="File" value={focused.source_file} mono />}
              {focused.scope && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#888", lineHeight: 1.5 }}>
                  {focused.scope.slice(0, 160)}
                  {focused.scope.length > 160 ? "…" : ""}
                </div>
              )}
            </>
          ) : (
            <span style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>
              Click or hover a node
            </span>
          )}
        </div>

        {/* legend */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          <div
            style={{
              fontSize: 11,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}
          >
            Legend
          </div>
          {colorMode === "type"
            ? Object.entries(NODE_TYPE_COLOR).map(([type, color]) => (
                <LegendRow
                  key={type}
                  color={color}
                  label={type}
                  count={graphData?.nodes.filter((n) => n.type === type).length ?? 0}
                />
              ))
            : Array.from({ length: PALETTE.length }, (_, i) => {
                const count =
                  graphData?.nodes.filter((n) => n.community % PALETTE.length === i).length ?? 0;
                return count > 0 ? (
                  <LegendRow key={i} color={PALETTE[i]} label={`Cluster ${i}`} count={count} />
                ) : null;
              })}
        </div>

        {/* stats */}
        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid #2a2a4e",
            fontSize: 11,
            color: "#555",
          }}
        >
          {graphData ? `${graphData.nodes.length} nodes · ${graphData.links.length} edges` : "—"}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ fontSize: 12, color: "#ccc", marginBottom: 4, display: "flex", gap: 6 }}>
      <span style={{ color: "#666", minWidth: 60, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? "monospace" : undefined,
          wordBreak: "break-all",
          fontSize: mono ? 11 : 12,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function LegendRow({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 12 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
          display: "inline-block",
        }}
      />
      <span
        style={{
          flex: 1,
          color: "#ccc",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span style={{ color: "#555", fontSize: 11 }}>{count}</span>
    </div>
  );
}
