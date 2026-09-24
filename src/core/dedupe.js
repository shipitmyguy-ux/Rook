function clean(value=""){return String(value).toLowerCase().replace(/\b(street)\b/g,"st").replace(/\b(avenue)\b/g,"ave").replace(/\b(road)\b/g,"rd").replace(/\b(drive)\b/g,"dr").replace(/\b(lane)\b/g,"ln").replace(/\b(court)\b/g,"ct").replace(/\b(boulevard)\b/g,"blvd").replace(/[^a-z0-9]/g,"");}

function propertyKeys(property = {}) {
  const keys = [];
  if (property.address) keys.push("address:" + clean(property.address));
  if (property.sourceUrl) {
    try { const u=new URL(property.sourceUrl); keys.push("url:"+u.hostname+u.pathname.replace(/\/$/,"")); } catch {}
  }
  if (property.label) keys.push("label:" + clean(property.label));
  return [...new Set(keys.filter(key => !key.endsWith(":")))];
}

export function propertyIdentity(property) {
  return propertyKeys(property)[0] || "label:" + clean(property?.label || "");
}

function mergeProperty(prior, property) {
  return {
    ...prior,
    ...property,
    address: prior.address || property.address || "",
    label: prior.label || property.label || "Untitled property",
    price: prior.price ?? property.price,
    beds: prior.beds ?? property.beds,
    baths: prior.baths ?? property.baths,
    lat: prior.lat ?? property.lat,
    lng: prior.lng ?? property.lng,
    source: prior.source || property.source,
    sourceUrl: prior.sourceUrl || property.sourceUrl,
    metadata: { ...(prior.metadata || {}), ...(property.metadata || {}) },
    saved: Boolean(prior.saved || property.saved),
    status: property.status || prior.status,
    note: property.note || prior.note || "",
    contactedAt: property.contactedAt || prior.contactedAt || null,
    contactOutcome: property.contactOutcome || prior.contactOutcome || null,
    showingAt: property.showingAt || prior.showingAt || null
  };
}

export function dedupeProperties(properties) {
  const rows = [];
  const keyToIndex = new Map();
  for (const property of properties) {
    const keys = propertyKeys(property);
    let index = keys.map(key => keyToIndex.get(key)).find(value => value !== undefined);
    if (index === undefined) {
      index = rows.length;
      rows.push(property);
    } else {
      rows[index] = mergeProperty(rows[index], property);
    }
    for (const key of propertyKeys(rows[index])) keyToIndex.set(key, index);
    for (const key of keys) keyToIndex.set(key, index);
  }
  return rows;
}
