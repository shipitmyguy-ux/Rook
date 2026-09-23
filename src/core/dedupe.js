function clean(value=""){return value.toLowerCase().replace(/[^a-z0-9]/g,"");}
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
    seen.set(key, prior ? { ...prior, ...property, saved: prior.saved || property.saved } : property);
  }
  return [...seen.values()];
}
