import { classifyPropertyKind } from "../core/property.js";
import { resolvePoiStyle, poiGlyph, poiColorHex } from "../core/poi-style.js";
import { config } from "../config.js";

const MAPLIBRE_SCRIPT_URL = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js";
const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const OPENFREEMAP_FALLBACK_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
const ROOK_SOURCE_ID = "rook-listings";
const ROOK_LAYER_ID = "rook-listings-symbols";
const ROOK_HALO_LAYER_ID = "rook-listings-halo";
const FORT_COLLINS_CENTER = [-105.0844, 40.5853];

let maplibrePromise = null;
// Pan, zoom, hover, selection, and map filter state are intentionally session-only; OpenFreeMap base layers are required for QA and property markers use WebGL symbol icons.
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
    const query = poiLocationQuery(poi, overviewState.latestOptions.location);
    const point = validCoordinates(poi) || (query ? await geocode(query) : null);
    if (run !== poiRun) return;
    if (point) points.push({ ...poi, ...point });
  }
  if (run !== poiRun || !overviewState.map) return;
  poiMarkers.forEach(marker => marker.remove());
  poiMarkers = points.map((point, index) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "overview-poi" + (point.primary ? " overview-poi--primary" : " overview-poi--neutral");
    const style = resolvePoiStyle(point, index);
    const glyph = point.primary ? "★" : poiGlyph(style.icon);
    const displayAddress = point.address || point.query || point.location || point.label || "Saved address";
    element.innerHTML = glyph;
    element.style?.setProperty?.("--poi-color", poiColorHex(style.color));
    element.title = displayAddress;
    element.setAttribute("aria-label", displayAddress);
    const popupContent = document.createElement("div");
    popupContent.textContent = displayAddress;
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

export function mapLocationQueries(property, fallbackLocation = "Fort Collins, CO") {
  if (validCoordinates(property)) return [];
  const values = [];
  const push = value => {
    const q = normalizeQuery(value);
    if (q && !values.includes(q)) values.push(q);
  };
  const address = String(property?.address || "").trim();
  const metadataAddress = String(property?.metadata?.address || property?.metadata?.streetAddress || "").trim();
  const label = String(property?.label || "").trim();

  push(address);
  // Unit/suite identifiers frequently make otherwise valid residential addresses fail geocoding.
  if (address) {
    push(address
      .replace(/\s+(?:unit|apt|apartment|suite|#)\s*[A-Za-z0-9-]+(?=,|$)/i, "")
      .replace(/\s+#?[A-Za-z]\d+[A-Za-z0-9-]*(?=,|$)/i, "")
      .replace(/\s{2,}/g, " ")
      .trim());
  }
  push(metadataAddress);
  if (label) push([label, fallbackLocation].filter(Boolean).join(", "));
  return values;
}

function mapLocationQuery(property, fallbackLocation = "Fort Collins, CO") {
  return mapLocationQueries(property, fallbackLocation)[0] || "";
}

export function poiLocationQuery(poi = {}, fallbackLocation = "Fort Collins, CO") {
  const raw = String(poi.address || poi.query || poi.location || poi.label || "").trim();
  if (!raw) return "";
  const hasContext = raw.includes(",") || /\b(?:co|colorado)\b/i.test(raw) || /\b\d{5}(?:-\d{4})?\b/.test(raw);
  return hasContext || !fallbackLocation ? raw : [raw, fallbackLocation].filter(Boolean).join(", ");
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
  const cache = readGeocodeCache();
  for (const q of mapLocationQueries(property, fallbackLocation)) {
    const cached = validCoordinates(cache[q]);
    if (cached) return cached;
  }
  return null;
}

async function geocodeProperty(property, fallbackLocation = "Fort Collins, CO") {
  const direct = validCoordinates(property);
  if (direct) return direct;
  for (const q of mapLocationQueries(property, fallbackLocation)) {
    const point = await geocode(q);
    if (point) return point;
  }
  return null;
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
  // When the caller supplies the visible list, the GeoJSON is already filtered.
  // Do not apply a second, map-only filter that can make visible cards disappear.
  if (options.dataAlreadyFiltered) return ["all"];
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
  if (overviewState.container) {
    overviewState.container.dataset.mapExpectedPropertyCount = String(overviewState.latestProperties.length);
    overviewState.container.dataset.mapFeatureCount = String(data.features.length);
    overviewState.container.dataset.mapUnresolvedCount = String(Math.max(0, overviewState.latestProperties.length - data.features.length));
  }
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
  const fallbackLocation = overviewState.latestOptions.location || "Fort Collins, CO";
  const properties = [...overviewState.latestProperties];
  const missing = properties.filter(property => !cachedCoordinates(property, fallbackLocation));
  if (!missing.length) {
    updateOverviewSource({ fit: !overviewState.fittedOnce });
    return;
  }

  // Never cancel an older geocode pass just because store/UI state re-rendered.
  // geocode() already deduplicates and serializes requests; each resolved property
  // is published immediately so late-list properties cannot starve forever.
  await Promise.all(missing.map(async property => {
    const point = await geocodeProperty(property, fallbackLocation);
    if (point) updateOverviewSource({ fit: !overviewState.fittedOnce });
  }));
  updateOverviewSource({ fit: !overviewState.fittedOnce });
}

function propertyIconCanvas(kind, color) {
  if (typeof document === "undefined") return null;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#07111b";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (kind === "apartment") {
    ctx.fillRect(15, 8, 34, 48);
    ctx.beginPath();
    for (const y of [18, 29, 40]) {
      ctx.moveTo(23, y); ctx.lineTo(29, y);
      ctx.moveTo(35, y); ctx.lineTo(41, y);
    }
    ctx.moveTo(28, 56); ctx.lineTo(28, 47); ctx.lineTo(36, 47); ctx.lineTo(36, 56);
    ctx.stroke();
  } else if (kind === "townhome") {
    ctx.beginPath();
    ctx.moveTo(6, 28); ctx.lineTo(18, 12); ctx.lineTo(30, 28); ctx.lineTo(30, 56); ctx.lineTo(6, 56); ctx.closePath();
    ctx.moveTo(30, 28); ctx.lineTo(42, 12); ctx.lineTo(58, 28); ctx.lineTo(58, 56); ctx.lineTo(30, 56); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(13, 36); ctx.lineTo(23, 36);
    ctx.moveTo(37, 36); ctx.lineTo(49, 36);
    ctx.moveTo(16, 56); ctx.lineTo(16, 46); ctx.lineTo(22, 46); ctx.lineTo(22, 56);
    ctx.moveTo(40, 56); ctx.lineTo(40, 46); ctx.lineTo(46, 46); ctx.lineTo(46, 56);
    ctx.stroke();
  } else if (kind === "house") {
    ctx.beginPath();
    ctx.moveTo(7, 29); ctx.lineTo(32, 7); ctx.lineTo(57, 29); ctx.lineTo(57, 56); ctx.lineTo(7, 56); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.rect(16, 34, 10, 10);
    ctx.rect(38, 34, 10, 10);
    ctx.moveTo(29, 56); ctx.lineTo(29, 44); ctx.lineTo(37, 44); ctx.lineTo(37, 56);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(32, 7); ctx.lineTo(56, 32); ctx.lineTo(32, 57); ctx.lineTo(8, 32); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(20, 32); ctx.lineTo(44, 32);
    ctx.moveTo(32, 20); ctx.lineTo(32, 44);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

function ensurePropertyTypeIcons(map) {
  if (typeof map.addImage !== "function") return;
  const icons = [
    ["rook-property-apartment", "apartment", "#4ba8ff"],
    ["rook-property-townhome", "townhome", "#aa75ff"],
    ["rook-property-house", "house", "#4fd59b"],
    ["rook-property-generic", "rental", "#58eadc"]
  ];
  for (const [name, kind, color] of icons) {
    if (typeof map.hasImage === "function" && map.hasImage(name)) continue;
    const canvas = propertyIconCanvas(kind, color);
    if (canvas) map.addImage(name, canvas, { pixelRatio: 2 });
  }
}

function installOverviewLayers(map) {
  if (!map.getSource(ROOK_SOURCE_ID)) {
    map.addSource(ROOK_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });
  }

  ensurePropertyTypeIcons(map);

  if (!map.getLayer(ROOK_HALO_LAYER_ID)) {
    map.addLayer({
      id: ROOK_HALO_LAYER_ID,
      type: "circle",
      source: ROOK_SOURCE_ID,
      paint: {
        "circle-radius": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 15,
          ["boolean", ["feature-state", "hovered"], false], 12,
          0
        ],
        "circle-color": "#ffc429",
        "circle-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 0.3,
          ["boolean", ["feature-state", "hovered"], false], 0.2,
          0
        ],
        "circle-stroke-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 2,
          ["boolean", ["feature-state", "hovered"], false], 1,
          0
        ],
        "circle-stroke-color": "#ffc429"
      }
    });
  }

  if (!map.getLayer(ROOK_LAYER_ID)) {
    map.addLayer({
      id: ROOK_LAYER_ID,
      type: "symbol",
      source: ROOK_SOURCE_ID,
      layout: {
        "icon-image": [
          "match", ["get", "propertyType"],
          "apartment", "rook-property-apartment",
          "townhome", "rook-property-townhome",
          "house", "rook-property-house",
          "rook-property-generic"
        ],
        "icon-size": 0.62,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "center"
      },
      paint: {
        "icon-opacity": [
          "case",
          ["boolean", ["feature-state", "dimmed"], false], 0.3,
          0.96
        ]
      }
    });
  }

  if (overviewState.container) overviewState.container.dataset.mapMarkerMode = "property-icons";

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
export function mapLandLayerKind(layerId = "") {
  const id = String(layerId || "").toLowerCase();
  if (/water|ocean|river|lake/.test(id)) return "water";
  if (/park|recreation|recreation_ground|playground|garden|greenway/.test(id)) return "park";
  if (/wood|forest|grass|meadow|scrub|landcover|landuse|farmland|farm|orchard/.test(id)) return "vegetation";
  if (/building/.test(id)) return "building";
  return "base";
}

function applyReferenceMapTheme(map) {
  for (const layer of map.getStyle()?.layers || []) {
    const id = layer.id.toLowerCase();
    if (id === ROOK_LAYER_ID) continue;
    const kind = mapLandLayerKind(id);
    if (layer.type === "symbol") {
      const hasText = layer.layout && layer.layout["text-field"] != null;
      if (hasText) {
        map.setLayoutProperty(layer.id, "visibility", "visible");
        map.setLayerZoomRange(
          layer.id,
          Math.max(Number(layer.minzoom) || 0, kind === "park" ? 11 : 15),
          Number.isFinite(layer.maxzoom) ? layer.maxzoom : 24
        );
        try { map.setPaintProperty(layer.id, "text-color", kind === "park" ? "#c8e7cf" : "#b8c8ce"); } catch {}
        try { map.setPaintProperty(layer.id, "text-halo-color", "#09212a"); } catch {}
        try { map.setPaintProperty(layer.id, "text-halo-width", kind === "park" ? 1.6 : 1.2); } catch {}
      } else {
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
      continue;
    }
    if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", "#09212a");
    if (layer.type === "fill") {
      const fillColor =
        kind === "water" ? "#041b31" :
        kind === "park" ? "#174b36" :
        kind === "vegetation" ? "#0d2a29" :
        kind === "building" ? "#173332" :
        "#09212a";
      const outlineColor =
        kind === "park" ? "#2b7250" :
        kind === "building" ? "#1d4141" :
        kind === "water" ? "#041b31" :
        "#173332";
      map.setPaintProperty(layer.id, "fill-color", fillColor);
      map.setPaintProperty(layer.id, "fill-outline-color", outlineColor);
    }
    if (layer.type === "line") {
      map.setPaintProperty(layer.id, "line-color",
        kind === "park" ? "#2b7250" :
        kind === "water" ? "#041b31" :
        /boundary|admin/.test(id) ? "#28505d" :
        /casing/.test(id) ? "#28505d" :
        "#3d6372"
      );
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
    point = await geocodeProperty(property, fallbackLocation);
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

const GEOCODE_CACHE_KEY = "rook.geocode-cache.v2";
const LEGACY_GEOCODE_CACHE_KEY = "rook.geocode-cache.v1";
const GEOCODE_MISS_TTL_MS = 20 * 60 * 1000;
let geocodeQueue = Promise.resolve();
const geocodeInflight = new Map();
const DISTANCE_CACHE_KEY = "rook.distance-cache.v1";
const distanceCache = new Map();
const distanceInflight = new Map();

function readDistanceCache() {
  try { return JSON.parse(localStorage.getItem(DISTANCE_CACHE_KEY) || "{}"); }
  catch { return {}; }
}

function writeDistanceCache(cache) {
  try { localStorage.setItem(DISTANCE_CACHE_KEY, JSON.stringify(cache)); }
  catch {}
}

function distanceKey(property, poi, fallbackLocation = "Fort Collins, CO") {
  const propertyPoint = validCoordinates(property);
  const propertyQuery = propertyPoint ? `${propertyPoint.lat},${propertyPoint.lng}` : mapLocationQuery(property, fallbackLocation);
  const poiPoint = validCoordinates(poi);
  const poiQuery = poiPoint ? `${poiPoint.lat},${poiPoint.lng}` : (poi.address || poi.query || poi.location || poi.label || poi.id || "");
  return `${normalizeQuery(propertyQuery)}|${normalizeQuery(poiQuery)}`;
}

function cachedDistanceValue(key) {
  if (distanceCache.has(key)) return distanceCache.get(key);
  const persisted = readDistanceCache();
  if (!Object.prototype.hasOwnProperty.call(persisted, key)) return undefined;
  const value = persisted[key];
  distanceCache.set(key, value);
  return value;
}

function storeDistanceValue(key, value) {
  distanceCache.set(key, value);
  const persisted = readDistanceCache();
  persisted[key] = value;
  writeDistanceCache(persisted);
}

function readGeocodeCache() {
  try {
    const current = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}");
    if (Object.keys(current).length) return current;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_GEOCODE_CACHE_KEY) || "{}");
    const migrated = {};
    for (const [key, value] of Object.entries(legacy)) {
      const point = validCoordinates(value);
      if (point) migrated[key] = point;
    }
    if (Object.keys(migrated).length) localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch { return {}; }
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

export function normalizePoiSearchCandidate(row = {}, originalQuery = "") {
  const lat = Number(row.lat), lng = Number(row.lon ?? row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const displayName = String(row.display_name || row.address || row.name || originalQuery || "").trim();
  const named = String(row.namedetails?.name || row.name || "").trim();
  const firstPart = displayName.split(",")[0]?.trim() || "";
  const label = named || firstPart || String(originalQuery || "Saved place").trim();
  return {
    label,
    address: displayName || label,
    query: String(originalQuery || label).trim(),
    lat,
    lng,
    placeType: row.type || row.addresstype || row.class || null,
    source: "OpenStreetMap"
  };
}

export function poiSearchQueries(query, fallbackLocation = "Fort Collins, CO") {
  const raw = normalizeQuery(query);
  if (!raw) return [];
  const hasRoadSuffix = /\b(?:st|street|rd|road|dr|drive|ln|lane|way|ct|court|ave|avenue|blvd|boulevard|pkwy|parkway|pl|place|cir|circle|trl|trail)\.?$/i.test(raw);
  const values = [];
  const add = value => {
    const scoped = poiLocationQuery({ query:value }, fallbackLocation);
    if (scoped && !values.includes(scoped)) values.push(scoped);
  };
  add(raw);
  if (!hasRoadSuffix) {
    for (const suffix of ["Drive","Road","Street","Way","Lane","Court","Avenue","Place","Trail"]) add(raw + " " + suffix);
  }
  return values;
}

export async function searchPoiCandidates(query, fallbackLocation = "Fort Collins, CO", limit = 5) {
  const queries = poiSearchQueries(query, fallbackLocation);
  if (!queries.length) return [];
  const safeLimit = Math.max(1, Math.min(5, Number(limit) || 5));

  if (config.listings?.endpoint) {
    try {
      const endpoint = new URL(config.listings.endpoint, typeof window !== "undefined" ? window.location.href : "http://localhost/");
      endpoint.searchParams.set("poi", "1");
      endpoint.searchParams.set("query", String(query || "").trim());
      endpoint.searchParams.set("location", fallbackLocation || config.search.location);
      endpoint.searchParams.set("limit", String(safeLimit));
      const response = await fetch(endpoint, { headers:{ "Accept":"application/json" } });
      if (response.ok) {
        const payload = await response.json();
        const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
        if (candidates.length) return candidates.slice(0, safeLimit);
      }
    } catch {}
  }
  const task = geocodeQueue.then(async () => {
    const found = [];
    const seen = new Set();
    const fetchRows = async q => {
      const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&dedupe=1&countrycodes=us&limit=" + safeLimit + "&q=" + encodeURIComponent(q);
      try {
        const response = await fetch(url, { headers: { "Accept": "application/json" } });
        if (!response.ok) return [];
        const rows = await response.json();
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    };

    for (let index = 0; index < queries.length && found.length < safeLimit; index += 1) {
      const q = queries[index];
      const rows = await fetchRows(q);
      for (const row of rows) {
        const candidate = normalizePoiSearchCandidate(row, query);
        if (!candidate) continue;
        const key = (candidate.address || "").toLowerCase() + "|" + candidate.lat.toFixed(5) + "|" + candidate.lng.toFixed(5);
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ ...candidate, matchedQuery:q });
        if (found.length >= safeLimit) break;
      }
      if (found.length >= safeLimit) break;
      if (index < queries.length - 1) await new Promise(resolve => setTimeout(resolve, 1050));
    }

    const locationTokens = String(fallbackLocation || "").toLowerCase().split(/[,\s]+/).filter(token => token.length > 2);
    const needle = String(query || "").trim().toLowerCase();
    return found.sort((a,b) => {
      const aText = (a.address || "").toLowerCase(), bText = (b.address || "").toLowerCase();
      const aLocal = locationTokens.reduce((score, token) => score + (aText.includes(token) ? 1 : 0), 0);
      const bLocal = locationTokens.reduce((score, token) => score + (bText.includes(token) ? 1 : 0), 0);
      const aMatch = needle && (a.label || a.address || "").toLowerCase().includes(needle) ? 1 : 0;
      const bMatch = needle && (b.label || b.address || "").toLowerCase().includes(needle) ? 1 : 0;
      return (bLocal - aLocal) || (bMatch - aMatch);
    }).slice(0, safeLimit);
  }).finally(async () => {
    await new Promise(resolve => setTimeout(resolve, 1050));
  });
  geocodeQueue = task.catch(() => []);
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
export function getCachedPropertyDistances(property, pointsOfInterest = [], fallbackLocation = "Fort Collins, CO") {
  return pointsOfInterest.map((poi, index) => {
    const key = distanceKey(property, poi, fallbackLocation);
    const value = cachedDistanceValue(key);
    const style = resolvePoiStyle(poi, index);
    return {
      id: poi.id || `address-${index + 1}`,
      label: poi.label || `Address ${index + 1}`,
      address: poi.address || poi.query || poi.location || "",
      icon: style.icon,
      color: style.color,
      distance: value === undefined ? null : value,
      resolved: value !== undefined
    };
  });
}

export async function resolvePropertyDistances(property, pointsOfInterest = [], fallbackLocation = "Fort Collins, CO") {
  if (!property || !pointsOfInterest.length) return [];
  const propertyPoint = cachedCoordinates(property, fallbackLocation) || await geocodeProperty(property, fallbackLocation);
  return Promise.all(pointsOfInterest.map(async (poi, index) => {
    const key = distanceKey(property, poi, fallbackLocation);
    const cached = cachedDistanceValue(key);
    if (cached !== undefined) {
      const style = resolvePoiStyle(poi, index);
      return {
        id: poi.id || `address-${index + 1}`,
        label: poi.label || `Address ${index + 1}`,
        address: poi.address || poi.query || poi.location || "",
        icon: style.icon,
        color: style.color,
        distance: cached,
        resolved: true
      };
    }
    if (distanceInflight.has(key)) return distanceInflight.get(key);

    const task = (async () => {
      const poiPoint = validCoordinates(poi) || await geocode(poiLocationQuery(poi, fallbackLocation));
      const distance = propertyPoint && poiPoint ? haversineMiles(propertyPoint, poiPoint) : null;
      storeDistanceValue(key, distance);
      const style = resolvePoiStyle(poi, index);
      return {
        id: poi.id || `address-${index + 1}`,
        label: poi.label || `Address ${index + 1}`,
        address: poi.address || poi.query || poi.location || "",
        icon: style.icon,
        color: style.color,
        distance,
        resolved: true
      };
    })().finally(() => distanceInflight.delete(key));
    distanceInflight.set(key, task);
    return task;
  }));
}

export async function updateCardDistances(target, property, pointsOfInterest = [], fallbackLocation = "Fort Collins, CO") {
  if (!target || !property || !pointsOfInterest.length || target.dataset.distanceResolved === "true") return;
  const distances = await resolvePropertyDistances(property, pointsOfInterest, fallbackLocation);
  if (!target.isConnected) return;
  target.dispatchEvent(new CustomEvent("rook:distances-resolved", { bubbles: true, detail: { distances, propertyId: String(property.id) } }));
  target.dataset.distanceResolved = "true";
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
    const resolved = validCoordinates(poi) || await geocode(poiLocationQuery(poi, fallbackLocation));
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
      for (const [index, p] of [...(point ? [{ ...point, kind: "property" }] : []), ...pois].entries()) {
        const element = document.createElement("span");
        element.className = "map-marker map-marker--" + (p.kind === "property" ? "property" : p.primary ? "primary" : p.kind || "poi");
        const marker = document.createElement("span");
        if (p.kind !== "property") {
          const style = resolvePoiStyle(p, Math.max(0, index - (point ? 1 : 0)));
          marker.textContent = p.primary ? "★" : poiGlyph(style.icon);
          marker.style?.setProperty?.("--poi-color", poiColorHex(style.color));
        }
        element.append(marker);
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


