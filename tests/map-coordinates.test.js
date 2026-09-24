import test from "node:test";
import assert from "node:assert/strict";
import { renderPropertyMap, mapLocationQueries, resolvePropertyDistances, getCachedPropertyDistances } from "../src/integrations/maps.js";

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





test("map location queries fall back from unit addresses to building addresses and property names", () => {
  const unitQueries = mapLocationQueries(
    { address:"2502 Timberwood Dr Unit K56, Fort Collins, CO 80528", label:"2502 Timberwood Dr Unit K56" },
    "Fort Collins, CO"
  );
  assert.equal(unitQueries[0], "2502 Timberwood Dr Unit K56, Fort Collins, CO 80528");
  assert.ok(unitQueries.includes("2502 Timberwood Dr, Fort Collins, CO 80528"));

  const namedQueries = mapLocationQueries(
    { address:"", label:"Country Ranch Apartments" },
    "Fort Collins, CO"
  );
  assert.deepEqual(namedQueries, ["Country Ranch Apartments, Fort Collins, CO"]);
});

test("every already-visible property with a resolvable location reaches the map source", async () => {
  let data;
  let appliedFilter;
  const cache = {
    "Country Ranch Apartments, Fort Collins, CO": { lat: 40.5, lng: -105.0 },
    "2502 Timberwood Dr, Fort Collins, CO 80528": { lat: 40.49, lng: -105.01 },
    "Generic Rental, Fort Collins, CO": { lat: 40.51, lng: -105.02 }
  };
  globalThis.localStorage = {
    getItem: key => key === "rook.geocode-cache.v1" ? JSON.stringify(cache) : null,
    setItem() {}
  };
  globalThis.fetch = async () => ({ ok:false });
  let onStyle;
  const source = { setData(value) { data = value; } };
  const map = {
    addControl() {},
    on(event, handler) { if (event === "style.load") onStyle = handler; },
    getSource() { return source; },
    getLayer() { return true; },
    setFilter(_id, filter) { appliedFilter = filter; },
    fitBounds() {},
    jumpTo() {},
    getStyle() { return { layers:[], sources:{} }; }
  };
  globalThis.window = { maplibregl:{ Map:function(){ return map; }, AttributionControl:function(){} } };
  const container = { replaceChildren(){}, dataset:{} };
  const visible = [
    { id:"country-ranch", label:"Country Ranch Apartments", address:"", type:"Apartment", listingType:"rent" },
    { id:"unit", label:"2502 Timberwood Dr Unit K56", address:"2502 Timberwood Dr Unit K56, Fort Collins, CO 80528", type:"Townhome", listingType:"rent" },
    { id:"generic", label:"Generic Rental", address:"", type:"Rental", listingType:"rent" }
  ];
  renderPropertyMap(container, visible, {
    dataAlreadyFiltered:true,
    propertyTypes:["apartment","townhome","house"],
    location:"Fort Collins, CO"
  });
  await new Promise(resolve => setImmediate(resolve));
  onStyle();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(data.features.map(feature => feature.id).sort(), ["country-ranch","generic","unit"]);
  assert.deepEqual(appliedFilter, ["all"]);
  assert.equal(container.dataset.mapExpectedPropertyCount, "3");
  assert.equal(container.dataset.mapFeatureCount, "3");
  assert.equal(container.dataset.mapUnresolvedCount, "0");
});


test("property distances are calculated once and reused from persistent cache", async () => {
  const memory = {};
  globalThis.localStorage = {
    getItem:key => memory[key] || null,
    setItem:(key,value) => { memory[key] = value; }
  };
  let fetchCount = 0;
  globalThis.fetch = async url => {
    fetchCount += 1;
    const q = new URL(String(url)).searchParams.get("q") || "";
    const isProperty = q.includes("123 Test");
    return { ok:true, json:async()=>[{ lat:isProperty ? "40.58" : "40.60", lon:isProperty ? "-105.08" : "-105.06" }] };
  };
  const property = { id:"p1", address:"123 Test St, Fort Collins, CO" };
  const pois = [
    { id:"address-1", label:"Address 1", address:"100 First St, Fort Collins, CO" },
    { id:"address-2", label:"Address 2", lat:40.57, lng:-105.05 }
  ];
  const first = await resolvePropertyDistances(property, pois, "Fort Collins, CO");
  assert.equal(first.length, 2);
  assert.ok(first.every(item => item.resolved));
  const afterFirst = fetchCount;
  const second = await resolvePropertyDistances(property, pois, "Fort Collins, CO");
  assert.equal(fetchCount, afterFirst);
  assert.deepEqual(second.map(x=>x.distance), first.map(x=>x.distance));
  const cached = getCachedPropertyDistances(property, pois, "Fort Collins, CO");
  assert.ok(cached.every(item => item.resolved));
});
