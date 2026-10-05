// Laurel area traced from PSD's current 2026–27 elementary boundary map.
// The district publishes the map as a PDF rather than downloadable GIS features;
// this hand-digitized polygon is approximate and should be verified with PSD's
// address locator for enrollment decisions.
export const LAUREL_BOUNDARY_SOURCE = "https://resources.finalsite.net/images/v1784560656/psdschoolsorg9/tuspewekuelw8xukqxyv/ES_Boundaries.pdf";
export const LAUREL_LOCATOR_URL = "https://schoolbus.psdschools.org/Eligibility";

// [longitude, latitude] in WGS84. Conservative simplified trace of the Laurel
// attendance area on PSD's published elementary map, including its angled edges.
export const LAUREL_ATTENDANCE_POLYGON = Object.freeze([
  [-105.0837, 40.5996],
  [-105.0755, 40.5999],
  [-105.0694, 40.6002],
  [-105.0648, 40.5996],
  [-105.0608, 40.5983],
  [-105.0569, 40.5959],
  [-105.0554, 40.5923],
  [-105.0546, 40.5888],
  [-105.0560, 40.5858],
  [-105.0612, 40.5847],
  [-105.0665, 40.5849],
  [-105.0718, 40.5853],
  [-105.0771, 40.5857],
  [-105.0829, 40.5873],
  [-105.0842, 40.5915],
  [-105.0837, 40.5996]
]);

export function isPointInPolygon(point, polygon = LAUREL_ATTENDANCE_POLYGON) {
  const lng = Number(point?.lng ?? point?.longitude ?? point?.[0]);
  const lat = Number(point?.lat ?? point?.latitude ?? point?.[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Array.isArray(polygon) || polygon.length < 4) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = (yi > lat) !== (yj > lat)
      && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function isLaurelRental(property, point) {
  return property?.listingType === "rent" && isPointInPolygon(point);
}
