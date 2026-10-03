import test from "node:test";
import assert from "node:assert/strict";
import { createPropertyStore } from "../src/core/store.js";
import { ignorePropertyPatch } from "../src/core/property.js";
import { verifiedProperty } from "./listing-fixtures.js";

test("scratch workspace storage is isolated from Main properties and ignored identities", () => {
  const values = new Map();
  const old = globalThis.localStorage;
  globalThis.localStorage = {
    getItem:key => values.get(key) || null,
    setItem:(key,value) => values.set(key,value)
  };
  try {
    const mainProperty = verifiedProperty({ id:"main-home", address:"526 Walhalla Ct, Fort Collins, CO 80524" });
    const main = createPropertyStore([mainProperty]);
    main.update(mainProperty.id, ignorePropertyPatch(mainProperty));

    const scratchProperty = verifiedProperty({ id:"scratch-home", address:"526 Walhalla Ct, Fort Collins, CO 80524", price:2400 });
    const scratch = createPropertyStore([], { namespace:"walhalla-search" });
    scratch.upsert(scratchProperty);

    assert.equal(main.getAll().length, 1);
    assert.equal(main.getAll()[0].status, "rejected");
    assert.equal(scratch.getAll().length, 1);
    assert.equal(scratch.getAll()[0].id, "scratch-home");
    assert.ok(values.has("rook.properties.v1"));
    assert.ok(values.has("rook.properties.v1.workspace.walhalla-search"));
    assert.ok(values.has("rook.ignored-identities.v1"));
    assert.ok(values.has("rook.ignored-identities.v1.workspace.walhalla-search"));
    assert.notEqual(
      values.get("rook.properties.v1"),
      values.get("rook.properties.v1.workspace.walhalla-search")
    );
  } finally {
    globalThis.localStorage = old;
  }
});
