import { canonicalAddress } from "./address.js";

// Shared precision fallback: Census address-range interpolation, never a city
// centroid or a fuzzy street-only match. The existing map resolver caches it.
export async function censusAddressPoint(address, location, fetchJson) {
  const street = String(address || "").split(",")[0].replace(/\s+(?:unit|apt|suite|#)\s*#?\s*[a-z0-9-]+.*$/i, "").trim();
  if (!/^\d+\s+\S+/.test(street)) return null;
  const query = String(address).includes(",") ? String(address) : `${street}, ${location}`;
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", query);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const payload = await fetchJson(url);
  const expectedCity = canonicalAddress(String(query).split(",")[1] || "");
  for (const match of payload?.result?.addressMatches || []) {
    const matchedStreet = String(match.matchedAddress || "").split(",")[0];
    const city = canonicalAddress(match.addressComponents?.city || "");
    if (canonicalAddress(matchedStreet) !== canonicalAddress(street) || (expectedCity && city !== expectedCity)) continue;
    const lat = Number(match.coordinates?.y), lng = Number(match.coordinates?.x);
    if (match.coordinates?.y == null || match.coordinates?.x == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    return {lat,lng};
  }
  return null;
}
