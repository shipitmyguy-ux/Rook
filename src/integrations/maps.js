export function googleMapsDirectionsUrl(property) {
  const destination = property.address || [property.lat, property.lng].filter(v => v != null).join(",");
  if (!destination) return null;
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination);
}

function mapLocation(property) {
  if (property?.address) return property.address;
  if (property?.lat != null && property?.lng != null) return `${property.lat},${property.lng}`;
  return null;
}

function usableLocations(properties = []) {
  return [...new Set(properties.map(mapLocation).filter(Boolean))];
}

export function googleMapsEmbedUrl(properties = []) {
  const locations = usableLocations(properties);
  const target = locations[0] || "Fort Collins, CO";
  const zoom = locations.length > 1 ? 12 : 15;
  return "https://www.google.com/maps?q=" + encodeURIComponent(target) + "&z=" + zoom + "&output=embed";
}

export function renderPropertyMap(frame, properties = []) {
  if (!frame) return;
  frame.removeAttribute("srcdoc");
  frame.src = googleMapsEmbedUrl(properties);
  frame.title = properties.length > 1 ? `Map centered on ${properties.length} active properties` : properties.length ? "Property map" : "Rook property map";
}

const GEOCODE_CACHE_KEY = "rook.geocode-cache.v1";
let geocodeQueue = Promise.resolve();

function readGeocodeCache() {
  try { return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}"); }
  catch { return {}; }
}

function writeGeocodeCache(cache) {
  try { localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache)); }
  catch {}
}

function normalizeQuery(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

async function geocode(query) {
  const q = normalizeQuery(query);
  if (!q) return null;
  const cache = readGeocodeCache();
  if (cache[q]) return cache[q];

  const task = geocodeQueue.then(async () => {
    const cached = readGeocodeCache()[q];
    if (cached) return cached;
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=" + encodeURIComponent(q);
    try {
      const response = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!response.ok) return null;
      const rows = await response.json();
      const row = rows?.[0];
      if (!row) return null;
      const value = { lat: Number(row.lat), lng: Number(row.lon) };
      if (!Number.isFinite(value.lat) || !Number.isFinite(value.lng)) return null;
      const next = readGeocodeCache();
      next[q] = value;
      writeGeocodeCache(next);
      return value;
    } catch {
      return null;
    } finally {
      await new Promise(resolve => setTimeout(resolve, 1050));
    }
  });
  geocodeQueue = task.catch(() => null);
  return task;
}

function markerPosition(point, bounds) {
  const x = ((point.lng - bounds.west) / (bounds.east - bounds.west || 1)) * 100;
  const y = (1 - (point.lat - bounds.south) / (bounds.north - bounds.south || 1)) * 100;
  return { x: Math.max(4, Math.min(96, x)), y: Math.max(5, Math.min(95, y)) };
}

function mapBounds(points) {
  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  let south = Math.min(...lats), north = Math.max(...lats), west = Math.min(...lngs), east = Math.max(...lngs);
  const latSpan = Math.max(0.018, north - south);
  const lngSpan = Math.max(0.026, east - west);
  const latPad = latSpan * 0.34;
  const lngPad = lngSpan * 0.34;
  south -= latPad; north += latPad; west -= lngPad; east += lngPad;
  return { south, north, west, east };
}

function osmEmbedUrl(bounds) {
  const bbox = [bounds.west, bounds.south, bounds.east, bounds.north].join(",");
  return "https://www.openstreetmap.org/export/embed.html?bbox=" + encodeURIComponent(bbox) + "&layer=mapnik";
}

export async function renderCardMap(container, property, pointsOfInterest = [], fallbackLocation = "Fort Collins, CO") {
  if (!container || !property) return;
  const propertyQuery = property.address || [property.label, fallbackLocation].filter(Boolean).join(", ");
  container.innerHTML = `<iframe class="card-map-frame" loading="lazy" referrerpolicy="no-referrer" title="Map for ${String(property.label || "property").replace(/"/g, "&quot;")}" src="${googleMapsEmbedUrl([{ ...property, address: propertyQuery }])}"></iframe><div class="card-map-shade"></div>`;

  const propertyPoint = property.lat != null && property.lng != null
    ? { lat: Number(property.lat), lng: Number(property.lng), label: property.label || "Property", kind: "property" }
    : await geocode(propertyQuery);
  if (!propertyPoint) return;
  propertyPoint.label = property.label || "Property";
  propertyPoint.kind = "property";

  const poiPoints = [];
  for (const poi of pointsOfInterest) {
    const query = poi.address || poi.query || poi.location || poi.label;
    if (!query) continue;
    const point = poi.lat != null && poi.lng != null ? { lat: Number(poi.lat), lng: Number(poi.lng) } : await geocode(query);
    if (!point) continue;
    poiPoints.push({ ...point, label: poi.label || poi.name || "POI", kind: poi.kind || poi.id || "poi" });
  }

  const allPoints = [propertyPoint, ...poiPoints];
  const bounds = mapBounds(allPoints);
  const markers = allPoints.map((point, index) => {
    const pos = markerPosition(point, bounds);
    const cls = index === 0 ? "map-marker map-marker--property" : "map-marker map-marker--poi";
    return `<span class="${cls}" style="left:${pos.x}%;top:${pos.y}%" title="${String(point.label).replace(/"/g, "&quot;")}"><span></span><small>${String(point.label)}</small></span>`;
  }).join("");

  container.innerHTML = `<iframe class="card-map-frame" loading="lazy" referrerpolicy="no-referrer" title="Neighborhood map for ${String(property.label || "property").replace(/"/g, "&quot;")}" src="${osmEmbedUrl(bounds)}"></iframe><div class="card-map-shade"></div><div class="card-map-markers" aria-hidden="true">${markers}</div>`;
}

export function openDirections(property) {
  const url = googleMapsDirectionsUrl(property);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
