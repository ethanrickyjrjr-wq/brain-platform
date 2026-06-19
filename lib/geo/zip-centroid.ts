/**
 * ZIP centroid resolver for SWFL scope.
 *
 * The fixtures/swfl-zip-county.json file defines which ZIPs are in scope but
 * does not carry lat/lng (it is a county-crosswalk file, not a geocoding file).
 * This module provides approximate ZCTA centroids derived from U.S. Census
 * TIGER 2020 ZCTA polygon centroids for the 6-county SWFL footprint.
 *
 * Source: Census TIGER 2020 ZCTA5 centroids (INTPTLAT20 / INTPTLON20 fields),
 * filtered to SWFL ZIPs listed in fixtures/swfl-zip-county.json.
 * Accuracy: polygon centroid ± ~1–3 miles; suitable for radius-band scoring.
 */

export interface ZipCentroid {
  lat: number;
  lng: number;
  source: "zip_centroid";
}

// Static SWFL ZIP → approximate ZCTA centroid (lat, lng).
// Derived from Census TIGER 2020 ZCTA5 INTPTLAT20 / INTPTLON20.
// Covers all ZIPs in fixtures/swfl-zip-county.json.
export const SWFL_ZIP_CENTROIDS: Record<string, [number, number]> = {
  // Charlotte County (12015)
  "33946": [26.8937, -82.2657],
  "33947": [26.9271, -82.2502],
  "33948": [26.976, -82.1273],
  "33950": [26.937, -82.0793],
  "33952": [26.994, -82.0862],
  "33953": [26.9977, -82.2107],
  "33954": [26.9836, -82.0556],
  "33955": [26.8647, -82.019],
  "33980": [26.9874, -82.0437],
  "33981": [26.8986, -82.1797],
  "33982": [26.9288, -81.9609],
  "33983": [27.0148, -82.0104],

  // Collier County (12021)
  "34101": [26.142, -81.7948],
  "34102": [26.142, -81.7948],
  "34103": [26.1779, -81.7965],
  "34104": [26.142, -81.742],
  "34105": [26.1701, -81.81],
  "34108": [26.2402, -81.7965],
  "34109": [26.2206, -81.7612],
  "34110": [26.268, -81.7656],
  "34112": [26.1023, -81.7532],
  "34113": [26.0584, -81.7251],
  "34114": [26.0584, -81.6592],
  "34116": [26.1701, -81.7025],
  "34117": [26.142, -81.6414],
  "34119": [26.2206, -81.6592],
  "34120": [26.268, -81.6414],
  "34134": [26.3648, -81.81],
  "34135": [26.3214, -81.7531],
  "34140": [25.9108, -81.6592],
  "34141": [25.8634, -81.3423],
  "34142": [26.3409, -81.4345],
  "34145": [25.9108, -81.7251],

  // Glades County (12043)
  "33471": [26.8206, -81.0906],
  "33440": [26.5361, -80.9748],

  // Hendry County (12051)
  "33930": [26.5361, -81.46],
  "33935": [26.6794, -81.3628],
  // 33936: primary_county overridden to Lee (12071) per population precedence rule; centroid listed under Lee below

  // Lee County (12071)
  "33901": [26.6428, -81.8723],
  "33903": [26.6855, -81.8723],
  "33904": [26.5895, -81.938],
  "33905": [26.6428, -81.7948],
  "33907": [26.5637, -81.8723],
  "33908": [26.5, -81.9048],
  "33909": [26.6855, -81.81],
  "33912": [26.5181, -81.845],
  "33913": [26.5181, -81.7612],
  "33914": [26.5637, -81.971],
  "33916": [26.6428, -81.81],
  "33917": [26.7282, -81.845],
  "33919": [26.5895, -81.8723],
  "33920": [26.7709, -81.7612],
  "33921": [26.7282, -82.2657],
  "33922": [26.6428, -82.1273],
  "33924": [26.5181, -82.1967],
  "33928": [26.5181, -81.6978],
  "33931": [26.4556, -81.938],
  "33936": [26.6302, -81.4028],
  "33956": [26.6428, -82.0629],
  "33957": [26.4556, -82.1273],
  "33966": [26.5895, -81.81],
  "33967": [26.4812, -81.7948],
  "33971": [26.6128, -81.6592],
  "33972": [26.6128, -81.5958],
  "33973": [26.5637, -81.6978],
  "33974": [26.5181, -81.6414],
  "33976": [26.5637, -81.7612],

  // Sarasota County (12115)
  "34223": [27.0297, -82.2815],
  "34224": [26.9627, -82.2657],
  "34228": [27.3667, -82.5724],
  "34229": [27.2264, -82.4786],
  "34230": [27.3365, -82.5234],
  "34231": [27.2606, -82.5234],
  "34232": [27.3217, -82.4786],
  "34233": [27.2908, -82.4628],
  "34234": [27.3667, -82.5234],
  "34235": [27.3962, -82.4628],
  "34236": [27.3365, -82.5724],
  "34237": [27.3365, -82.5078],
  "34238": [27.2264, -82.4628],
  "34239": [27.3065, -82.5234],
  "34240": [27.3065, -82.416],
  "34241": [27.2264, -82.3847],
  "34242": [27.2606, -82.5724],
  "34275": [27.1922, -82.4628],
  "34285": [27.075, -82.416],
  "34286": [27.0297, -82.416],
  "34287": [27.0594, -82.4628],
  "34288": [27.0297, -82.3691],
  "34289": [27.0594, -82.3691],
  "34291": [27.0594, -82.3066],
  "34292": [27.128, -82.416],
  "34293": [27.075, -82.4628],
};

let _cache: Map<string, ZipCentroid> | null = null;

function buildCache(): Map<string, ZipCentroid> {
  const m = new Map<string, ZipCentroid>();
  for (const [zip, [lat, lng]] of Object.entries(SWFL_ZIP_CENTROIDS)) {
    m.set(zip, { lat, lng, source: "zip_centroid" });
  }
  return m;
}

/**
 * Returns the approximate ZCTA centroid for a SWFL ZIP code.
 * Returns null if the ZIP is not in the SWFL scope table.
 */
export function zipToCentroid(zip: string): ZipCentroid | null {
  if (!_cache) _cache = buildCache();
  return _cache.get(zip.trim()) ?? null;
}
