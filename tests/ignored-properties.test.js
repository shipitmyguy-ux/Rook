import { verifiedProperty } from "./listing-fixtures.js";
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProperty, filterProperties, ignorePropertyPatch, restoreIgnoredPatch } from "../src/core/property.js";
import {createPropertyStore} from '../src/core/store.js';

test("ignore hides a property and restore preserves its previous status, saved state, and notes", () => {
  const original = verifiedProperty({ id: "home", status: "showing-scheduled", saved: true, note: "Keep this note", metadata: { source: "test" } });
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
test('ignored identity registry prevents rediscovery and permits explicit restore',()=>{
  const values=new Map();const old=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  try{
    const property=verifiedProperty({id:'ignored',address:'123 Main St'});
    const store=createPropertyStore([property]);store.update(property.id,ignorePropertyPatch(property));
    assert.ok(JSON.parse(values.get('rook.ignored-identities.v1')).includes('id:ignored'));
    store.upsertMany([{...property,id:'new-provider-id',price:999}]);
    assert.equal(store.getAll().length,1);assert.equal(store.getAll()[0].status,'rejected');
    store.update(property.id,restoreIgnoredPatch(store.getAll()[0]));
    assert.deepEqual(JSON.parse(values.get('rook.ignored-identities.v1')),[]);
    store.upsertMany([{...property,price:2222}]);assert.equal(store.getAll()[0].price,2222);
  }finally{globalThis.localStorage=old}
});
test("legacy ignored and archived properties can return to results", () => {
  for (const status of ["rejected", "archived"]) {
    const property = verifiedProperty({ id: status, status });
    const restored = { ...property, ...restoreIgnoredPatch(property) };
    assert.equal(restored.status, "new");
    assert.equal(filterProperties([restored], "all").length, 1);
  }
});
