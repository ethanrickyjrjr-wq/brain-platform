/**
 * Thin wrapper around image-charts.com Chart.js API.
 * Pass any Chart.js 2.x config → get back a URL you can drop into an <img> tag.
 * Works in email, PDF, Slack — anywhere that accepts a plain image URL.
 *
 * Docs: https://documentation.image-charts.com/chart.js/
 * Free tier: unlimited requests, small watermark top-right.
 */

const BASE = "https://image-charts.com/chart.js/2.8.0";

export interface ChartOptions {
  /** Width x Height in pixels. Default: "600x300" */
  size?: string;
  /** Background color. Default: "white" */
  background?: string;
  /** Retina 2x — Enterprise plan only. */
  retina?: boolean;
}

/**
 * Build an image-charts URL from any Chart.js 2.x config object.
 *
 * Usage:
 *   const url = chartUrl({ type: 'bar', data: { ... }, options: { ... } })
 *   // → https://image-charts.com/chart.js/2.8.0?c=...&chs=600x300&bkg=white
 *   // embed as: <img src={url} />
 */
export function chartUrl(
  config: object,
  { size = "600x300", background = "white", retina = false }: ChartOptions = {},
): string {
  const params = new URLSearchParams({
    c: JSON.stringify(config),
    chs: size,
    bkg: background,
    ...(retina ? { icretina: "1" } : {}),
  });
  return `${BASE}?${params.toString()}`;
}

// ── Ready-made chart builders ─────────────────────────────────────────────
// Each returns a URL. Add new ones here as needed.

/** Vertical bar chart from a simple label→value map. */
export function barChart(
  data: Record<string, number>,
  opts: ChartOptions & {
    label?: string;
    color?: string;
    title?: string;
  } = {},
): string {
  const { label = "", color = "rgba(30,58,138,0.8)", title, ...chartOpts } = opts;
  return chartUrl(
    {
      type: "bar",
      data: {
        labels: Object.keys(data),
        datasets: [{ label, backgroundColor: color, data: Object.values(data) }],
      },
      options: {
        responsive: false,
        legend: { display: !!label },
        title: title ? { display: true, text: title } : { display: false },
        scales: { yAxes: [{ ticks: { beginAtZero: true } }] },
      },
    },
    chartOpts,
  );
}

/** Horizontal bar chart — good for ranking / comparing named items. */
export function horizontalBarChart(
  data: Record<string, number>,
  opts: ChartOptions & { label?: string; color?: string; title?: string } = {},
): string {
  const { label = "", color = "rgba(27,184,201,0.8)", title, ...chartOpts } = opts;
  return chartUrl(
    {
      type: "horizontalBar",
      data: {
        labels: Object.keys(data),
        datasets: [{ label, backgroundColor: color, data: Object.values(data) }],
      },
      options: {
        responsive: false,
        legend: { display: false },
        title: title ? { display: true, text: title } : { display: false },
        scales: { xAxes: [{ ticks: { beginAtZero: true } }] },
      },
    },
    chartOpts,
  );
}

/** Line chart for time-series data. labels = date strings, values = numbers. */
export function lineChart(
  labels: string[],
  values: number[],
  opts: ChartOptions & { label?: string; color?: string; title?: string; fill?: boolean } = {},
): string {
  const { label = "", color = "rgb(30,58,138)", title, fill = false, ...chartOpts } = opts;
  return chartUrl(
    {
      type: "line",
      data: {
        labels,
        datasets: [{ label, borderColor: color, backgroundColor: color, data: values, fill }],
      },
      options: {
        responsive: false,
        legend: { display: !!label },
        title: title ? { display: true, text: title } : { display: false },
      },
    },
    chartOpts,
  );
}

/** Doughnut chart for share/composition data. */
export function doughnutChart(
  data: Record<string, number>,
  opts: ChartOptions & { title?: string; colors?: string[] } = {},
): string {
  const { title, colors, ...chartOpts } = opts;
  return chartUrl(
    {
      type: "doughnut",
      data: {
        labels: Object.keys(data),
        datasets: [
          {
            data: Object.values(data),
            backgroundColor: colors ?? [
              "rgba(30,58,138,0.8)",
              "rgba(27,184,201,0.8)",
              "rgba(249,115,22,0.8)",
              "rgba(107,114,128,0.8)",
            ],
          },
        ],
      },
      options: {
        responsive: false,
        title: title ? { display: true, text: title } : { display: false },
      },
    },
    chartOpts,
  );
}
