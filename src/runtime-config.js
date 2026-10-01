const FILES = Object.freeze({
  providers: "../config/providers.json",
  searchAreas: "../config/search-areas.json",
  communitySources: "../config/community-sources.json",
  exclusions: "../config/exclusions.json",
  uiDefaults: "../config/ui-defaults.json"
});

const fallback = Object.freeze({
  providers:{version:1,providers:[],searchDomains:[],allowedListingHosts:[]},
  searchAreas:{version:1,defaultLocation:"Fort Collins, CO",areas:[]},
  communitySources:{version:1,sources:[]},
  exclusions:{version:1,listingRules:[]},
  uiDefaults:{version:1,pointsOfInterest:[]}
});

let state = fallback;
let loadPromise = null;

async function readJson(relativePath, fallbackValue) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const url = new URL(relativePath, import.meta.url);
    const response = await fetch(url, { cache:"no-store", signal:controller.signal, headers:{Accept:"application/json"} });
    if (!response.ok) return fallbackValue;
    const value = await response.json();
    return value && typeof value === "object" ? value : fallbackValue;
  } catch {
    return fallbackValue;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadRuntimeConfig() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const entries = await Promise.all(Object.entries(FILES).map(async ([key,path]) => [key, await readJson(path, fallback[key])]));
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
