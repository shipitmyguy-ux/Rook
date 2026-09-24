import test from "node:test";
import assert from "node:assert/strict";
import { renderPropertyMap } from "../src/integrations/maps.js";

test("overview shows POIs and property details with working actions", async () => {
  const element = () => ({
    children: [], handlers: {}, hidden: true,
    replaceChildren() { this.children = []; },
    append(...children) { this.children.push(...children); },
    setAttribute() {},
    addEventListener(name, callback) { this.handlers[name] = callback; }
  });
  const panel = element();
  globalThis.document = { querySelector: () => panel, createElement: element };
  globalThis.localStorage = { getItem: () => "{}" };
  const events = {};
  let markerPoint, markerElement, fitted, popupContent;
  const map = {
    on(name, layer, callback) { events[name + (callback ? ":" + layer : "")] = callback || layer; },
    addControl() {}, getSource: () => ({ setData() {} }), getLayer: () => true,
    setFilter() {}, setFeatureState() {}, getCanvas: () => ({ style: {} }),
    fitBounds(bounds) { fitted = bounds; }, jumpTo() {},
    getStyle: () => ({ layers: [], sources: {} })
  };
  class Marker {
    constructor({ element }) { markerElement = element; }
    setLngLat(point) { markerPoint = point; return this; }
    setPopup() { return this; } addTo() { return this; } remove() {}
  }
  globalThis.window = { maplibregl: {
    Map: function () { return map; }, AttributionControl: function () {},
    Marker, Popup: class { setDOMContent(content) { popupContent = content; return this; } setLngLat() { return this; } addTo() { return this; } remove() {} }
  } };
  let action;
  const container = { replaceChildren() {}, dataset: {} };
  renderPropertyMap(container, [{ id: "home", label: "Test home", address: "Test address", lat: 40.5, lng: -105, price: 2100, beds: 2 }], {
    pointsOfInterest: [{ id: "address-1", label: "address-1", primary: true, lat: 40.55, lng: -105.1 }],
    onPropertyAction: (...args) => { action = args; }
  });
  await new Promise(resolve => setImmediate(resolve));
  events["style.load"]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(markerPoint, [-105.1, 40.55]);
  assert.equal(markerElement.textContent, "★");
  assert.deepEqual(fitted, [[-105.1, 40.5], [-105, 40.55]]);
  events["mouseenter:rook-listings-points"]({ features: [{ properties: { id: "home" } }] });
  assert.equal(panel.hidden, true);
  assert.equal(popupContent.children[0].textContent, "Test home");
  assert.match(popupContent.children[1].textContent, /2,100/);
  events["click:rook-listings-points"]({ features: [{ properties: { id: "home" } }] });
  assert.equal(panel.children[0].textContent, "Test home");
  assert.match(panel.children[2].textContent, /2,100/);
  events["click:rook-listings-points"]({ features: [{ properties: { id: "home" } }] });
  panel.children.at(-1).children.find(child => child.textContent === "Save").handlers.click();
  assert.deepEqual(action, ["save", "home"]);
  panel.children.at(-1).children.find(child => child.textContent === "Close details").handlers.click();
  assert.equal(panel.hidden, true);
});




