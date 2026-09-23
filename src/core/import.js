import { normalizeProperty } from "./property.js";

export function propertyFromUrl(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  return normalizeProperty({
    id: "url-" + simpleHash(url),
    label: "Imported listing",
    type: "Property",
    source: host,
    sourceUrl: url,
    status: "new"
  });
}

function simpleHash(value) {
  let hash = 0;
  for (let i=0;i<value.length;i++) hash=((hash<<5)-hash+value.charCodeAt(i))|0;
  return Math.abs(hash).toString(36);
}
