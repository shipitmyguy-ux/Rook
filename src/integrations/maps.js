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

function haversineMiles(a, b) {
  const toRad = value => value * Math.PI / 180;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function mapZoom(propertyPoint, poiPoints) {
  const farthest = poiPoints.reduce((max, point) => Math.max(max, haversineMiles(propertyPoint, point)), 0);
  if (farthest <= 1) return 14;
  if (farthest <= 2.5) return 13;
  if (farthest <= 5) return 12;
  if (farthest <= 10) return 11;
  return 10;
}

function lonToTileX(lng, zoom) {
  return ((lng + 180) / 360) * (2 ** zoom);
}

function latToTileY(lat, zoom) {
  const rad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * (2 ** zoom);
}

function tileLayerHtml(center, zoom) {
  const cx = lonToTileX(center.lng, zoom);
  const cy = latToTileY(center.lat, zoom);
  const baseX = Math.floor(cx) - 2;
  const baseY = Math.floor(cy) - 2;
  const offsetX = (cx - Math.floor(cx) + 2) * 256;
  const offsetY = (cy - Math.floor(cy) + 2) * 256;
  let tiles = "";
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const x = baseX + col;
      const y = baseY + row;
      const sub = ["a","b","c","d"][(row + col) % 4];
      const src = `https://${sub}.basemaps.cartocdn.com/dark_nolabels/${zoom}/${x}/${y}@2x.png`;
      tiles += `<img src="${src}" alt="" loading="lazy" style="left:${col * 256}px;top:${row * 256}px">`;
    }
  }
  return `<div class="card-map-tiles" style="left:calc(50% - ${offsetX}px);top:calc(50% - ${offsetY}px)">${tiles}</div>`;
}

function markerOffset(point, center, zoom) {
  const dx = (lonToTileX(point.lng, zoom) - lonToTileX(center.lng, zoom)) * 256;
  const dy = (latToTileY(point.lat, zoom) - latToTileY(center.lat, zoom)) * 256;
  return { dx, dy };
}

export async function renderCardMap(container, property, pointsOfInterest = [], fallbackLocation = "Fort Collins, CO") {
  if (!container || !property) return;
  const propertyQuery = property.address || [property.label, fallbackLocation].filter(Boolean).join(", ");
  container.innerHTML = `<div class="card-map-loading"></div><div class="card-map-shade"></div>`;

  const propertyPoint = property.lat != null && property.lng != null
    ? { lat: Number(property.lat), lng: Number(property.lng), label: property.label || "Property", kind: "property" }
    : await geocode(propertyQuery);
  if (!propertyPoint) return;

  const poiPoints = [];
  for (const poi of pointsOfInterest) {
    const query = poi.address || poi.query || poi.location || poi.label;
    if (!query) continue;
    const point = poi.lat != null && poi.lng != null
      ? { lat: Number(poi.lat), lng: Number(poi.lng) }
      : await geocode(query);
    if (!point) continue;
    poiPoints.push({ ...point, label: poi.label || poi.name || "POI", kind: poi.kind || poi.id || "poi" });
  }

  const zoom = mapZoom(propertyPoint, poiPoints);
  const center = poiPoints.length
    ? {
        lat: (propertyPoint.lat * 1.6 + poiPoints.reduce((sum, p) => sum + p.lat, 0) / poiPoints.length) / 2.6,
        lng: (propertyPoint.lng * 1.6 + poiPoints.reduce((sum, p) => sum + p.lng, 0) / poiPoints.length) / 2.6
      }
    : propertyPoint;

  const propertyPos = markerOffset(propertyPoint, center, zoom);
  const propertyMarker = `<span class="map-marker map-marker--property" style="left:calc(50% + ${propertyPos.dx}px);top:calc(50% + ${propertyPos.dy}px)" title="Property"><span></span></span>`;

  const poiMarkers = poiPoints.map(point => {
    const pos = markerOffset(point, center, zoom);
    const distance = haversineMiles(propertyPoint, point);
    const tone = point.kind === "park" ? "park" : point.kind === "school" ? "school" : "poi";
    return `<span class="map-distance-line" style="--x1:${propertyPos.dx}px;--y1:${propertyPos.dy}px;--x2:${pos.dx}px;--y2:${pos.dy}px"></span><span class="map-marker map-marker--poi map-marker--${tone}" style="left:calc(50% + ${pos.dx}px);top:calc(50% + ${pos.dy}px)" title="${distance.toFixed(distance < 10 ? 1 : 0)} mi"><span></span></span>`;
  }).join("");

  container.innerHTML = `${tileLayerHtml(center, zoom)}<div class="card-map-shade"></div><div class="card-map-markers" aria-hidden="true">${propertyMarker}${poiMarkers}</div>`;
}

export function openDirections(property) {
  const url = googleMapsDirectionsUrl(property);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
