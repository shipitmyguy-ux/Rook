import { classifyPropertyKind } from "./property.js";
const VERSION = 1;

function cleanWorkspace(value = "") {
  return String(value || "scratch").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "scratch";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeState(input = {}) {
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  return {
    version: VERSION,
    filters: {
      maxPrice: Number(filters.maxPrice) > 0 ? Number(filters.maxPrice) : null,
      minBeds: Number(filters.minBeds) > 0 ? Number(filters.minBeds) : null,
      types: Array.isArray(filters.types) ? [...new Set(filters.types.map(v => String(v).toLowerCase()).filter(Boolean))] : [],
      excludedTypes: Array.isArray(filters.excludedTypes) ? [...new Set(filters.excludedTypes.map(String))] : [],
      playground: Boolean(filters.playground),
      directions: Array.isArray(filters.directions) ? [...new Set(filters.directions.map(v => String(v).toLowerCase()).filter(Boolean))] : []
    },
    pinnedIds: Array.isArray(input.pinnedIds) ? [...new Set(input.pinnedIds.map(String))] : [],
    excludedIds: Array.isArray(input.excludedIds) ? [...new Set(input.excludedIds.map(String))] : [],
    history: Array.isArray(input.history) ? input.history.slice(-20) : [],
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function kindOf(property = {}) {
  return classifyPropertyKind({ ...property, type:property.type || property.propertyType });
}

function playgroundHint(property = {}) {
  const text = [
    property.note,
    property.label,
    property.address,
    property.metadata?.workspaceNote,
    property.metadata?.amenities,
    property.metadata?.nearby
  ].flat().filter(Boolean).join(" ").toLowerCase();
  return /playground|park|tot lot|play area/.test(text);
}

function matchesFilters(property, filters) {
  if (filters.maxPrice && Number(property.price) > 0 && Number(property.price) > filters.maxPrice) return false;
  if (filters.minBeds && Number(property.beds) > 0 && Number(property.beds) < filters.minBeds) return false;
  if (filters.types.length) {
    const kind = kindOf(property);
    if (!filters.types.includes(kind)) return false;
  }
  if (filters.playground && !playgroundHint(property)) return false;
  return true;
}

export function createScratchSession(workspace, options = {}) {
  const id = cleanWorkspace(workspace);
  const storage = options.storage || globalThis.localStorage;
  const key = "rook.scratch-session.v1." + id;
  const listeners = new Set();

  let state;
  try {
    state = normalizeState(JSON.parse(storage?.getItem(key) || "{}"));
  } catch {
    state = normalizeState();
  }

  function persist() {
    state.updatedAt = new Date().toISOString();
    try { storage?.setItem(key, JSON.stringify(state)); } catch {}
    listeners.forEach(listener => listener(getState()));
  }

  function snapshotForHistory() {
    const copy = clone(state);
    copy.history = [];
    return copy;
  }

  function mutate(mutator, { history = true } = {}) {
    const before = snapshotForHistory();
    const next = normalizeState(mutator(clone(state)) || state);
    if (history) next.history = [...state.history, before].slice(-20);
    else next.history = state.history;
    state = next;
    persist();
    return getState();
  }

  function getState() {
    return clone(state);
  }

  return {
    getState,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    apply(properties = []) {
      const pins = new Set(state.pinnedIds);
      const excludes = new Set(state.excludedIds);
      return properties.filter(property => {
        const id = String(property.id);
        if (excludes.has(id)) return false;
        if (state.filters.excludedTypes.includes(kindOf(property))) return false;
        if (pins.has(id)) return true;
        return matchesFilters(property, state.filters);
      });
    },
    isPinned(idValue) {
      return state.pinnedIds.includes(String(idValue));
    },
    togglePin(idValue) {
      const idString = String(idValue);
      return mutate(next => {
        const set = new Set(next.pinnedIds);
        if (set.has(idString)) set.delete(idString);
        else set.add(idString);
        next.pinnedIds = [...set];
        next.excludedIds = next.excludedIds.filter(id => id !== idString);
        return next;
      });
    },
    exclude(idValue) {
      const idString = String(idValue);
      return mutate(next => {
        next.excludedIds = [...new Set([...next.excludedIds, idString])];
        next.pinnedIds = next.pinnedIds.filter(id => id !== idString);
        return next;
      });
    },
    restore(idValue) {
      return mutate(next => {
        next.excludedIds = next.excludedIds.filter(id => id !== String(idValue));
        return next;
      });
    },
    setFilters(patch = {}) {
      return mutate(next => {
        next.filters = normalizeState({ filters:{ ...next.filters, ...patch } }).filters;
        return next;
      });
    },
    removeFilter(name) {
      return mutate(next => {
        if (name === "maxPrice") next.filters.maxPrice = null;
        if (name === "minBeds") next.filters.minBeds = null;
        if (name === "types") next.filters.types = [];
        if (name === "excludedTypes") next.filters.excludedTypes = [];
        if (name === "playground") next.filters.playground = false;
        if (name === "directions") next.filters.directions = [];
        return next;
      });
    },
    undo() {
      const previous = state.history[state.history.length - 1];
      if (!previous) return getState();
      const remaining = state.history.slice(0, -1);
      state = normalizeState({ ...previous, history:remaining });
      persist();
      return getState();
    },
    clear() {
      state = normalizeState({ history:[...state.history, snapshotForHistory()].slice(-20) });
      persist();
      return getState();
    },
    command(text = "") {
      const raw = String(text).trim();
      const lower = raw.toLowerCase();
      if (!raw) return getState();
      if (/^(undo|undo that)$/.test(lower)) return this.undo();
      if (/^(start over|reset|clear scratch|clear)$/.test(lower)) return this.clear();

      return mutate(next => {
        const under = lower.match(/(?:under|below|max(?:imum)?(?: rent)?(?: of)?|<=?)\s*\$?\s*([0-9][0-9,]*)/);
        if (under) next.filters.maxPrice = Number(under[1].replace(/,/g, ""));

        const beds = lower.match(/([1-9])\s*\+?\s*(?:bed|beds|bedroom|bedrooms)/);
        if (beds) next.filters.minBeds = Number(beds[1]);

        for (const [kind, noun] of [["apartment","apartments?"],["townhome","townhomes?"],["house","houses?"]]) {
          if (new RegExp("\\b(?:hide|remove|no|exclude)\\s+(?:all\\s+)?" + noun + "\\b").test(lower)) {
            next.filters.excludedTypes = [...new Set([...next.filters.excludedTypes, kind])];
          }
          if (new RegExp("\\b(?:also|include|add|restore|show(?: again)?)\\s+(?:all\\s+)?" + noun + "\\b").test(lower)) {
            next.filters.excludedTypes = next.filters.excludedTypes.filter(value => value !== kind);
            if (next.filters.types.length) next.filters.types = [...new Set([...next.filters.types, kind])];
          }
          if (new RegExp("\\bonly\\s+" + noun + "\\b").test(lower)) {
            next.filters.types = [kind];
            next.filters.excludedTypes = next.filters.excludedTypes.filter(value => value !== kind);
          }
        }

        if (/near (?:a )?playground|near playgrounds|with playground/.test(lower)) next.filters.playground = true;
        if (/remove playground|don'?t care about playground|no playground filter/.test(lower)) next.filters.playground = false;

        const directions = ["north","south","east","west"].filter(direction => new RegExp("\\b" + direction + "\\b").test(lower));
        if (directions.length && /expand|farther|further|search|show/.test(lower)) next.filters.directions = [...new Set([...next.filters.directions, ...directions])];

        return next;
      });
    }
  };
}

export function scratchChips(state = {}) {
  const filters = state.filters || {};
  const chips = [];
  if (filters.maxPrice) chips.push({ key:"maxPrice", label:"≤ $" + Number(filters.maxPrice).toLocaleString() });
  if (filters.minBeds) chips.push({ key:"minBeds", label:filters.minBeds + "+ beds" });
  if (Array.isArray(filters.types) && filters.types.length) chips.push({ key:"types", label:filters.types.map(v => v[0].toUpperCase() + v.slice(1)).join(" + ") });
  if (filters.excludedTypes?.length) chips.push({ key:"excludedTypes", label:"No " + filters.excludedTypes.map(v => v + "s").join(" / ") });
  if (filters.playground) chips.push({ key:"playground", label:"Near playground" });
  if (Array.isArray(filters.directions) && filters.directions.length) chips.push({ key:"directions", label:filters.directions.map(v => v[0].toUpperCase() + v.slice(1)).join(" / ") });
  return chips;
}
