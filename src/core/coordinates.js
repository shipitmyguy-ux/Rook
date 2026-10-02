export function signedCoordinate(value, max) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= max ? number : null;
}

export function publisherCoordinates(html, address) {
  const core = value => String(value || "").split(",")[0].toLowerCase()
    .replace(/\s+(?:unit|apt|apartment|suite|#)\s*#?\s*[a-z0-9-]+$/i, "")
    .replace(/\b(street|road|drive|avenue|court|lane|boulevard)\b/g, word => ({street:"st",road:"rd",drive:"dr",avenue:"ave",court:"ct",lane:"ln",boulevard:"blvd"})[word])
    .replace(/[^a-z0-9]/g, "");
  const wanted = core(address);
  if (wanted.length < 8) return null;
  for (const script of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const queue = [JSON.parse(script[1])];
      let visited = 0;
      while (queue.length && visited++ < 12000) {
        const item = queue.pop();
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item)) { queue.push(...item); continue; }
        for (const value of Object.values(item)) if (value && typeof value === "object") queue.push(value);
        const addr = item.address || item.location?.address;
        const street = typeof addr === "string" ? addr : addr?.streetAddress;
        if (core(street) !== wanted) continue;
        const geo = item.geo || item.location?.geo;
        const lat = signedCoordinate(geo?.latitude, 90);
        const lng = signedCoordinate(geo?.longitude, 180);
        if (lat !== null && lng !== null) return {lat, lng};
      }
    } catch {}
  }
  return null;
}
