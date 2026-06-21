import fs from "fs";
import path from "path";

function extractGroupContent(svg: string, zip: string): string | null {
  const marker = ` id="${zip}"`;
  const markerIdx = svg.indexOf(marker);
  if (markerIdx === -1) return null;

  // Walk back to the opening '<' of the tag that owns this id
  let tagStart = markerIdx;
  while (tagStart > 0 && svg[tagStart] !== "<") tagStart--;

  let i = tagStart;
  let depth = 0;

  while (i < svg.length) {
    if (svg[i] !== "<") {
      i++;
      continue;
    }

    if (svg.slice(i, i + 2) === "</") {
      // Closing tag — find end
      const end = svg.indexOf(">", i);
      if (end === -1) break;
      depth--;
      if (depth === 0) return svg.slice(tagStart, end + 1);
      i = end + 1;
    } else {
      // Opening or self-closing tag
      const end = svg.indexOf(">", i);
      if (end === -1) break;
      const fragment = svg.slice(i, end + 1);
      // Comments and processing instructions don't affect depth
      if (!fragment.startsWith("<!") && !fragment.startsWith("<?")) {
        if (!fragment.endsWith("/>")) depth++;
      }
      i = end + 1;
    }
  }
  return null;
}

function parseBounds(content: string): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const pairs: [number, number][] = [];
  // Catch absolute M / L / C / Q command coordinate pairs
  const re = /[MLC]\s*([\d.]+)[,\s]+([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    pairs.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
  if (pairs.length === 0) return { minX: 0, minY: 0, maxX: 1190, maxY: 1237 };
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export interface ZipShapeResult {
  svgMarkup: string;
  found: boolean;
}

export function extractZipShape(zip: string): ZipShapeResult {
  try {
    const svgPath = path.join(process.cwd(), "public", "map", "lee-collier.svg");
    const full = fs.readFileSync(svgPath, "utf-8");
    const group = extractGroupContent(full, zip);
    if (!group) return { svgMarkup: "", found: false };

    const { minX, minY, maxX, maxY } = parseBounds(group);
    const w = maxX - minX;
    const h = maxY - minY;
    // Pad by 15% of the larger dimension, min 20 units
    const pad = Math.max(20, Math.max(w, h) * 0.15);
    const vb = `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;

    // Strip classes/styles — the page CSS applies all visual treatment
    const cleaned = group.replace(/\sclass="[^"]*"/g, "").replace(/\sstyle="[^"]*"/g, "");

    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" aria-hidden="true">${cleaned}</svg>`;
    return { svgMarkup, found: true };
  } catch {
    return { svgMarkup: "", found: false };
  }
}
