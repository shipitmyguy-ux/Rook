const FILTER_DIRECTORY = new URL("../../config/workspace-filters/", import.meta.url);

export async function loadWorkspaceFilter(workspaceId, fetchImpl = fetch) {
  const id = String(workspaceId || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(id)) return null;
  try {
    const response = await fetchImpl(new URL(`${id}.geojson`, FILTER_DIRECTORY), { cache:"no-store" });
    if (!response.ok) return null;
    const collection = await response.json();
    if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) return null;
    const features = collection.features.filter(feature => ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)
      && Array.isArray(feature.geometry.coordinates));
    if (!features.length) return null;
    return { ...collection, features };
  } catch {
    return null;
  }
}

function pointInRing(point, ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > point.lat) !== (yj > point.lat)
      && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  return Array.isArray(rings) && rings.length > 0 && pointInRing(point, rings[0])
    && !rings.slice(1).some(ring => pointInRing(point, ring));
}

export function matchesWorkspaceFilter(property, point, collection) {
  if (!Array.isArray(collection?.features)) return false;
  const criteria = collection?.properties || {};
  const lng = Number(point?.lng ?? point?.longitude ?? point?.[0]);
  const lat = Number(point?.lat ?? point?.latitude ?? point?.[1]);
  if (criteria.listingType && property?.listingType !== criteria.listingType) return false;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  const coordinate = { lng, lat };
  return collection.features.some(({ geometry }) => geometry.type === "Polygon"
    ? pointInPolygon(coordinate, geometry.coordinates)
    : geometry.coordinates.some(polygon => pointInPolygon(coordinate, polygon)));
}

// A listing with unknown facts cannot be claimed to meet a selected limit.
export function matchesWorkspacePreferences(property, preferences = {}) {
  if (preferences.maxPrice > 0 && (!(Number(property.price) > 0) || Number(property.price) > preferences.maxPrice)) return false;
  if (preferences.minBeds > 0 && (property.beds == null || !Number.isFinite(Number(property.beds)) || Number(property.beds) < preferences.minBeds)) return false;
  return true;
}

export async function qualifyWorkspaceListings(rows, collection, resolveCoordinates, onQualified) {
  if (!collection || typeof resolveCoordinates !== "function") return [];
  const checked = await Promise.all((Array.isArray(rows) ? rows : []).map(async property => {
    if (!property || property.listingType !== (collection.properties?.listingType || property.listingType)) return null;
    const point = await resolveCoordinates(property, collection.properties?.location);
    if (!point || !matchesWorkspaceFilter(property, point, collection)) return null;
    const qualified = {
      ...property,
      metadata:{ ...(property.metadata || {}), workspaceId:collection.properties?.workspaceId, mapPoint:{lat:point.lat,lng:point.lng}, workspaceFilter:collection.name }
    };
    onQualified?.(qualified);
    return qualified;
  }));
  return checked.filter(Boolean);
}
