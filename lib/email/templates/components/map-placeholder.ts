import { COMPONENT_DEFAULTS, esc } from "./_shared";

// Section 3 (S3) Task 3C — map slot. Renders a static map image when a URL is
// supplied (e.g. a Mapbox static-image URL), otherwise a gray 560×200 placeholder
// box. Covers the {{MAP_URL}} token behavior at the component level for
// data-driven builds.

const MAP_WIDTH = 560;
const MAP_HEIGHT = 200;

export function renderMapPlaceholder(mapUrl?: string): string {
  if (mapUrl && mapUrl.trim().length > 0) {
    return (
      `<img src="${esc(mapUrl.trim())}" width="${MAP_WIDTH}" alt="Map" ` +
      `style="display:block;width:100%;max-width:${MAP_WIDTH}px;height:auto;border:0;" />`
    );
  }
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${MAP_WIDTH}" ` +
    `style="width:${MAP_WIDTH}px;max-width:${MAP_WIDTH}px;border-collapse:collapse;">` +
    `<tr><td align="center" valign="middle" height="${MAP_HEIGHT}" ` +
    `style="height:${MAP_HEIGHT}px;background:#E5E7EB;text-align:center;vertical-align:middle;` +
    `font-family:${COMPONENT_DEFAULTS.font};font-size:14px;font-weight:bold;color:${COMPONENT_DEFAULTS.neutral};">` +
    `Map</td></tr></table>`
  );
}
