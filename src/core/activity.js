const KEY = "rook.activity.v1";
export function recordActivity(kind, property, detail = {}) {
  const item = { id: crypto.randomUUID(), kind, propertyId: property?.id || null, label: property?.label || null, at: new Date().toISOString(), ...detail };
  let items = [];
  try { items = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch {}
  localStorage.setItem(KEY, JSON.stringify([item, ...items].slice(0, 200)));
  return item;
}
export function getActivity() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
