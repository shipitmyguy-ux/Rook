import { config } from "../config.js";
import { classifyPropertyKind } from "../core/property.js";

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
    .replace(/\b(?:apartment|apt|unit|suite|ste)\s*#?\s*([a-z0-9-]+)\b/g, "unit$1")
    .replace(/#\s*([a-z0-9-]+)\b/g, "unit$1")
    .replace(/[^a-z0-9]/g, "");
}

export function listingIdentity(input = {}) {
  const address = canonicalAddress(input.address);
  if (address) return `address:${address}`;
  const lat = Number(input.lat), lng = Number(input.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `geo:${lat.toFixed(4)},${lng.toFixed(4)}`;
  return input.sourceUrl || input.url || input.id || input.label || null;
}

export function firstImageUrl(input = {}) {
  const candidates = [
    input.primaryImageUrl, input.imageUrl, input.image, input.photo, input.thumbnail, input.thumbnailUrl,
    input.metadata?.image, input.metadata?.imageUrl, input.metadata?.photo, input.metadata?.thumbnail,
    ...(Array.isArray(input.images) ? input.images : []),
    ...(Array.isArray(input.photos) ? input.photos : []),
    ...(Array.isArray(input.media) ? input.media : [])
  ];
  for (const value of candidates) {
    if (!value) continue;
    const candidate = typeof value === "string" ? value : value.url || value.src || value.contentUrl || value["@id"];
    if (typeof candidate !== "string") continue;
    try {
      const url = new URL(candidate, input.sourceUrl || input.url || (typeof window !== "undefined" ? window.location.href : "https://example.com/"));
      if (["http:", "https:"].includes(url.protocol)) return url.toString();
    } catch {}
  }
  return null;
}

export function normalizeProviderResult(input = {}, provider = {}) {
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const pickNumber = (...values) => {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
      if (match) return Number(match[0]);
    }
    return null;
  };
  const locationAddress = input.location?.address;
  const addressObject = typeof input.address === "object" ? input.address : locationAddress && typeof locationAddress === "object" ? locationAddress : null;
  const address = typeof input.address === "string" ? input.address
    : typeof locationAddress === "string" ? locationAddress
    : metadata.address || metadata.streetAddress
    || [addressObject?.streetAddress, addressObject?.addressLocality, addressObject?.addressRegion, addressObject?.postalCode].filter(Boolean).join(", ");
  const price = pickNumber(input.price, input.monthlyRent, input.rent, input.listPrice, input.offers?.price, metadata.price, metadata.rent);
  const beds = pickNumber(input.beds, input.bedrooms, input.numberOfBedrooms, metadata.beds, metadata.bedrooms);
  const baths = pickNumber(input.baths, input.bathrooms, input.numberOfBathrooms, input.numberOfBathroomsTotal, metadata.baths, metadata.bathrooms);
  const sourceUrl = input.sourceUrl || input.url || input.offers?.url || metadata.url || null;
  const image = firstImageUrl({ ...input, sourceUrl });
  const stableKey = listingIdentity(input);
  return {
    ...input,
    id: stableKey ? `${provider.id || "provider"}:${String(stableKey).trim().toLowerCase()}` : undefined,
    label: input.label || input.name || address || "Untitled property",
    address: address || "",
    type: input.type || "Property",
    listingType: input.listingType === "buy" ? "buy" : "rent",
    price: Number.isFinite(price) ? price : null,
    beds: Number.isFinite(beds) ? beds : null,
    baths: Number.isFinite(baths) ? baths : null,
    source: input.source || provider.label || provider.id || null,
    sourceUrl,
    image,
    imageUrl: image,
    primaryImageUrl: image,
    metadata: { ...metadata, image: image || metadata.image || null, providerId: provider.id || null }
  };
}

export function isUsableListing(property) {
  if (!property || (!property.address && !property.sourceUrl)) return false;
  if (property.price != null && (!Number.isFinite(property.price) || property.price <= 0)) return false;
  if (property.beds != null && (!Number.isFinite(property.beds) || property.beds < 0)) return false;
  if (property.sourceUrl) {
    try {
      const url = new URL(property.sourceUrl);
      if (!["http:", "https:"].includes(url.protocol)) return false;
    } catch { return false; }
  }
  return true;
}

const VERIFIED_INCOME_RESTRICTED_COMMUNITIES = [
  { label:/\bbuffalo\s+run(?:\s+apartments)?\b/i, address:/\b1245\s+e\s+lincoln\s+ave\b/i }
];

export function incomeRestrictionText(property = {}) {
  const metadata = property.metadata && typeof property.metadata === "object" ? property.metadata : {};
  const parts = [
    property.label, property.address, property.type, property.note,
    metadata.description, metadata.summary, metadata.tags, metadata.features,
    metadata.amenities, metadata.badges, metadata.highlights, metadata.category,
    metadata.categories, metadata.qualifications, metadata.programs
  ];
  try { parts.push(JSON.stringify(metadata)); } catch {}
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function isIncomeRestrictedListing(property = {}) {
  const text = incomeRestrictionText(property);
  if (/(income[-\s]restricted|income\s+(?:limit|limits|limited|qualified|qualification|qualifications)|income-qualified|affordable\s+housing(?:\s+programs?)?|section\s*8|\blihtc\b|low[-\s]income\s+housing\s+tax\s+credit)/i.test(text)) return true;
  const label = String(property.label || "");
  const address = String(property.address || "");
  return VERIFIED_INCOME_RESTRICTED_COMMUNITIES.some(item => item.label.test(label) || (item.address.test(address) && /buffalo\s+run/i.test(label + " " + text)));
}

export function matchesSearchDefaults(property, criteria = {}) {
  if (!isUsableListing(property)) return false;
  const minBeds = criteria.minBeds ?? config.search.minBeds;
  const propertyTypes = Array.isArray(criteria.propertyTypes) ? criteria.propertyTypes.map(v => String(v).toLowerCase()) : [];
  if (Array.isArray(criteria.propertyTypes) && propertyTypes.length === 0) return false;
  if (propertyTypes.length) {
    const kind = classifyPropertyKind(property);
    if (!propertyTypes.includes(kind)) return false;
  }
  if (minBeds && property.beds != null && property.beds < minBeds) return false;
  const maxPrice = criteria.maxPrice;
  if (maxPrice && property.listingType === "rent" && property.price != null && property.price > maxPrice) return false;
  const text = [property.label, property.address, property.type, property.note, property.metadata?.description]
    .filter(Boolean).join(" ").toLowerCase();
  if ((criteria.excludeIncomeRestricted ?? config.search.excludeIncomeRestricted) && isIncomeRestrictedListing(property)) return false;
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


function sameListingAddress(a = "", b = "") {
  const left = canonicalAddress(a), right = canonicalAddress(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

export async function resolveMissingListing(property = {}, criteria = {}, fetchImpl = fetch) {
  if (!property?.address && !property?.label) return { state: "unknown", url: null, checkedAt: new Date().toISOString() };
  const endpoint = config.listings?.endpoint;
  if (!endpoint) return { state: "unknown", url: null, checkedAt: new Date().toISOString() };
  const url = new URL(endpoint, typeof window !== "undefined" ? window.location.href : "http://localhost/");
  url.searchParams.set("resolve", "1");
  if (property.address) url.searchParams.set("address", property.address);
  if (property.label) url.searchParams.set("label", property.label);
  if (property.sourceUrl) url.searchParams.set("sourceUrl", property.sourceUrl);
  if (property.beds != null) url.searchParams.set("beds", String(property.beds));
  if (property.baths != null) url.searchParams.set("baths", String(property.baths));
  url.searchParams.set("listingType", property.listingType === "buy" ? "buy" : "rent");
  if (criteria.location) url.searchParams.set("location", criteria.location);
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Listing resolver returned ${response.status}`);
  const payload = await response.json();
  const candidate = payload?.listing || null;
  const fallback = payload?.priceFallback && Number(payload.priceFallback.price) > 0 ? payload.priceFallback : null;
  if (candidate?.sourceUrl && (!property.address || sameListingAddress(candidate.address, property.address))) {
    const normalized = normalizeProviderResult(candidate, { id: "rook-resolver", label: candidate.source || "Recovered listing" });
    const listing = normalized.price
      ? normalized
      : fallback
        ? {
            ...normalized,
            price:fallback.price,
            metadata:{
              ...(normalized.metadata || {}),
              priceLabel:fallback.priceLabel || null,
              priceEvidence:fallback,
              priceFallback:true
            }
          }
        : normalized;
    return {
      state: "active",
      url: candidate.sourceUrl,
      listing,
      priceFallback:fallback,
      checkedAt: payload.checkedAt || new Date().toISOString()
    };
  }
  const confirmedClosed = payload?.state === "closed" && payload?.evidence?.confirmed === true;
  return {
    state: confirmedClosed ? "closed" : "unknown",
    url: null,
    evidence: confirmedClosed ? payload.evidence : null,
    priceFallback: fallback,
    checkedAt: payload?.checkedAt || new Date().toISOString()
  };
}

export async function resolveMissingImage(property = {}, criteria = {}, fetchImpl = fetch) {
  if (firstImageUrl(property)) {
    return { state:"found", imageUrl:firstImageUrl(property), checkedAt:new Date().toISOString(), method:"existing" };
  }
  if (!property?.address && !property?.label && !property?.sourceUrl) {
    return { state:"missing", imageUrl:null, checkedAt:new Date().toISOString(), method:"none" };
  }
  const endpoint = config.listings?.endpoint;
  if (!endpoint) return { state:"missing", imageUrl:null, checkedAt:new Date().toISOString(), method:"none" };
  const url = new URL(endpoint, typeof window !== "undefined" ? window.location.href : "http://localhost/");
  url.searchParams.set("image", "1");
  if (property.address) url.searchParams.set("address", property.address);
  if (property.label) url.searchParams.set("label", property.label);
  if (property.sourceUrl) url.searchParams.set("sourceUrl", property.sourceUrl);
  if (criteria.location) url.searchParams.set("location", criteria.location);
  const response = await fetchImpl(url, { headers:{ Accept:"application/json" } });
  if (!response.ok) throw new Error(`Image resolver returned ${response.status}`);
  const payload = await response.json();
  const imageUrl = firstImageUrl({ imageUrl:payload?.imageUrl, sourceUrl:payload?.sourceUrl || property.sourceUrl });
  return {
    state:imageUrl ? "found" : "missing",
    imageUrl:imageUrl || null,
    sourceUrl:payload?.sourceUrl || property.sourceUrl || null,
    checkedAt:payload?.checkedAt || new Date().toISOString(),
    method:payload?.method || "none"
  };
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
