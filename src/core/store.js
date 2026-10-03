import { normalizeProperty, PROPERTY_STATUS } from "./property.js";
import { dedupeProperties } from "./dedupe.js?v=listing-sources-v1";

const BASE_STORAGE_KEY = "rook.properties.v1";
const BASE_IGNORED_KEY = "rook.ignored-identities.v1";
const ignoredIdentities = p => [p.id && "id:"+p.id, p.address && "address:"+p.address.toLowerCase().replace(/[^a-z0-9]/g,""),p.sourceUrl && "url:"+p.sourceUrl].filter(Boolean);

export function createPropertyStore(seed = [], options = {}) {
  const namespace = String(options.namespace || "").trim().replace(/[^a-z0-9_-]+/gi, "-");
  const STORAGE_KEY = namespace ? BASE_STORAGE_KEY + ".workspace." + namespace : BASE_STORAGE_KEY;
  const IGNORED_KEY = namespace ? BASE_IGNORED_KEY + ".workspace." + namespace : BASE_IGNORED_KEY;
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
    localStorage.setItem(IGNORED_KEY, JSON.stringify(properties.filter(p=>[PROPERTY_STATUS.REJECTED,PROPERTY_STATUS.ARCHIVED].includes(p.status)).flatMap(ignoredIdentities)));
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
    remove(id) {
      const before = properties.length;
      properties = properties.filter(p => p.id !== id);
      if (properties.length !== before) persist();
    },
    upsertMany(incoming = []) {
      if (!Array.isArray(incoming) || !incoming.length) return;
      let ignored=new Set();
      try{ignored=new Set(JSON.parse(localStorage.getItem(IGNORED_KEY)||"[]"))}catch{}
      incoming=incoming.filter(p=>!ignoredIdentities(p).some(key=>ignored.has(key)));
      if(!incoming.length)return;
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
