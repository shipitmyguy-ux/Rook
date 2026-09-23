import { normalizeProperty, PROPERTY_STATUS } from "./property.js";
import { dedupeProperties } from "./dedupe.js";

const STORAGE_KEY = "rook.properties.v1";

export function createPropertyStore(seed = []) {
  let properties = load(seed);
  const listeners = new Set();

  function load(fallback) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(saved) ? dedupeProperties([...fallback.map(normalizeProperty), ...saved.map(normalizeProperty)]) : fallback.map(normalizeProperty);
    } catch {
      return fallback.map(normalizeProperty);
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(properties));
    listeners.forEach(listener => listener(properties));
  }

  return {
    getAll: () => [...properties],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(id, patch) {
      properties = properties.map(p => p.id === id ? normalizeProperty({ ...p, ...patch, id, updatedAt: new Date().toISOString() }) : p);
      persist();
    },
    toggleSaved(id) {
      const target = properties.find(p => p.id === id);
      if (!target) return;
      const saved = !target.saved;
      this.update(id, { saved, status: saved && target.status === PROPERTY_STATUS.NEW ? PROPERTY_STATUS.SHORTLISTED : target.status });
    },
    upsert(property) {
      this.upsertMany([property]);
    },
    upsertMany(incoming = []) {
      if (!Array.isArray(incoming) || !incoming.length) return;
      properties = dedupeProperties([...incoming.map(normalizeProperty), ...properties]).map(normalizeProperty);
      persist();
    },
    replaceAll(incoming = []) {
      if (!Array.isArray(incoming)) throw new TypeError("Property backup must contain an array");
      properties = dedupeProperties(incoming.map(normalizeProperty));
      persist();
    }
  };
}
