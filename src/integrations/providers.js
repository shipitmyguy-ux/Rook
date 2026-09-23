import { config } from "../config.js";

// Provider adapters normalize every source into the same Rook property shape.
// Network-specific scraping/API logic belongs in adapters, never in the UI.
export const providers = new Map();

export function registerProvider(provider) {
  if (!provider?.id || typeof provider.search !== "function") throw new Error("Invalid property provider");
  providers.set(provider.id, provider);
}

export function unregisterProvider(id) {
  providers.delete(id);
}

export function clearProviders() {
  providers.clear();
}

export function canonicalAddress(value = "") {
  return String(value).toLowerCase()
    .replace(/\b(street)\b/g, "st").replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd").replace(/\b(drive)\b/g, "dr")
    .replace(/\b(lane)\b/g, "ln").replace(/\b(court)\b/g, "ct")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/[^a-z0-9]/g, "");
}

export function listingIdentity(input = {}) {
  const address = canonicalAddress(input.address);
  if (address) return `address:${address}`;
  const lat = Number(input.lat), lng = Number(input.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `geo:${lat.toFixed(4)},${lng.toFixed(4)}`;
  return input.sourceUrl || input.url || input.id || input.label || null;
}

export function normalizeProviderResult(input = {}, provider = {}) {
  const price = Number(input.price);
  const beds = Number(input.beds);
  const baths = Number(input.baths);
  const sourceUrl = input.sourceUrl || input.url || null;
  const stableKey = listingIdentity(input);
  return {
    ...input,
    id: stableKey ? `${provider.id || "provider"}:${String(stableKey).trim().toLowerCase()}` : undefined,
    label: input.label || input.address || "Untitled property",
    address: input.address || "",
    type: input.type || "Property",
    listingType: input.listingType === "buy" ? "buy" : "rent",
    price: Number.isFinite(price) ? price : null,
    beds: Number.isFinite(beds) ? beds : null,
    baths: Number.isFinite(baths) ? baths : null,
    source: input.source || provider.label || provider.id || null,
    sourceUrl,
    metadata: { ...(input.metadata || {}), providerId: provider.id || null }
  };
}

export function matchesSearchDefaults(property, criteria = {}) {
  const minBeds = criteria.minBeds ?? config.search.minBeds;
  if (minBeds && property.beds != null && property.beds < minBeds) return false;
  const maxPrice = criteria.maxPrice;
  if (maxPrice && property.listingType === "rent" && property.price != null && property.price > maxPrice) return false;
  const text = [property.label, property.address, property.type, property.note, property.metadata?.description]
    .filter(Boolean).join(" ").toLowerCase();
  if ((criteria.excludeIncomeRestricted ?? config.search.excludeIncomeRestricted) &&
      /(income[- ]restricted|income limits?|affordable housing|section 8)/i.test(text)) return false;
  if ((criteria.excludeMobileHomes ?? config.search.excludeMobileHomes) &&
      /(mobile home|manufactured home|trailer park)/i.test(text)) return false;
  return true;
}

export function dedupeProviderResults(rows = []) {
  const merged = new Map();
  for (const row of rows) {
    const key = listingIdentity(row);
    if (!key) continue;
    const prior = merged.get(key);
    if (!prior) {
      merged.set(key, { ...row, metadata: { ...(row.metadata || {}), sources: row.source ? [row.source] : [] } });
      continue;
    }
    const sources = [...new Set([...(prior.metadata?.sources || []), ...(row.metadata?.sources || []), row.source].filter(Boolean))];
    merged.set(key, {
      ...prior,
      ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== "")),
      id: prior.id,
      sourceUrl: prior.sourceUrl || row.sourceUrl,
      metadata: { ...(prior.metadata || {}), ...(row.metadata || {}), sources }
    });
  }
  return [...merged.values()];
}

export async function searchProviders(criteria = {}) {
  const active = [...providers.values()].filter(provider => provider.enabled !== false);
  const settled = await Promise.allSettled(active.map(async provider => {
    const rows = await provider.search(criteria);
    if (!Array.isArray(rows)) return [];
    return rows.map(row => normalizeProviderResult(row, provider))
      .filter(property => matchesSearchDefaults(property, criteria));
  }));
  return dedupeProviderResults(settled.flatMap(result => result.status === "fulfilled" ? result.value : []));
}

// Generic JSON endpoint adapter. This keeps Rook source-agnostic: a future
// listing service only needs to return an array (or { listings: [] }).
export function createJsonProvider({ id, label, endpoint, mapResult = value => value, fetchImpl = fetch }) {
  if (!id || !endpoint) throw new Error("JSON provider requires id and endpoint");
  return {
    id,
    label: label || id,
    async search(criteria = {}) {
      const baseUrl = typeof window !== "undefined" ? window.location.href : "http://localhost/";
      const url = new URL(endpoint, baseUrl);
      Object.entries(criteria).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
      });
      const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`${label || id} returned ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload.listings;
      return Array.isArray(rows) ? rows.map(mapResult) : [];
    }
  };
}


export function registerConfiguredProviders() {
  if (config.listings?.endpoint && !providers.has("rook-live")) {
    registerProvider(createJsonProvider({
      id: "rook-live",
      label: "Rook live listings",
      endpoint: config.listings.endpoint
    }));
  }
}
