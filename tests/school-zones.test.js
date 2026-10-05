import test from "node:test";
import assert from "node:assert/strict";
import { isLaurelRental, isPointInPolygon } from "../src/core/school-zones.js";

test("Laurel zone admits only rental properties with coordinates inside its polygon", () => {
  const inside = { lng:-105.071, lat:40.591 };
  const outside = { lng:-105.087, lat:40.574 };
  assert.equal(isPointInPolygon(inside), true);
  assert.equal(isPointInPolygon(outside), false);
  assert.equal(isPointInPolygon(null), false);
  assert.equal(isLaurelRental({ listingType:"rent" }, inside), true);
  assert.equal(isLaurelRental({ listingType:"buy" }, inside), false);
  assert.equal(isLaurelRental({ listingType:"rent" }, outside), false);
  assert.equal(isLaurelRental({ listingType:"rent" }, null), false);
});
