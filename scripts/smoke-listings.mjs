import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { directListingUrl, LISTING_RESOLVER_VERSION } from '../src/core/listing.js';
async function get(params) {
  const url=new URL(config.listings.endpoint);
  for (const [key,value] of Object.entries(params)) if (value) url.searchParams.set(key,String(value));
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  assert.equal(response.ok,true,`Listing service HTTP ${response.status}`);
  return response.json();
}
// Only public discovery results are used. Never send locally saved properties or tours.
const feed=await get({location:'Fort Collins, CO',minBeds:2});
assert.ok(feed.listings?.length>0,'Public discovery returned no listings');
assert.ok(feed.meta?.adapters?.some(adapter=>adapter.ok&&adapter.count>0));
assert.ok(feed.listings.every(listing=>directListingUrl(listing.sourceUrl)));
const results=await Promise.all(feed.listings.slice(0,3).map(async listing=>{
  const result=await get({resolve:1,location:'Fort Collins, CO',address:listing.address,label:listing.label,sourceUrl:listing.sourceUrl});
  assert.ok(['active','closed','unknown'].includes(result.state));
  if(result.state==='active') {
    assert.ok(result.verification?.confirmed&&result.verification.version>=LISTING_RESOLVER_VERSION);
    assert.equal(directListingUrl(result.listing?.sourceUrl),directListingUrl(result.verification.url));
  }
  if(result.state==='closed') assert.equal(result.evidence?.confirmed,true);
  return result.state;
}));
assert.ok(results.includes('active'),'No directly verified public listing was returned');
const wellington=feed.listings.filter(listing=>/wellington/i.test([listing.address,listing.label,listing.metadata?.description].filter(Boolean).join(" ")));
console.log(JSON.stringify({discovered:feed.listings.length,wellington:wellington.length,adapterCounts:feed.meta?.adapters?.filter(a=>/wellington/i.test(a.id)).map(a=>({id:a.id,count:a.count,ok:a.ok})),verifiedSamples:results}));
