import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProperty, filterProperties, ignorePropertyPatch, restoreIgnoredPatch } from "../src/core/property.js";

test("ignore hides a property and restore preserves its previous status, saved state, and notes", () => {
  const original = normalizeProperty({ id: "home", status: "showing-scheduled", saved: true, note: "Keep this note", metadata: { source: "test" } });
  const ignored = normalizeProperty({ ...original, ...ignorePropertyPatch(original) });
  assert.equal(filterProperties([ignored], "all").length, 0);
  const persisted = JSON.parse(JSON.stringify(ignored));
  const restored = normalizeProperty({ ...persisted, ...restoreIgnoredPatch(persisted) });
  assert.equal(filterProperties([restored], "all").length, 1);
  assert.equal(restored.status, "showing-scheduled");
  assert.equal(restored.saved, true);
  assert.equal(restored.note, original.note);
  assert.deepEqual(restored.metadata, original.metadata);
});
test("legacy ignored and archived properties can return to results", () => {
  for (const status of ["rejected", "archived"]) {
    const property = normalizeProperty({ id: status, status });
    const restored = { ...property, ...restoreIgnoredPatch(property) };
    assert.equal(restored.status, "new");
    assert.equal(filterProperties([restored], "all").length, 1);
  }
});
