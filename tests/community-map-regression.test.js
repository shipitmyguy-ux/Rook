import test from "node:test";
import assert from "node:assert/strict";
import { filterProperties } from "../src/core/property.js";
import { normalizeRuntimeCommunityProperty } from "../src/runtime-config.js";
import { readFile } from "node:fs/promises";

test("upcoming scheduled properties remain visible without a verified listing", () => {
 const property={id:"tour",status:"showing-scheduled",showingAt:new Date(Date.now()+86400000).toISOString(),metadata:{}};
 assert.equal(filterProperties([property],"all").length,1);
 assert.equal(filterProperties([{...property,status:"rejected"}],"all").length,0);
 assert.equal(filterProperties([{...property,showingAt:"2020-01-01"}],"all").length,0);
});

test("cached community migration carries configured map fallback", async () => {
 const config=JSON.parse(await readFile(new URL("../config/community-sources.json",import.meta.url),"utf8"));
 const p=normalizeRuntimeCommunityProperty({id:"old-bloom",label:"Bloom Rental Living",address:"180 N Aria Way, Fort Collins, CO 80524",metadata:{}},config.sources);
 assert.equal(p.id,"bloom");
 assert.equal(p.metadata.mapPoint.accuracy,"street");
 assert.ok(p.metadata.mapPoint.lat>40 && p.metadata.mapPoint.lng < -104);
 const app=await readFile(new URL("../src/app.js",import.meta.url),"utf8");
 assert.ok(app.includes("map(property => normalizeRuntimeCommunityProperty(property))"));
});
