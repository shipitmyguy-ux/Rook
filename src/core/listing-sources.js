import { directListingUrl } from "./listing.js";

export function listingSourceUrls(property = {}) {
  const values = [property.sourceUrl, ...(Array.isArray(property.metadata?.sourceUrls) ? property.metadata.sourceUrls : []), property.id];
  return [...new Set(values.map(value => {
    const link = directListingUrl(value);
    if (!link) return null;
    const url = new URL(link);
    url.hash = "";
    return url.href;
  }).filter(Boolean))];
}
