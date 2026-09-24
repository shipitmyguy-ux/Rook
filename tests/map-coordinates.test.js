import test from "node:test";
import assert from "node:assert/strict";
import { renderPropertyMap } from "../src/integrations/maps.js";

test("overview excludes missing coordinates, uses valid cache, and preserves real zero coordinates", async () => {
  let data;
  const cache = {
    "Cached address": { lat: 40.58, lng: -105.08 },
    "Bad cache": { lat: null, lng: "" }
  };
  globalThis.localStorage = { getItem: () => JSON.stringify(cache) };
  globalThis.fetch = async () => ({ ok: false });
  let onStyle;
  const source = { setData(value) { data = value; } };
  const map = {
    addControl() {}, on(event, handler) { if (event === "style.load") onStyle = handler; },
    getSource() { return source; }, getLayer() { return true; },
    setFilter() {}, fitBounds() {}, jumpTo() {},
    getStyle() { return { layers: [], sources: {} }; }
  };
  globalThis.window = { maplibregl: { Map: function () { return map; }, AttributionControl: function () {} } };
  const container = { replaceChildren() {}, dataset: {} };
  renderPropertyMap(container, [
    { id: "missing", lat: null, lng: null, address: "Missing address" },
    { id: "empty", lat: "", lng: " ", address: "Empty address" },
    { id: "invalid", lat: 100, lng: -200, address: "Invalid address" },
    { id: "boolean", lat: false, lng: false, address: "Boolean address" },
    { id: "bad-cache", lat: null, lng: null, address: "Bad cache" },
    { id: "cached", lat: null, lng: null, address: "Cached address" },
    { id: "zero", lat: 0, lng: 0 },
    { id: "numeric-string", lat: "40.5", lng: "-105.1" }
  ]);
  await new Promise(resolve => setImmediate(resolve));
  onStyle();
  assert.deepEqual(data.features.map(f => [f.id, f.geometry.coordinates]), [
    ["cached", [-105.08, 40.58]],
    ["zero", [0, 0]],
    ["numeric-string", [-105.1, 40.5]]
  ]);
});



