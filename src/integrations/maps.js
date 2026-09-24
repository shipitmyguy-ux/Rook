import { classifyPropertyKind } from "../core/property.js";

const MAPLIBRE_SCRIPT_URL = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js";
const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const OPENFREEMAP_FALLBACK_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
const ROOK_SOURCE_ID = "rook-listings";
const ROOK_LAYER_ID = "rook-listings-points";
const FORT_COLLINS_CENTER = [-105.0844, 40.5853];

let maplibrePromise = null;
// Pan, zoom, hover, selection, and map filter state are intentionally session-only; OpenFreeMap base layers are required for QA and MapLibre v5 uses its browser bundle.
const overviewState = {
  map: null,
  container: null,
  ready: false,
  latestProperties: [],
  latestOptions: {},
  selectedId: null,
  hoveredId: null,
  fittedOnce: false,
  geocodeRun: 0,
  styleFallbackTried: false,
  baseErrorCount: 0
};


let hoverPopup = null;
function showPropertyTooltip(id, coordinates) {
  const property = overviewState.latestProperties.find(p => String(p.id) === String(id));
  if (!property) return;
  hoverPopup?.remove();
  const content = document.createElement("div");
  content.className = "map-tooltip";
  const title = document.createElement("strong");
  title.textContent = property.label || property.address;
  const facts = document.createElement("div");
  facts.textContent = [
    property.price ? "$" + Number(property.price).toLocaleString() + (property.listingType === "buy" ? "" : "/mo") : "Price TBD",
    (property.beds ?? "—") + " bd", (property.baths ?? "—") + " ba"
  ].join(" · ");
  const address = document.createElement("div");
  address.textContent = property.address || "";
  const hint = document.createElement("small");
  hint.textContent = "Click for details and actions";
  content.append(title, facts, address, hint);
  const point = cachedCoordinates(property, overviewState.latestOptions.location);
  if (!coordinates && !point) return;
  hoverPopup = new window.maplibregl.Popup({
    closeButton: false, closeOnClick: false, offset: 12, maxWidth: "260px", className: "rook-hover-popup"
  }).setLngLat(coordinates || [point.lng, point.lat]).setDOMContent(content).addTo(overviewState.map);
}

let detailId = null;
let pinnedDetails = false;
let poiRun = 0;
let poiMarkers = [];
let poiFitted = false;
let userMovedMap = false;

// Map selection is surfaced to app.js, which renders the standard Rook property card.
function showPropertyDetails(id, pinned = false) {
  const property = overviewState.latestProperties.find(p => String(p.id) === String(id));
  const panel = document.querySelector("#map-details");
  if (!property || !panel) return;
  if (pinnedDetails && !pinned && detailId !== String(id)) return;
  detailId = String(id);
  pinnedDetails = pinnedDetails || pinned;
  panel.hidden = false;
  overviewState.container?.dispatchEvent(new CustomEvent("rook:map-select", {
    detail: { id: String(property.id) }
  }));
}

async function updateOverviewPois() {
  const run = ++poiRun;
  const pois = overviewState.latestOptions.pointsOfInterest || [];
  const points = [];
  for (const poi of pois) {
    const query = poi.address || poi.query || poi.location || poi.label;
    const point = validCoordinates(poi) || (query ? await geocode(query) : null);
    if (run !== poiRun) return;
    if (point) points.push({ ...poi, ...point });
  }
  if (run !== poiRun || !overviewState.map) return;
  poiMarkers.forEach(marker => marker.remove());
  poiMarkers = points.map(point => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "overview-poi" + (point.primary ? " overview-poi--primary" : " overview-poi--neutral");
    element.innerHTML = point.primary ? "★" : `<span class="overview-poi__dot" aria-hidden="true">●</span><span class="overview-poi__label">${point.label || "POI"}</span>`;
    element.title = point.label || "Point of interest";
    element.setAttribute("aria-label", point.label || "Point of interest");
    const popupContent = document.createElement("div");
    popupContent.textContent = [point.label, point.address || point.query || point.location].filter(Boolean).join(" · ");
    const popup = new window.maplibregl.Popup({ offset: 18 }).setDOMContent(popupContent);
    return new window.maplibregl.Marker({ element })
      .setLngLat([point.lng, point.lat]).setPopup(popup).addTo(overviewState.map);
  });
  if (!poiFitted && !userMovedMap && points.length) {
    const coords = [
      ...listingGeoJson(overviewState.latestProperties, overviewState.latestOptions.location).features.map(f => f.geometry.coordinates),
      ...points.map(p => [p.lng, p.lat])
    ];
    overviewState.map.fitBounds([
      [Math.min(...coords.map(p => p[0])), Math.min(...coords.map(p => p[1]))],
      [Math.max(...coords.map(p => p[0])), Math.max(...coords.map(p => p[1]))]
    ], { padding: { top: 42, bottom: 55, left: 85, right: 85 }, maxZoom: 13, duration: 0 });
    poiFitted = true;
    overviewState.fittedOnce = true;
  }
}

function addRequiredMapAttribution(map) {
  const control = {
    onAdd() {
      const el = document.createElement("div");
      el.className = "maplibregl-ctrl maplibregl-ctrl-attrib";
      el.innerHTML = '<a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Data from OpenStreetMap</a>';
      this._container = el;
      return el;
    },
    onRemove() {
      this._container?.remove();
      this._container = null;
    }
  };
  map.addControl(control, "bottom-right");
}

function loadMapLibre() {
  if (typeof window !== "undefined" && window.maplibregl?.Map) return Promise.resolve(window.maplibregl);
  if (!maplibrePromise) {
    maplibrePromise = new Promise((resolve, reject) => {
      if (typeof document === "undefined") return reject(new Error("MapLibre requires a browser"));
      const existing = document.querySelector('script[data-rook-maplibre]');
      if (existing) {
        existing.addEventListener("load", () => window.maplibregl?.Map ? resolve(window.maplibregl) : reject(new Error("MapLibre did not initialize")), { once: true });
        existing.addEventListener("error", () => reject(new Error("MapLibre script failed to load")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = MAPLIBRE_SCRIPT_URL;
      script.async = true;
      script.dataset.rookMaplibre = "true";
      script.onload = () => window.maplibregl?.Map ? resolve(window.maplibregl) : reject(new Error("MapLibre did not initialize"));
      script.onerror = () => reject(new Error("MapLibre script failed to load"));
      document.head.appendChild(script);
    });
  }
  return maplibrePromise;
}

export function googleMapsDirectionsUrl(property) {
  const destination = property.address || [property.lat, property.lng].filter(v => v != null).join(",");
  if (!destination) return null;
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination);
}

function mapLocationQuery(property, fallbackLocation = "Fort Collins, CO") {
  if (property?.address) return property.address;
  if (property?.lat != null && property?.lng != null) return `${property.lat},${property.lng}`;
  return [property?.label, fallbackLocation].filter(Boolean).join(", ");
}

function validCoordinates(point) {
  // Missing values must reach geocoding, never Number(null) / Number("") = 0.
  const isNumeric = value => (typeof value === "number" || typeof value === "string")
    && String(value).trim() !== "" && Number.isFinite(Number(value));
  if (!isNumeric(point?.lat) || !isNumeric(point?.lng)) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function cachedCoordinates(property, fallbackLocation = "Fort Collins, CO") {
  const direct = validCoordinates(property);
  if (direct) return direct;
  const q = normalizeQuery(mapLocationQuery(property, fallbackLocation));
  const cached = readGeocodeCache()[q];
  return validCoordinates(cached);
}

function propertyFeature(property, fallbackLocation = "Fort Collins, CO") {
  const point = cachedCoordinates(property, fallbackLocation);
  if (!point) return null;
  const props = {
    id: String(property.id),
    propertyType: classifyPropertyKind(property),
    listingType: property.listingType === "buy" ? "buy" : "rent",
    status: property.status || "new",
    saved: Boolean(property.saved)
  };
  if (Number.isFinite(Number(property.price))) props.price = Number(property.price);
  if (Number.isFinite(Number(property.beds))) props.beds = Number(property.beds);
  return {
    type: "Feature",
    id: String(property.id),
    properties: props,
    geometry: { type: "Point", coordinates: [point.lng, point.lat] }
  };
}

function listingGeoJson(properties = [], fallbackLocation = "Fort Collins, CO") {
  return {
    type: "FeatureCollection",
    features: properties.map(property => propertyFeature(property, fallbackLocation)).filter(Boolean)
  };
}

function mapFilter(options = {}) {
  const filters = ["all"];
  const types = Array.isArray(options.propertyTypes) ? options.propertyTypes.filter(Boolean) : [];
  if (types.length) filters.push(["in", ["get", "propertyType"], ["literal", types]]);
  if (Number(options.minBeds) > 0) filters.push(["any", ["!", ["has", "beds"]], [">=", ["get", "beds"], Number(options.minBeds)]]);
  if (Number(options.maxPrice) > 0) filters.push(["any", ["!", ["has", "price"]], ["<=", ["get", "price"], Number(options.maxPrice)]]);
  if (options.activeFilter === "rent" || options.activeFilter === "buy") filters.push(["==", ["get", "listingType"], options.activeFilter]);
  if (options.activeFilter === "shortlist") filters.push(["==", ["get", "saved"], true]);
  return filters;
}

function applyOverviewFilter() {
  const map = overviewState.map;
  if (!map || !overviewState.ready || !map.getLayer(ROOK_LAYER_ID)) return;
  map.setFilter(ROOK_LAYER_ID, mapFilter(overviewState.latestOptions));
}

function setFeatureStateSafe(id, state) {
  const map = overviewState.map;
  if (!map || !overviewState.ready || !id) return;
  try { map.setFeatureState({ source: ROOK_SOURCE_ID, id: String(id) }, state); } catch {}
}

function clearSelectionState() {
  const previous = overviewState.selectedId;
  overviewState.selectedId = null;
  if (previous) setFeatureStateSafe(previous, { selected: false });
  const source = overviewState.map?.getSource(ROOK_SOURCE_ID);
  if (!source) return;
  for (const property of overviewState.latestProperties) setFeatureStateSafe(property.id, { dimmed: false });
}

function selectFeature(id) {
  if (!id) return;
  const previous = overviewState.selectedId;
  if (previous && previous !== id) setFeatureStateSafe(previous, { selected: false });
  overviewState.selectedId = String(id);
  for (const property of overviewState.latestProperties) {
    setFeatureStateSafe(property.id, {
      selected: String(property.id) === String(id),
      dimmed: String(property.id) !== String(id)
    });
  }
}

function updateOverviewSource({ fit = false } = {}) {
  const map = overviewState.map;
  if (!map || !overviewState.ready) return;
  const fallbackLocation = overviewState.latestOptions.location || "Fort Collins, CO";
  const data = listingGeoJson(overviewState.latestProperties, fallbackLocation);
  const source = map.getSource(ROOK_SOURCE_ID);
  source?.setData(data);
  applyOverviewFilter();

  if (overviewState.selectedId) selectFeature(overviewState.selectedId);
  if (detailId) showPropertyDetails(detailId, pinnedDetails);

  if (fit && !overviewState.fittedOnce && data.features.length) {
    const coords = data.features.map(feature => feature.geometry.coordinates);
    if (coords.length === 1) {
      map.jumpTo({ center: coords[0], zoom: 13 });
    } else {
      const lngs = coords.map(([lng]) => lng);
      const lats = coords.map(([, lat]) => lat);
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
        padding: 42,
        maxZoom: 13,
        duration: 0
      });
    }
    overviewState.fittedOnce = true;
  }
}

async function geocodeMissingOverviewProperties() {
  const run = ++overviewState.geocodeRun;
  const fallbackLocation = overviewState.latestOptions.location || "Fort Collins, CO";
  let changed = false;
  for (const property of overviewState.latestProperties) {
    if (run !== overviewState.geocodeRun) return;
    if (cachedCoordinates(property, fallbackLocation)) continue;
    const point = await geocode(mapLocationQuery(property, fallbackLocation));
    if (run !== overviewState.geocodeRun) return;
    if (point) changed = true;
  }
  if (changed && run === overviewState.geocodeRun) updateOverviewSource({ fit: !overviewState.fittedOnce });
}

function installOverviewLayers(map) {
  if (!map.getSource(ROOK_SOURCE_ID)) {
    map.addSource(ROOK_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });
  }
  if (!map.getLayer(ROOK_LAYER_ID)) {
    map.addLayer({
      id: ROOK_LAYER_ID,
      type: "circle",
      source: ROOK_SOURCE_ID,
      paint: {
        "circle-radius": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 11,
          ["boolean", ["feature-state", "hovered"], false], 9,
          7
        ],
        "circle-color": [
          "match", ["get", "propertyType"],
          "apartment", "#4ba8ff",
          "townhome", "#aa75ff",
          "house", "#4fd59b",
          "#58eadc"
        ],
        "circle-opacity": ["case", ["boolean", ["feature-state", "dimmed"], false], 0.28, 0.94],
        "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.5],
        "circle-stroke-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ffc429", "#07111b"]
      }
    });
  }

  map.on("mouseenter", ROOK_LAYER_ID, event => {
    map.getCanvas().style.cursor = "pointer";
    const id = event.features?.[0]?.properties?.id ?? event.features?.[0]?.id;
    if (overviewState.hoveredId && overviewState.hoveredId !== id) setFeatureStateSafe(overviewState.hoveredId, { hovered: false });
    overviewState.hoveredId = id == null ? null : String(id);
    if (overviewState.hoveredId) setFeatureStateSafe(overviewState.hoveredId, { hovered: true });
    if (id != null) showPropertyTooltip(String(id), event.features?.[0]?.geometry?.coordinates);
  });

  map.on("mouseleave", ROOK_LAYER_ID, () => {
    map.getCanvas().style.cursor = "";
    if (overviewState.hoveredId) setFeatureStateSafe(overviewState.hoveredId, { hovered: false });
    overviewState.hoveredId = null;
    hoverPopup?.remove();
    hoverPopup = null;
  });

  map.on("click", ROOK_LAYER_ID, event => {
    const id = event.features?.[0]?.properties?.id ?? event.features?.[0]?.id;
    if (id == null) return;
    hoverPopup?.remove();
    selectFeature(String(id));
    showPropertyDetails(String(id), true);
  });

  map.on("click", event => {
    const hits = map.queryRenderedFeatures(event.point, { layers: [ROOK_LAYER_ID] });
    if (!hits.length) {
      clearSelectionState();
      detailId = null;
      pinnedDetails = false;
      overviewState.container?.dispatchEvent(new CustomEvent("rook:map-clear"));
    }
  });
}


// Palette from the original card-map artwork in assets/neighborhood.svg.
function applyReferenceMapTheme(map) {
  for (const layer of map.getStyle()?.layers || []) {
    const id = layer.id.toLowerCase();
    if (id === ROOK_LAYER_ID) continue;
    if (layer.type === "symbol") {
      const hasText = layer.layout && layer.layout["text-field"] != null;
      if (hasText) {
        map.setLayoutProperty(layer.id, "visibility", "visible");
        map.setLayerZoomRange(
          layer.id,
          Math.max(Number(layer.minzoom) || 0, 15),
          Number.isFinite(layer.maxzoom) ? layer.maxzoom : 24
        );
        try { map.setPaintProperty(layer.id, "text-color", "#b8c8ce"); } catch {}
        try { map.setPaintProperty(layer.id, "text-halo-color", "#09212a"); } catch {}
        try { map.setPaintProperty(layer.id, "text-halo-width", 1.2); } catch {}
      } else {
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
      continue;
    }
    const water = /water|ocean|river|lake/.test(id);
    const green = /park|wood|forest|grass|landcover|landuse/.test(id);
    const building = /building/.test(id);
    if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", "#09212a");
    if (layer.type === "fill") {
      map.setPaintProperty(layer.id, "fill-color", water ? "#041b31" : green ? "#154134" : building ? "#173332" : "#09212a");
      map.setPaintProperty(layer.id, "fill-outline-color", building ? "#1d4141" : water ? "#041b31" : "#173332");
    }
    if (layer.type === "line") {
      map.setPaintProperty(layer.id, "line-color", water ? "#041b31" : /boundary|admin/.test(id) ? "#28505d" : /casing/.test(id) ? "#28505d" : "#3d6372");
    }
    if (layer.type === "fill-extrusion") map.setPaintProperty(layer.id, "fill-extrusion-color", "#173332");
  }
}

async function ensureOverviewMap(container) {
  if (overviewState.map && overviewState.container === container) return overviewState.map;
  const maplibregl = await loadMapLibre();
  container.replaceChildren();
  container.dataset.mapProvider = "maplibre-openfreemap";

  container.dataset.mapStatus = "loading";
  container.dataset.mapFirstPaint = "pending";
  const map = new maplibregl.Map({
    container,
    style: OPENFREEMAP_STYLE_URL,
    center: FORT_COLLINS_CENTER,
    zoom: 11,
    attributionControl: false,
    dragPan: true,
    scrollZoom: true,
    touchZoomRotate: true,
    doubleClickZoom: true,
    keyboard: true
  });
  addRequiredMapAttribution(map);
  map.on("movestart", event => { if (event.originalEvent) userMovedMap = true; });

  overviewState.map = map;
  overviewState.container = container;
  overviewState.ready = false;
  overviewState.fittedOnce = false;

  const hydrateStyle = () => {
    applyReferenceMapTheme(map);
    overviewState.ready = true;
    installOverviewLayers(map);
    updateOverviewSource({ fit: !overviewState.fittedOnce });
    void geocodeMissingOverviewProperties();
    void updateOverviewPois();
    const reveal = () => {
      if (container.dataset.mapFirstPaint === "ready") return;
      container.dataset.mapFirstPaint = "ready";
      container.dataset.mapStatus = "ready";
    };
    const alreadyLoaded = typeof map.loaded === "function" && map.loaded();
    if (alreadyLoaded) reveal();
    else if (typeof map.once === "function") map.once("idle", reveal);
    else reveal();
    const style = map.getStyle();
    container.dataset.baseLayerCount = String((style?.layers || []).filter(layer => layer.id !== ROOK_LAYER_ID).length);
    container.dataset.baseSourceCount = String(Object.keys(style?.sources || {}).filter(id => id !== ROOK_SOURCE_ID).length);
  };

  map.on("style.load", hydrateStyle);
  map.on("error", event => {
    const message = String(event?.error?.message || event?.error || "");
    container.dataset.mapLastError = message.slice(0, 220);
    overviewState.baseErrorCount += 1;
    if (!overviewState.styleFallbackTried && overviewState.baseErrorCount >= 3) {
      overviewState.styleFallbackTried = true;
      container.dataset.mapStatus = "recovering";
      map.setStyle(OPENFREEMAP_FALLBACK_STYLE_URL);
      return;
    }
    container.dataset.mapStatus = "degraded";
  });
  return map;
}

export function renderPropertyMap(container, properties = [], options = {}) {
  if (!container) return;
  overviewState.latestProperties = [...properties];
  overviewState.latestOptions = { ...options };
  if (overviewState.map && overviewState.container === container && overviewState.ready) {
    updateOverviewSource();
    void geocodeMissingOverviewProperties();
    void updateOverviewPois();
    return;
  }
  void ensureOverviewMap(container).catch(() => {
    container.dataset.mapStatus = "error";
    container.innerHTML = '<div class="property-map__error">Map unavailable</div>';
  });
}

export async function focusPropertyOnMap(property) {
  if (!property) return;
  const container = overviewState.container;
  if (!container) return;
  await ensureOverviewMap(container);
  const fallbackLocation = overviewState.latestOptions.location || "Fort Collins, CO";
  let point = cachedCoordinates(property, fallbackLocation);
  if (!point) {
    point = await geocode(mapLocationQuery(property, fallbackLocation));
    updateOverviewSource();
  }
  if (!point || !overviewState.map) return;
  selectFeature(String(property.id));
  showPropertyDetails(String(property.id), true);
  overviewState.map.easeTo({
    center: [point.lng, point.lat],
    zoom: Math.max(overviewState.map.getZoom(), 14),
    duration: 450
  });
}

const GEOCODE_CACHE_KEY = "rook.geocode-cache.v1";
const GEOCODE_MISS_TTL_MS = 12 * 60 * 60 * 1000;
let geocodeQueue = Promise.resolve();
const geocodeInflight = new Map();
const distanceCache = new Map();

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
  const cachedEntry = readGeocodeCache()[q];
  const cachedPoint = validCoordinates(cachedEntry);
  if (cachedPoint) return cachedPoint;
  if (cachedEntry?.missedAt && Date.now() - Number(cachedEntry.missedAt) < GEOCODE_MISS_TTL_MS) return null;
  if (geocodeInflight.has(q)) return geocodeInflight.get(q);

  const task = geocodeQueue.then(async () => {
    const latestEntry = readGeocodeCache()[q];
    const latestPoint = validCoordinates(latestEntry);
    if (latestPoint) return latestPoint;
    if (latestEntry?.missedAt && Date.now() - Number(latestEntry.missedAt) < GEOCODE_MISS_TTL_MS) return null;
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=" + encodeURIComponent(q);
    try {
      const response = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!response.ok) return null;
      const rows = await response.json();
      const row = rows?.[0];
      if (!row) {
        const next = readGeocodeCache();
        next[q] = { missedAt: Date.now() };
        writeGeocodeCache(next);
        return null;
      }
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
      geocodeInflight.delete(q);
    }
  });
  geocodeInflight.set(q, task);
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

function mapZoom(propertyPoint, primaryPoint) {
  const distance = primaryPoint ? haversineMiles(propertyPoint, primaryPoint) : 0;
  if (distance <= 1) return 14;
  if (distance <= 2.5) return 13;
  if (distance <= 5) return 12;
  if (distance <= 10) return 11;
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
      const primary = `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${zoom}/${x}/${y}@2x.png`;
      const fallback = `https://${sub}.basemaps.cartocdn.com/light_nolabels/${zoom}/${x}/${y}@2x.png`;
      tiles += `<img src="${primary}" data-fallback="${fallback}" alt="" loading="eager" referrerpolicy="no-referrer" style="left:${col * 256}px;top:${row * 256}px" onerror="if(this.dataset.fallback&&this.src!==this.dataset.fallback){this.src=this.dataset.fallback}else{this.style.visibility='hidden'}">`;
    }
  }
  return `<div class="card-map-tiles" style="left:calc(50% - ${offsetX}px);top:calc(50% - ${offsetY}px)">${tiles}</div>`;
}

function markerOffset(point, center, zoom) {
  const dx = (lonToTileX(point.lng, zoom) - lonToTileX(center.lng, zoom)) * 256;
  const dy = (latToTileY(point.lat, zoom) - latToTileY(center.lat, zoom)) * 256;
  return { dx, dy };
}


const cardMapViews = new Map();
export async function updateCardDistance(target, property, primary, fallbackLocation = "Fort Collins, CO") {
  if (!target || !property || !primary) return;
  const propertyQuery = mapLocationQuery(property, fallbackLocation);
  const primaryPointDirect = validCoordinates(primary);
  const primaryQuery = primaryPointDirect ? `${primaryPointDirect.lat},${primaryPointDirect.lng}` : (primary.address || primary.query || primary.location || primary.label);
  const cacheKey = `${normalizeQuery(propertyQuery)}|${normalizeQuery(primaryQuery)}`;
  if (distanceCache.has(cacheKey)) {
    const cachedDistance = distanceCache.get(cacheKey);
    if (target.isConnected) target.textContent = cachedDistance == null ? "Address 1 —" : "Address 1 " + cachedDistance.toFixed(cachedDistance < 10 ? 1 : 0) + " mi";
    return;
  }
  const propertyPoint = cachedCoordinates(property, fallbackLocation) || await geocode(propertyQuery);
  const primaryPoint = primaryPointDirect || await geocode(primaryQuery);
  const distance = propertyPoint && primaryPoint ? haversineMiles(propertyPoint, primaryPoint) : null;
  distanceCache.set(cacheKey, distance);
  if (!target.isConnected) return;
  target.textContent = distance == null ? "Address 1 —" : "Address 1 " + distance.toFixed(distance < 10 ? 1 : 0) + " mi";
}

export async function renderCardMap(container, property, pointsOfInterest = [], fallbackLocation = "Fort Collins, CO") {
  if (!container || !property) return;
  for (const [element, view] of cardMapViews) {
    if (!element.isConnected) {
      view.observer?.disconnect();
      view.map?.remove();
      cardMapViews.delete(element);
    }
  }
  const prior = cardMapViews.get(container);
  prior?.observer?.disconnect();
  prior?.map?.remove();
  const view = { map: null, observer: null };
  cardMapViews.set(container, view);
  const fallbackPoint = { lat: 40.5853, lng: -105.0844 };
  const point = validCoordinates(property) || await geocode(property.address || [property.label, fallbackLocation].join(", "));
  const propertyPoint = point || fallbackPoint;
  const pois = [];
  for (const poi of pointsOfInterest) {
    const resolved = validCoordinates(poi) || await geocode(poi.address || poi.query || poi.location || poi.label);
    if (resolved) pois.push({ ...poi, ...resolved });
  }
  if (!container.isConnected || cardMapViews.get(container) !== view) return;
  const primary = pois.find(p => p.primary);
  const distanceTarget = container.closest(".property-card")?.querySelector("[data-primary-distance]");
  if (distanceTarget) {
    const distance = point && primary ? haversineMiles(point, primary) : null;
    distanceTarget.textContent = distance == null ? "Address 1 —" : "Address 1 " + distance.toFixed(distance < 10 ? 1 : 0) + " mi";
  }
  const center = primary ? [(propertyPoint.lng + primary.lng) / 2, (propertyPoint.lat + primary.lat) / 2] : [propertyPoint.lng, propertyPoint.lat];
  const library = await loadMapLibre();
  const mount = () => {
    if (view.map || !container.isConnected) return;
    container.replaceChildren();
    const map = new library.Map({
      container, style: OPENFREEMAP_STYLE_URL, center,
      zoom: mapZoom(propertyPoint, primary) - 1,
      interactive: false, attributionControl: false
    });
    view.map = map;
    addRequiredMapAttribution(map);
    map.on("style.load", () => {
      applyReferenceMapTheme(map);
      for (const p of [...(point ? [{ ...point, kind: "property" }] : []), ...pois]) {
        const element = document.createElement("span");
        element.className = "map-marker map-marker--" + (p.kind === "property" ? "property" : p.primary ? "primary" : p.kind || "poi");
        element.append(document.createElement("span"));
        new library.Marker({ element }).setLngLat([p.lng, p.lat]).addTo(map);
      }
    });
  };
  if (typeof IntersectionObserver === "undefined") mount();
  else {
    view.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) mount();
        else if (view.map) { view.map.remove(); view.map = null; }
      }
    }, { rootMargin: "150px" });
    view.observer.observe(container);
  }
}

export function openDirections(property) {
  const url = googleMapsDirectionsUrl(property);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}


