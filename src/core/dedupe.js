import { classifyPropertyKind } from "./property.js";
import { listingSourceUrls } from "./listing-sources.js";
import { canonicalAddress, addressUnit, addressCity, streetAddressKey, compatibleAddressIdentity } from "./address.js";
const clean = canonicalAddress;
const streetKey = property => streetAddressKey(property.address);
const compatibleIdentity = compatibleAddressIdentity;
const STATUS_PRIORITY = new Map([
  ["new",0],["viewed",1],["shortlisted",2],["contacted",3],["showing-requested",4],
  ["showing-scheduled",5],["visited",6],["rejected",-1],["archived",-2]
]);
function preferredStatus(a,b) {
  const av=STATUS_PRIORITY.get(String(a||"")) ?? 0;
  const bv=STATUS_PRIORITY.get(String(b||"")) ?? 0;
  return bv>av ? b : a || b;
}

function addressLikeLabel(value = "") {
  const label=String(value||"").trim();
  return /^\d{1,6}\s+.+\b(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|way|blvd|boulevard|pl|place|cir|circle)\b/i.test(label) ? label : "";
}

function communityKeys(property = {}) {
  const metadata=property.metadata || {};
  const keys=[];
  const id=metadata.communityId || (metadata.discoveryMethod === "configured-community" ? metadata.configuredSourceId : null);
  if (id) keys.push("community:" + clean(id));
  if ((metadata.floorPlan || metadata.discoveryMethod === "configured-community") && property.source) {
    keys.push("community-source:" + clean(property.source));
  }
  return [...new Set(keys.filter(Boolean))];
}

function propertyKeys(property = {}) {
  const keys = [];
  keys.push(...communityKeys(property));
  if (property.address) keys.push("address:" + clean(property.address));
  if (property.address) keys.push("street:"+streetKey(property));
  const labelAddress=addressLikeLabel(property.label);
  if (labelAddress) {
    keys.push("address:" + clean(labelAddress));
    keys.push("street:" + streetAddressKey(labelAddress));
  }
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
  metadata.sourceUrls = [...new Set([...listingSourceUrls(prior), ...listingSourceUrls(property)])];
  const listingState = verified.listingState || 'unknown';
  return {
    ...prior,
    ...property,
    address: prior.address || property.address || "",
    label: property.metadata?.communityName || prior.metadata?.communityName || property.label || prior.label || "Untitled property",
    type: [verified,prior,property].find(p => classifyPropertyKind({type:p.type}) !== "rental")?.type || verified.type || prior.type || property.type,
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
    status: preferredStatus(prior.status, property.status),
    note: property.note || prior.note || "",
    contactedAt: property.contactedAt || prior.contactedAt || null,
    contactOutcome: property.contactOutcome || prior.contactOutcome || null,
    showingAt: prior.showingAt || property.showingAt || null
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
