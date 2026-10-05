import test from "node:test";
import assert from "node:assert/strict";
import { censusAddressPoint } from "../src/core/address-geocoding.js";
const match={matchedAddress:"301 PETERSON ST, FORT COLLINS, CO, 80524",addressComponents:{city:"FORT COLLINS"},coordinates:{x:-105.0720188,y:40.5841399}};
test("shared Census fallback requires exact street and city",async()=>{
  let requested;
  const fetchJson=async url=>{requested=url;return {result:{addressMatches:[match]}}};
  assert.deepEqual(await censusAddressPoint("301 Peterson Street","Fort Collins, CO",fetchJson),{lng:-105.0720188,lat:40.5841399});
  assert.equal(requested.searchParams.get("address"),"301 Peterson Street, Fort Collins, CO");
  assert.equal(await censusAddressPoint("302 Peterson Street","Fort Collins, CO",fetchJson),null);
  assert.equal(await censusAddressPoint("301 Peterson Street","Wellington, CO",fetchJson),null);
  assert.equal(await censusAddressPoint("Peterson Street","Fort Collins, CO",fetchJson),null);
});
