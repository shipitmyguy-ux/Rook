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

export function addressUnit(value = "") {
  return String(value).match(/(?:\b(?:apartment|apt|unit|suite|ste)\s*#?\s*|#\s*)([a-z0-9-]+)/i)?.[1]?.toLowerCase() || "";
}

export function addressCity(value = "") {
  return canonicalAddress(String(value).split(",")[1] || "");
}

export function streetAddressKey(value = "") {
  return canonicalAddress(String(value).split(",")[0] || "");
}

export function sameAddress(a = "", b = "") {
  const left = canonicalAddress(a), right = canonicalAddress(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function compatibleAddressIdentity(a = {}, b = {}) {
  const aUnit = addressUnit(a.address), bUnit = addressUnit(b.address);
  const aCity = addressCity(a.address), bCity = addressCity(b.address);
  return !(aUnit && bUnit && aUnit !== bUnit) && !(aCity && bCity && aCity !== bCity);
}

export function listingIdentity(input = {}) {
  const address = canonicalAddress(input.address);
  if (address) return `address:${address}`;
  const lat = Number(input.lat), lng = Number(input.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `geo:${lat.toFixed(4)},${lng.toFixed(4)}`;
  return input.sourceUrl || input.url || input.id || input.label || null;
}
