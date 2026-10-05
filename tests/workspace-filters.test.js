import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { loadWorkspaceFilter, matchesWorkspaceFilter, qualifyWorkspaceListings } from "../src/core/workspace-filters.js";

test("Laurel GeoJSON is standalone filter data and admits only in-zone rentals", async () => {
  const source = new URL("../config/workspace-filters/laurel-rentals.geojson", import.meta.url);
  const contents = await fs.readFile(source, "utf8");
  const filter = await loadWorkspaceFilter("laurel-rentals", async url => {
    assert.equal(new URL(url).pathname, source.pathname);
    return { ok:true, json:async()=>JSON.parse(contents) };
  });
  assert.equal(filter.properties.listingType, "rent");
  assert.equal(matchesWorkspaceFilter({listingType:"rent"}, {lng:-105.071,lat:40.591}, filter), true);
  assert.equal(matchesWorkspaceFilter({listingType:"rent"}, {lng:-105.087,lat:40.574}, filter), false);
  assert.equal(matchesWorkspaceFilter({listingType:"buy"}, {lng:-105.071,lat:40.591}, filter), false);
  assert.equal(matchesWorkspaceFilter({listingType:"rent"}, {lng:-105.06223,lat:40.57589}, filter), true, "Laurel campus is inside its attendance area");
  assert.equal(matchesWorkspaceFilter({listingType:"rent"}, {lng:-105.010,lat:40.602}, filter), true, "northeast Laurel extension is retained");
  assert.equal(matchesWorkspaceFilter({listingType:"rent"}, {lng:-105.059,lat:40.565}, filter), false, "south of Prospect is outside Laurel");
});

test("workspace qualification resolves coordinates before search results are saved", async () => {
  const filter = JSON.parse(await fs.readFile(new URL("../config/workspace-filters/laurel-rentals.geojson", import.meta.url), "utf8"));
  const rows = await qualifyWorkspaceListings([
    {id:"inside",listingType:"rent"},
    {id:"outside",listingType:"rent"},
    {id:"buy",listingType:"buy"}
  ], filter, async property => property.id === "inside"
    ? {lat:40.591,lng:-105.071}
    : {lat:40.574,lng:-105.087});
  assert.deepEqual(rows.map(row=>row.id), ["inside"]);
  assert.equal(rows[0].metadata.mapPoint.lng, -105.071);
  assert.equal(rows[0].metadata.workspaceId, "laurel-rentals");
});
