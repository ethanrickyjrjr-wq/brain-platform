"""
Replace the contractor's wrong 33931 (Fort Myers Beach) polygon with the
correct ZCTA boundary from public/maps/swfl-zcta.geojson.

Steps:
  1. Parse the contractor SVG — extract bounding-box centroids for every ZIP group
  2. Load fixtures/swfl-zip-centroids.json for lat/lng of those same ZIPs
  3. Fit an affine transform  (lon, lat) → (svg_x, svg_y)  via least-squares
  4. Extract 33931 polygon rings from swfl-zcta.geojson
  5. Project rings → SVG coords, build <path d="…"> strings
  6. Replace the <g id="33931" …> block in the SVG
  7. Run the full build_demo4.py pipeline on the patched SVG
"""

import re, json, math
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT   = Path(__file__).parent.parent
SVG_IN = Path(r'c:\Users\ethan\Downloads\Lee County and Collier County-01 (1).svg')
GEO    = ROOT / 'public/maps/swfl-zcta.geojson'
CENTS  = ROOT / 'fixtures/swfl-zip-centroids.json'
OUT    = Path(r'c:\Users\ethan\Downloads\swfl-demo-wip.html')

# ── 1. Parse SVG, compute bounding-box centroid for every zip group ──────────

print("Parsing SVG …")
with open(SVG_IN, encoding='utf-8', errors='replace') as f:
    svg_text = f.read()

# Strip namespace so ElementTree is happy
svg_clean = re.sub(r'xmlns[^=]*="[^"]*"', '', svg_text)
root = ET.fromstring(svg_clean)

def all_coords(element):
    """Yield every (x, y) number pair from path d= and polygon points= attributes."""
    for el in element.iter():
        # path d= — grab every pair of floats after M/L/C/etc.
        d = el.get('d', '')
        nums = [float(n) for n in re.findall(r'-?\d+\.?\d*', d)]
        for i in range(0, len(nums)-1, 2):
            yield nums[i], nums[i+1]
        # polygon points=
        pts = el.get('points', '')
        nums2 = [float(n) for n in re.findall(r'-?\d+\.?\d*', pts)]
        for i in range(0, len(nums2)-1, 2):
            yield nums2[i], nums2[i+1]

svg_centroids = {}   # zip_str → (cx, cy)
for g in root.iter():
    gid = g.get('id', '')
    if re.fullmatch(r'_?\d{5}', gid):
        zip5 = gid.lstrip('_')
        xs, ys = [], []
        for x, y in all_coords(g):
            xs.append(x); ys.append(y)
        if xs:
            svg_centroids[zip5] = (sum(xs)/len(xs), sum(ys)/len(ys))

print(f"  Found {len(svg_centroids)} ZIP groups with coordinates")

# ── 2. Load lat/lng centroids ─────────────────────────────────────────────────

with open(CENTS) as f:
    cent_data = json.load(f)

geo_centroids = {}  # zip_str → (lon, lat)
for e in cent_data['entries']:
    geo_centroids[e['zip']] = (e['lng'], e['lat'])

# ── 3. Fit affine transform lon/lat → svg_x/svg_y ────────────────────────────
# Model: svg_x = a*lon + b*lat + c
#        svg_y = d*lon + e*lat + f
# Solve with least squares over all ZIPs present in both datasets.

common = [(z, geo_centroids[z], svg_centroids[z])
          for z in svg_centroids if z in geo_centroids]
print(f"  Anchor ZIPs for transform fit: {len(common)}")

# Build matrices A (n×3) and Bx, By (n×1)
A, Bx, By = [], [], []
for _, (lon, lat), (sx, sy) in common:
    A.append([lon, lat, 1.0])
    Bx.append(sx)
    By.append(sy)

def least_squares_3(A, b):
    """Solve A·x = b in least-squares sense (3 unknowns)."""
    # Normal equations: (AᵀA)x = Aᵀb
    AtA = [[0]*3 for _ in range(3)]
    Atb = [0]*3
    for row, bi in zip(A, b):
        for i in range(3):
            Atb[i] += row[i] * bi
            for j in range(3):
                AtA[i][j] += row[i] * row[j]
    # Gaussian elimination
    m = [AtA[i][:] + [Atb[i]] for i in range(3)]
    for col in range(3):
        pivot = max(range(col, 3), key=lambda r: abs(m[r][col]))
        m[col], m[pivot] = m[pivot], m[col]
        for row in range(col+1, 3):
            if m[col][col] == 0: continue
            f = m[row][col] / m[col][col]
            m[row] = [m[row][k] - f*m[col][k] for k in range(4)]
    x = [0]*3
    for i in range(2, -1, -1):
        x[i] = m[i][3]
        for j in range(i+1, 3):
            x[i] -= m[i][j] * x[j]
        x[i] /= m[i][i]
    return x

ax, bx, cx = least_squares_3(A, Bx)
ay, by_, cy = least_squares_3(A, By)

def project(lon, lat):
    return (ax*lon + bx*lat + cx,
            ay*lon + by_*lat + cy)

# Sanity check residuals
residuals = []
for _, (lon, lat), (sx, sy) in common:
    px, py = project(lon, lat)
    residuals.append(math.hypot(px-sx, py-sy))
avg_res = sum(residuals)/len(residuals)
print(f"  Transform fit avg residual: {avg_res:.1f} SVG units  (should be <20)")

# ── 4. Extract 33931 from swfl-zcta.geojson ───────────────────────────────────

print("Loading ZCTA GeoJSON …")
with open(GEO) as f:
    geo = json.load(f)

feature_33931 = None
for feat in geo['features']:
    props = feat.get('properties', {})
    # field names vary — try common ones
    z = str(props.get('ZCTA5CE20') or props.get('ZCTA5CE10') or
            props.get('GEOID20') or props.get('GEOID') or
            props.get('ZIP_CODE') or props.get('zip') or '')
    if z.zfill(5) == '33931':
        feature_33931 = feat
        break

if not feature_33931:
    # Try brute-force search
    for feat in geo['features']:
        for v in feat.get('properties', {}).values():
            if str(v) == '33931':
                feature_33931 = feat
                break
        if feature_33931:
            break

if not feature_33931:
    raise RuntimeError("33931 not found in swfl-zcta.geojson — check property names")

geom = feature_33931['geometry']
print(f"  Found 33931 geometry type: {geom['type']}")

# ── 5. Build SVG path strings from rings ──────────────────────────────────────

def ring_to_path(coords):
    """Convert a list of [lon, lat] pairs → SVG path string."""
    parts = []
    for i, (lon, lat) in enumerate(coords):
        x, y = project(lon, lat)
        cmd = 'M' if i == 0 else 'L'
        parts.append(f"{cmd}{x:.2f},{y:.2f}")
    parts.append('Z')
    return ''.join(parts)

paths_svg = []
if geom['type'] == 'Polygon':
    for ring in geom['coordinates']:
        paths_svg.append(ring_to_path(ring))
elif geom['type'] == 'MultiPolygon':
    for poly in geom['coordinates']:
        for ring in poly:
            paths_svg.append(ring_to_path(ring))

print(f"  Generated {len(paths_svg)} path(s) for 33931")

# Build the replacement <g> block
path_els = '\n      '.join(
    f'<path style="fill:none;stroke:#000;stroke-width:.1px" d="{p}"/>' for p in paths_svg
)
new_group = f'''<g id="_33931" data-name="33931">
    <g>
      {path_els}
    </g>
  </g>'''

# ── 6. Replace the 33931 group in the SVG text ───────────────────────────────

# Find the existing _33931 group and replace it
pattern = r'<g\s+id="_33931"[^>]*>.*?</g>\s*</g>'
match = re.search(pattern, svg_text, re.DOTALL)
if not match:
    raise RuntimeError("Could not find <g id='_33931'> block in SVG")

print(f"  Replacing contractor block ({len(match.group())} chars) with ZCTA boundary ({len(new_group)} chars)")
patched_svg = svg_text[:match.start()] + new_group + svg_text[match.end():]

# Write patched SVG to a temp file
patched_path = Path(r'c:\Users\ethan\Downloads\Lee County and Collier County-01 (1)-patched.svg')
with open(patched_path, 'w', encoding='utf-8') as f:
    f.write(patched_svg)
print(f"  Patched SVG written: {patched_path}")

# ── 7. Rebuild the demo HTML using the patched SVG ───────────────────────────

print("Rebuilding demo HTML …")

# Re-run build_demo4 logic inline, pointing at patched SVG
import sys
sys.path.insert(0, str(Path(__file__).parent))

# Inline the build (avoids import side-effects from reading the original file)
exec(open(Path(__file__).parent / 'build_demo4.py').read().replace(
    r"c:\Users\ethan\Downloads\Lee County and Collier County-01 (1).svg",
    str(patched_path)
))
