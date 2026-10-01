function clean(value=""){return String(value).toLowerCase().replace(/\b(street)\b/g,"st").replace(/\b(avenue)\b/g,"ave").replace(/\b(road)\b/g,"rd").replace(/\b(drive)\b/g,"dr").replace(/\b(lane)\b/g,"ln").replace(/\b(court)\b/g,"ct").replace(/\b(boulevard)\b/g,"blvd").replace(/\b(?:apartment|apt|unit|suite)\s*#?\s*([a-z0-9-]+)/g,"unit$1").replace(/#\s*([a-z0-9-]+)/g,"unit$1").replace(/[^a-z0-9]/g,"");}
const streetKey = property => clean(String(property.address||"").split(",")[0].replace(/\s+Fort\s+Collins\b.*$/i,""));
function compatibleIdentity(a,b){
  const unit=p=>String(p.address||"").match(/(?:\b(?:apartment|apt|unit|suite)\s*#?\s*|#\s*)([a-z0-9-]+)/i)?.[1]?.toLowerCase();
  const city=p=>clean(String(p.address||"").split(",")[1]||"");
  return !(unit(a)&&unit(b)&&unit(a)!==unit(b)) && !(city(a)&&city(b)&&city(a)!==city(b));
}

function propertyKeys(property = {}) {
  const keys = [];
  if (property.address) keys.push("address:" + clean(property.address));
  if (property.address) keys.push("street:"+streetKey(property));
  if (property.sourceUrl) {
    try { const u=new URL(property.sourceUrl); keys.push("url:"+u.hostname+u.pathname.replace(/\/$/,"")); } catch {}
  }
  if (property.label && !property.address) keys.push("label:" + clean(property.label));
  return [...new Set(keys.filter(key => !key.endsWith(":")))];
}

export function propertyIdentity(property) {
  return propertyKeys(property)[0] || "label:" + clean(property?.label || "");
}

function mergeProperty(prior, property) {
  // Verification timestamps, not seed order or the presence of a URL, decide availability.
  const checked = value => Date.parse(value.listingCheckedAt || '') || 0;
  const verified = checked(property) > checked(prior) ? property : prior;
  const sourceUrl = verified.sourceUrl || prior.sourceUrl || property.sourceUrl || null;
  const metadata = { ...(property.metadata || {}), ...(prior.metadata || {}), ...(verified.metadata || {}) };
  for (const key of ['listingVerification', 'listingClosedEvidence', 'listingResolverVersion']) {
    delete metadata[key];
    if (verified.metadata?.[key] != null) metadata[key] = verified.metadata[key];
  }
  const listingState = verified.listingState || 'unknown';
  return {
    ...prior,
    ...property,
    address: prior.address || property.address || "",
    label: prior.label || property.label || "Untitled property",
    price: verified.price ?? prior.price ?? property.price,
    beds: verified.beds ?? prior.beds ?? property.beds,
    baths: verified.baths ?? prior.baths ?? property.baths,
    lat: prior.lat ?? property.lat,
    lng: prior.lng ?? property.lng,
    source: prior.source || property.source,
    sourceUrl,
    image: prior.image || property.image || prior.imageUrl || property.imageUrl || prior.primaryImageUrl || property.primaryImageUrl || prior.metadata?.image || property.metadata?.image || null,
    imageUrl: prior.imageUrl || property.imageUrl || prior.primaryImageUrl || property.primaryImageUrl || prior.image || property.image || prior.metadata?.image || property.metadata?.image || null,
    primaryImageUrl: prior.primaryImageUrl || property.primaryImageUrl || prior.imageUrl || property.imageUrl || prior.image || property.image || prior.metadata?.image || property.metadata?.image || null,
    listingState,
    listingCheckedAt: verified.listingCheckedAt || null,
    metadata,
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
    let index = keys.map(key => keyToIndex.get(key)).find(value => value !== undefined && compatibleIdentity(rows[value],property));
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
