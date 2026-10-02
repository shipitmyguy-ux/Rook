import test from "node:test";
import assert from "node:assert/strict";
import { propertySquareFeet, squareFootageLabel } from "../src/core/property-size.js";
import { normalizeProperty } from "../src/core/property.js";
import { normalizeProviderResult } from "../src/integrations/providers.js";
import { dedupeProperties } from "../src/core/dedupe.js";
test("floor area survives provider normalization, persistence and duplicate merging", () => {
 const row = normalizeProperty(normalizeProviderResult({address:"526 Walhalla Ct",floorSize:{value:"1,738",unitCode:"FTK"}},{id:"test"}));
 assert.equal(row.sqft,1738);
 assert.equal(normalizeProperty(JSON.parse(JSON.stringify(row))).sqft,1738);
 assert.equal(dedupeProperties([row,{...row,sqft:null}])[0].sqft,1738);
 assert.equal(squareFootageLabel(row),"1,738 sq ft");
});
test("interior area units and missing values are handled without using lot size", () => {
 assert.equal(propertySquareFeet({floorSize:{value:100,unitCode:"MTK"}}),1076);
 assert.equal(propertySquareFeet({lotSize:5000,sqft:0}),null);
 assert.equal(propertySquareFeet({floorSize:{value:100,unitCode:"ACR"}}),null);
 assert.equal(squareFootageLabel({metadata:{units:[{sqft:1166},{sqft:1395}]}}),"1,166–1,395 sq ft");
 assert.equal(squareFootageLabel({}),"");
});
