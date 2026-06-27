"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { HOME_MAP_DATA as DATA, METRIC_ORDER, type MetricKey } from "@/lib/landing/home-map-data";

/**
 * Homepage hero = the approved HOMEPAGE/ demo, integrated.
 * Centered headline + search + metric filter pills, then the live Lee/Collier
 * choropleth (data rail · clickable ZIP map · stats bar). The contractor SVG is
 * served from public/map/lee-collier.svg and injected client-side; the demo's
 * vanilla interaction logic is ported into one scoped effect. Mock data for now
 * (lib/landing/home-map-data.ts) — swap for the live lake later (HANDOFF step 4).
 */
export default function Hero() {
  const rootRef = useRef<HTMLElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // Latest-router ref so the imperative (DOM-wired) search handlers below can
  // navigate without making the heavy map-setup effect depend on `router`.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const root = rootRef.current;
    const host = svgHostRef.current;
    if (!root || !host) return;

    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const on = <K extends keyof HTMLElementEventMap>(
      el: Element | null,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
    ) => {
      if (!el) return;
      el.addEventListener(type, fn as EventListener);
      cleanups.push(() => el.removeEventListener(type, fn as EventListener));
    };
    const byId = (id: string) => root.querySelector<HTMLElement>(`[id="${id}"]`);
    const zipEl = (zip: string) => host.querySelector<SVGGElement>(`.zip-group[id="${zip}"]`);

    let activeMetric: MetricKey = "flood";
    let selectedZip: string | null = null;

    const clamp = (t: number) => Math.max(0, Math.min(1, t));
    const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t);
    const hexToRgb = (h: string): [number, number, number] => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
    const lerpColor = (c1: string, c2: string, t: number) => {
      const [r1, g1, b1] = hexToRgb(c1);
      const [r2, g2, b2] = hexToRgb(c2);
      return `rgb(${Math.round(lerp(r1, r2, t))},${Math.round(lerp(g1, g2, t))},${Math.round(lerp(b1, b2, t))})`;
    };
    const getColor = (zip: string, metric: MetricKey) => {
      const m = DATA.metrics[metric];
      const val = m.data[zip];
      if (val === undefined) return "#2a3942"; // no-data: visible neutral, NOT the bg
      const t = (val - m.low) / (m.high - m.low);
      return t < 0.5 ? lerpColor(m.c0, m.c1, t * 2) : lerpColor(m.c1, m.c2, (t - 0.5) * 2);
    };
    const fmt = (val: number, format: "currency" | "number") => {
      if (format === "currency") {
        if (val >= 1_000_000) return "$" + (val / 1_000_000).toFixed(2) + "M";
        if (val >= 1000) return "$" + Math.round(val / 1000) + "K";
        return "$" + val.toLocaleString();
      }
      return val.toLocaleString();
    };
    const rankOf = (zip: string, metric: MetricKey) => {
      const m = DATA.metrics[metric];
      const sorted = Object.entries(m.data).sort((a, b) => b[1] - a[1]);
      const i = sorted.findIndex(([z]) => z === zip);
      return i === -1 ? null : { pos: i + 1, total: sorted.length };
    };
    const county = (zip: string) => (parseInt(zip) >= 34100 ? "Collier County" : "Lee County");

    const setText = (id: string, text: string) => {
      const el = byId(id);
      if (el) el.textContent = text;
    };

    const fillRail = (zip: string) => {
      selectedZip = zip;
      setText("rd-zipcode", zip);
      setText("rd-place", DATA.placeNames[zip] || zip);
      setText("rd-county", county(zip));
      for (const k of METRIC_ORDER) {
        const m = DATA.metrics[k];
        const val = m.data[zip];
        const r = rankOf(zip, k);
        setText("mval-" + k, val !== undefined ? fmt(val, m.format) : "N/A");
        setText("mrank-" + k, r ? `#${r.pos} of ${r.total} ZIPs` : "");
        const bar = byId("mbar-" + k);
        if (bar)
          bar.style.width =
            val !== undefined ? Math.max(3, ((val - m.low) / (m.high - m.low)) * 100) + "%" : "0%";
      }
      const empty = byId("rail-empty");
      if (empty) empty.style.display = "none";
      byId("rail-detail")?.classList.add("visible");
    };

    const applyMetric = (metric: MetricKey) => {
      activeMetric = metric;
      const m = DATA.metrics[metric];
      host.querySelectorAll<SVGGElement>(".zip-group").forEach((g) => {
        const color = getColor(g.id, metric);
        g.querySelectorAll<SVGElement>("path, polygon").forEach((p) => {
          p.style.fill = color;
          p.style.stroke = "#0a1419";
          p.style.strokeWidth = ".3px";
          p.style.opacity = "1";
        });
      });
      setText("legend-title", m.label);
      setText("leg-low", fmt(m.low, m.format));
      setText("leg-high", fmt(m.high, m.format));
      const lb = byId("legend-bar");
      if (lb) lb.style.background = `linear-gradient(to right,${m.c0},${m.c1},${m.c2})`;
      setText("rail-metric-name", m.label);
      setText("rail-sublabel", m.sublabel);
      root
        .querySelectorAll<HTMLElement>(".filter-pill")
        .forEach((p) => p.classList.toggle("active", p.dataset.metric === metric));
      for (const k of METRIC_ORDER)
        byId("mrow-" + k)?.classList.toggle("active-metric", k === metric);
      if (selectedZip) fillRail(selectedZip);
    };

    // ── Tooltip ──
    const tip = byId("tooltip");
    const canvas = byId("map-canvas");
    const moveTip = (e: MouseEvent) => {
      if (!tip || !canvas) return;
      const r = canvas.getBoundingClientRect();
      let x = e.clientX - r.left + 14;
      let y = e.clientY - r.top + 14;
      if (x + 180 > r.width) x -= 200;
      if (y + 80 > r.height) y -= 90;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    };
    const showTip = (e: MouseEvent, zip: string) => {
      if (!tip) return;
      const m = DATA.metrics[activeMetric];
      const val = m.data[zip];
      setText("tip-zip", zip);
      setText("tip-place", DATA.placeNames[zip] || "");
      setText("tip-val", val !== undefined ? fmt(val, m.format) : "N/A");
      tip.style.opacity = "1";
      moveTip(e);
    };

    const selectZip = (zip: string) => {
      host.querySelectorAll(".zip-group.selected").forEach((s) => s.classList.remove("selected"));
      zipEl(zip)?.classList.add("selected");
      fillRail(zip);
      // Full page load (not router.push) so mobile pinch-zoom on the map resets
      // to fit-width on the ZIP page instead of opening zoomed-in.
      window.location.href = `/z/${zip}`;
    };

    // Filter pills + metric rows (present immediately — no SVG needed)
    root
      .querySelectorAll<HTMLElement>(".filter-pill")
      .forEach((b) => on(b, "click", () => applyMetric(b.dataset.metric as MetricKey)));
    root
      .querySelectorAll<HTMLElement>(".metric-row")
      .forEach((r) => on(r, "click", () => applyMetric(r.dataset.metric as MetricKey)));
    // Search → the ZIP page (the one front door, same as clicking the map). A 5-digit
    // ZIP opens /z/[zip]; a town / neighborhood / free-text question goes to /ask, which
    // runs the assistant and answers from the live lake. Clicking the map navigates to
    // the same /z/[zip] page — search and map now agree.
    const search = byId("search-input") as HTMLInputElement | null;
    const searchBtn = byId("search-btn");
    const submitSearch = () => {
      const val = (search?.value ?? "").trim();
      if (!val) return;
      const zip = /^\d{5}$/.test(val) ? val : "";
      routerRef.current.push(zip ? `/z/${zip}` : `/ask?q=${encodeURIComponent(val)}`);
    };
    on(search, "keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") submitSearch();
    });
    on(searchBtn, "click", submitSearch);

    // Fetch + inject the contractor SVG, then wire ZIP interactivity.
    fetch("/map/lee-collier.svg")
      .then((r) => r.text())
      .then((svgText) => {
        if (cancelled || !svgHostRef.current) return;
        host.innerHTML = svgText;
        host.querySelectorAll<SVGGElement>(".zip-group").forEach((g) => {
          g.setAttribute("tabindex", "0");
          g.setAttribute("role", "button");
          g.setAttribute("aria-label", `${DATA.placeNames[g.id] || g.id} (${g.id})`);
          on(g, "mouseenter", (e) => showTip(e as MouseEvent, g.id));
          on(g, "mousemove", (e) => moveTip(e as MouseEvent));
          on(g, "mouseleave", () => {
            if (tip) tip.style.opacity = "0";
          });
          on(g, "click", () => selectZip(g.id));
          on(g, "keydown", (e) => {
            const ke = e as KeyboardEvent;
            if (ke.key === "Enter" || ke.key === " ") {
              ke.preventDefault();
              selectZip(g.id);
            }
          });
        });
        applyMetric("flood");
      })
      .catch(() => {
        /* map fetch failed — rest of the page still renders */
      });

    // Initial pill/legend state before the SVG lands.
    applyMetric("flood");

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return (
    <section ref={rootRef}>
      <div className="hero">
        {/* Sample, not live: this hero map + stat bar are illustrative fixture data
            (lib/landing/home-map-data.ts). Honesty over the "every number cited" promise
            until it's wired to the live lake — the real cited reads are one Search away. */}
        <div className="hero-badge">Sample data · Lee &amp; Collier Counties</div>
        <h1>
          Real Data.
          <br />
          <em>Instant Answers.</em>
        </h1>
        <p className="hero-sub">
          Ask any question about any ZIP code and get a cited answer in seconds. Tell AI what to
          build and it delivers the report — automatically, to your clients&rsquo; inboxes.
        </p>
        <div className="search-wrap">
          <div className="search-bar">
            <svg
              className="search-icon"
              width="16"
              height="16"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              className="search-input"
              type="text"
              placeholder="Search ZIP code, city, or neighborhood…"
              id="search-input"
              aria-label="Search by ZIP code"
            />
            <button className="search-btn" type="button" id="search-btn">
              Search
            </button>
          </div>
        </div>
        <div className="filter-row">
          <button className="filter-pill active" type="button" data-metric="flood">
            Flood Risk
          </button>
          <button className="filter-pill" type="button" data-metric="value">
            Home Value
          </button>
          <button className="filter-pill" type="button" data-metric="permits">
            New Permits
          </button>
        </div>
      </div>

      <div className="map-section" id="data">
        <div className="map-layout">
          <div className="data-rail">
            <div className="rail-header">
              <div className="rail-metric-name" id="rail-metric-name">
                Annual Flood Loss
              </div>
              <div className="rail-sublabel" id="rail-sublabel">
                FEMA NFIP avg annual loss per property
              </div>
            </div>
            <div className="rail-empty" id="rail-empty">
              <div className="e-icon">📍</div>
              <div className="e-title">Select a ZIP code</div>
              <div className="e-hint">Click any area on the map to see detailed metrics</div>
            </div>
            <div className="rail-detail" id="rail-detail">
              <div className="zip-header">
                <div className="zip-code-label" id="rd-zipcode"></div>
                <div className="zip-place" id="rd-place"></div>
                <div className="zip-county" id="rd-county"></div>
              </div>
              <div className="metric-row" id="mrow-flood" data-metric="flood">
                <div className="metric-row-label">Annual Flood Loss</div>
                <div className="metric-row-value" id="mval-flood">
                  —
                </div>
                <div className="metric-row-rank" id="mrank-flood"></div>
                <div className="mini-bar">
                  <div
                    className="mini-bar-fill"
                    id="mbar-flood"
                    style={{ background: "var(--sunset-coral)" }}
                  ></div>
                </div>
              </div>
              <div className="metric-row" id="mrow-value" data-metric="value">
                <div className="metric-row-label">Median Home Value</div>
                <div className="metric-row-value" id="mval-value">
                  —
                </div>
                <div className="metric-row-rank" id="mrank-value"></div>
                <div className="mini-bar">
                  <div
                    className="mini-bar-fill"
                    id="mbar-value"
                    style={{ background: "var(--gulf-teal)" }}
                  ></div>
                </div>
              </div>
              <div className="metric-row" id="mrow-permits" data-metric="permits">
                <div className="metric-row-label">New Permits 2024</div>
                <div className="metric-row-value" id="mval-permits">
                  —
                </div>
                <div className="metric-row-rank" id="mrank-permits"></div>
                <div className="mini-bar">
                  <div
                    className="mini-bar-fill"
                    id="mbar-permits"
                    style={{ background: "#4a6fa8" }}
                  ></div>
                </div>
              </div>
              <div className="rail-footer">
                Sources: FEMA NFIP · Zillow ZHVI · Lee/Collier County Permits · Census TIGER 2020
              </div>
            </div>
          </div>

          <div className="map-canvas" id="map-canvas">
            <div className="svg-host" ref={svgHostRef} aria-hidden="false" />
            <div className="map-legend">
              <div className="legend-title" id="legend-title">
                Annual Flood Loss
              </div>
              <div className="legend-bar" id="legend-bar"></div>
              <div className="legend-labels">
                <span id="leg-low"></span>
                <span id="leg-high"></span>
              </div>
            </div>
            <div id="tooltip">
              <div className="tip-zip" id="tip-zip"></div>
              <div className="tip-place" id="tip-place"></div>
              <div className="tip-val" id="tip-val"></div>
            </div>
          </div>
        </div>

        <div className="stats-bar">
          <div className="stat-cell">
            <div className="stat-label">Highest Flood Risk</div>
            <div className="stat-value">33931</div>
            <div className="stat-sub">Fort Myers Beach</div>
            <div className="stat-tag">$30,074 AAL</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Highest Home Value</div>
            <div className="stat-value">34108</div>
            <div className="stat-sub">Pelican Bay, Naples</div>
            <div className="stat-tag">$1.25M median</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Most Active Permits</div>
            <div className="stat-value">34120</div>
            <div className="stat-sub">Golden Gate Estates E</div>
            <div className="stat-tag">423 permits</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">ZIPs Covered</div>
            <div className="stat-value">57</div>
            <div className="stat-sub">Lee + Collier Counties</div>
            <div className="stat-tag">Updated daily</div>
          </div>
        </div>
      </div>
    </section>
  );
}
