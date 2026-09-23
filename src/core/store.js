import { normalizeProperty } from "./property.js";

const STORAGE_KEY = "rook.properties.v1";

export function createPropertyStore(seed = []) {
  let properties = load(seed);
  let remoteSave = null;
  let remoteTimer = null;
  const listeners = new Set();

  function load(fallback) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(saved) ? saved.map(normalizeProperty) : fallback.map(normalizeProperty);
    } catch { return fallback.map(normalizeProperty); }
  }
  function notify() { listeners.forEach(listener => listener([...properties])); }
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(properties));
    notify();
    if (remoteSave) {
      clearTimeout(remoteTimer);
      remoteTimer = setTimeout(() => remoteSave([...properties]).catch(console.error), 350);
    }
  }
  return {
    getAll: () => [...properties],
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setRemotePersistence(save) { remoteSave = save; },
    hydrate(remoteProperties) {
      const remote = new Map(remoteProperties.map(property => [property.id, normalizeProperty(property)]));
      for (const local of properties) {
        const prior = remote.get(local.id);
        if (!prior || String(local.updatedAt) > String(prior.updatedAt)) remote.set(local.id, local);
      }
      properties = [...remote.values()];
      persist();
    },
    update(id, patch) {
      properties = properties.map(property => property.id === id ? normalizeProperty({ ...property, ...patch, id, updatedAt: new Date().toISOString() }) : property);
      persist();
    },
    toggleSaved(id) { const property = properties.find(item => item.id === id); if (property) this.update(id, { saved: !property.saved }); },
    upsert(property) {
      const normalized = normalizeProperty(property);
      const index = properties.findIndex(item => item.id === normalized.id);
      if (index >= 0) properties[index] = normalizeProperty({ ...properties[index], ...normalized, updatedAt: new Date().toISOString() });
      else properties.unshift(normalized);
      persist();
    }
  };
}
