function clean(value=""){return value.toLowerCase().replace(/\b(street)\b/g,"st").replace(/\b(avenue)\b/g,"ave").replace(/\b(road)\b/g,"rd").replace(/\b(drive)\b/g,"dr").replace(/[^a-z0-9]/g,"");}
export function propertyIdentity(property) {
  if (property.address) return "address:" + clean(property.address);
  if (property.sourceUrl) {
    try { const u=new URL(property.sourceUrl); return "url:"+u.hostname+u.pathname.replace(/\/$/,""); } catch {}
  }
  return "label:" + clean(property.label);
}
export function dedupeProperties(properties) {
  const seen=new Map();
  for(const property of properties){
    const key=propertyIdentity(property);
    const prior=seen.get(key);
    if (!prior) { seen.set(key, property); continue; }
    // Incoming discovery data may refresh factual listing fields, but must never
    // erase user-owned lifecycle state, notes or shortlist decisions.
    seen.set(key, {
      ...property,
      ...prior,
      price: property.price ?? prior.price,
      beds: property.beds ?? prior.beds,
      baths: property.baths ?? prior.baths,
      lat: property.lat ?? prior.lat,
      lng: property.lng ?? prior.lng,
      source: property.source || prior.source,
      sourceUrl: property.sourceUrl || prior.sourceUrl,
      metadata: { ...(property.metadata || {}), ...(prior.metadata || {}) },
      saved: Boolean(prior.saved || property.saved),
      status: prior.status || property.status,
      note: prior.note || property.note || "",
      contactedAt: prior.contactedAt || property.contactedAt || null,
      contactOutcome: prior.contactOutcome || property.contactOutcome || null,
      showingAt: prior.showingAt || property.showingAt || null
    });
  }
  return [...seen.values()];
}
