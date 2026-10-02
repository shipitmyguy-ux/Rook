import test from "node:test";
import assert from "node:assert/strict";
import { listingSourceUrls } from "../src/core/listing-sources.js";
import { normalizeProviderResult, dedupeProviderResults, resolveMissingListing } from "../src/integrations/providers.js";
import { dedupeProperties } from "../src/core/dedupe.js";
const apartments = "https://www.apartments.com/526-walhalla-ct-fort-collins-co/c50gx0f/";
const hotpads = "https://hotpads.com/526-walhalla-ct-fort-collins-co-80524-1kzk19b/pad";
const address = "526 Walhalla Ct, Fort Collins, CO 80524";
test("discovery preserves a publisher URL carried in the original id", () => {
  const row = normalizeProviderResult({id:hotpads+"#residence",sourceUrl:apartments,address,price:2400,beds:3,type:"House"}, {id:"rook-live"});
  assert.deepEqual(listingSourceUrls(row),[apartments,hotpads]);
  const later = normalizeProviderResult({id:"other",sourceUrl:hotpads,address},{id:"rook-live"});
  for (const merged of [dedupeProviderResults([row,later]),dedupeProperties([row,later])]) {
    assert.deepEqual(new Set(listingSourceUrls(merged[0])),new Set([apartments,hotpads]));
  }
});
test("a failed primary portal does not hide an active alternative publisher", async () => {
  const row = normalizeProviderResult({id:hotpads+"#residence",sourceUrl:apartments,address,price:2400,beds:3,type:"House"},{id:"rook-live"});
  const requested=[];
  const result=await resolveMissingListing(row,{},async url=>{
    const sourceUrl=url.searchParams.get("sourceUrl"); requested.push(sourceUrl);
    const payload=sourceUrl===apartments ? {state:"unknown"} : {
      state:"active",checkedAt:new Date().toISOString(),
      listing:{sourceUrl:hotpads,address,price:2400,beds:3,type:"House"},
      verification:{confirmed:true,version:5,url:hotpads}
    };
    return {ok:true,json:async()=>payload};
  });
  assert.equal(result.state,"active"); assert.equal(result.url,hotpads);
  assert.deepEqual(requested,[apartments,hotpads]);
  assert.deepEqual(new Set(listingSourceUrls(result.listing)),new Set([apartments,hotpads]));
});

test("new alternative URLs bypass an unknown-source cooldown only once", async () => {
  const {needsListingCheck}=await import("../src/core/listing.js");
  const row={address,sourceUrl:apartments,listingState:"unknown",listingCheckedAt:new Date().toISOString(),metadata:{listingResolverVersion:5,sourceUrls:[apartments,hotpads],listingCheckedSourceUrls:[apartments]}};
  assert.equal(needsListingCheck(row),true);
  row.metadata.listingCheckedSourceUrls.push(hotpads);
  assert.equal(needsListingCheck(row),false);
});
