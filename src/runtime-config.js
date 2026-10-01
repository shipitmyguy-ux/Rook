import { reportRuntimeError } from "./runtime-errors.js";
const FILES = Object.freeze({
  providers: "../config/providers.json",
  searchAreas: "../config/search-areas.json",
  communitySources: "../config/community-sources.json",
  exclusions: "../config/exclusions.json",
  uiDefaults: "../config/ui-defaults.json",
  properties: "../config/properties.json",
  evidence: "../config/evidence.json"
});

const fallback = Object.freeze({
  providers:{version:1,providers:[],searchDomains:[],allowedListingHosts:[]},
  searchAreas:{version:1,defaultLocation:"Fort Collins, CO",areas:[]},
  communitySources:{version:1,sources:[]},
  exclusions:{version:1,listingRules:[]},
  uiDefaults:{version:1,pointsOfInterest:[]},
  properties:{version:1,properties:[]},
  evidence:{version:1,housingEvidence:[]}
});

let state = fallback;
let loadPromise = null;

function assertHttps(value, label) {
  if (typeof value !== "string" || !value.startsWith("https://")) throw new Error(label + " must be https");
}
function assertUnique(rows = [], key = "id", label = "entry") {
  const seen = new Set();
  for (const row of rows) {
    const value = String(row?.[key] || "");
    if (!value) throw new Error(label + " missing " + key);
    if (seen.has(value)) throw new Error("Duplicate " + label + " " + value);
    seen.add(value);
  }
}
function validateRuntimeValue(key, value) {
  if (!value || typeof value !== "object") throw new Error(key + " must be an object");
  if (key === "providers") {
    const rows = Array.isArray(value.providers) ? value.providers : [];
    if (!rows.length) throw new Error("providers requires at least one provider");
    assertUnique(rows,"id","provider");
    for (const provider of rows) {
      assertHttps(provider.cityFeed,"provider " + provider.id + " cityFeed");
      for (const feed of provider.primaryCategoryFeeds || []) assertHttps(feed.url,"provider "+provider.id+" category feed");
    }
  } else if (key === "searchAreas") {
    if (!value.defaultLocation) throw new Error("searchAreas missing defaultLocation");
    const areas = Array.isArray(value.areas) ? value.areas : [];
    if (!areas.length) throw new Error("searchAreas requires at least one area");
    assertUnique(areas,"id","search area");
    for (const area of areas) {
      if (!Number.isFinite(Number(area.center?.lat)) || !Number.isFinite(Number(area.center?.lng))) throw new Error("search area "+area.id+" missing center");
    }
  } else if (key === "communitySources") {
    assertUnique(value.sources || [],"id","community source");
    for (const source of value.sources || []) {
      if (!String(source.baseAddressTemplate || "").includes("{unit}")) throw new Error("community "+source.id+" missing {unit} template");
      for (const field of ["splitRegex","unitRegex","priceRegex","availableRegex"]) {
        if (!source.parser?.[field]) continue;
        new RegExp(source.parser[field],"i");
      }
    }
  } else if (key === "exclusions") {
    assertUnique(value.listingRules || [],"id","exclusion");
    for (const rule of value.listingRules || []) {
      if (rule.labelRegex) new RegExp(rule.labelRegex,"i");
      if (rule.addressRegex) new RegExp(rule.addressRegex,"i");
    }
  } else if (key === "uiDefaults") {
    assertUnique(value.pointsOfInterest || [],"id","POI");
  } else if (key === "properties") {
    assertUnique(value.properties || [],"id","property");
  } else if (key === "evidence") {
    assertUnique(value.housingEvidence || [],"id","evidence");
  }
  return value;
}

async function readJson(key, relativePath, fallbackValue) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const url = new URL(relativePath, import.meta.url);
    const response = await fetch(url, { cache:"no-store", signal:controller.signal, headers:{Accept:"application/json"} });
    if (!response.ok) throw new Error("Runtime config HTTP " + response.status);
    const value = await response.json();
    return validateRuntimeValue(key, value);
  } catch (error) {
    void reportRuntimeError(error, {
      source:"runtime-config",
      kind:"config-load",
      detail:key,
      recovery:"Used built-in fallback for " + key
    });
    return fallbackValue;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadRuntimeConfig() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const entries = await Promise.all(Object.entries(FILES).map(async ([key,path]) => [key, await readJson(key, path, fallback[key])]));
    state = Object.freeze(Object.fromEntries(entries));
    return state;
  })();
  return loadPromise;
}

export function getRuntimeConfig() {
  return state;
}

export function searchAreaForLocation(location = "") {
  const needle = String(location || state.searchAreas?.defaultLocation || "").trim().toLowerCase();
  const areas = Array.isArray(state.searchAreas?.areas) ? state.searchAreas.areas : [];
  return areas.find(area => (area.aliases || []).some(alias => String(alias).trim().toLowerCase() === needle))
    || areas.find(area => needle && String(area.id || "").toLowerCase() === needle)
    || null;
}

export function runtimePointsOfInterest() {
  return Array.isArray(state.uiDefaults?.pointsOfInterest) ? state.uiDefaults.pointsOfInterest : [];
}

export function runtimeSeedProperties() {
  return Array.isArray(state.properties?.properties) ? state.properties.properties : [];
}

export function runtimePreferenceDefaults() {
  const areaDefault = state.searchAreas?.defaultLocation || null;
  return {
    ...(state.uiDefaults?.preferenceDefaults || {}),
    ...(areaDefault ? { location:areaDefault } : {})
  };
}

export function runtimeHousingEvidence() {
  return Array.isArray(state.evidence?.housingEvidence) ? state.evidence.housingEvidence : [];
}
