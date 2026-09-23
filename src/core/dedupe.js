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
      ...prior,
      ...property,
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
    });
  }
  return [...seen.values()];
}
