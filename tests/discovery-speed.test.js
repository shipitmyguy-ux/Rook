import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedDiscovery, completePropertyMatch, exactPropertyMatch, backoffMilliseconds} from '../src/core/discovery-speed.js';
import {createSpeedMetrics} from '../src/core/speed-metrics.js';
import {createJsonProvider, resolveMissingListing} from '../src/integrations/providers.js';
import {listingAction, hasVerifiedListing} from '../src/core/listing.js';
import {verifiedProperty, verification} from './listing-fixtures.js';

const property={address:'100 Main St Unit A, Fort Collins, CO',sourceUrl:'https://manager.test/100-main-a',price:1800,beds:2,lat:40.55,lng:-105.07};
test('complete matches require the exact unit, price, beds, coordinates and no known conflict',()=>{
  assert.equal(completePropertyMatch(property,property),true);
  for(const patch of [{address:'100 Main St Unit B, Fort Collins, CO'},{address:'100 Main St, Fort Collins, CO'},{lat:null},{price:null},{metadata:{factsConflict:true}},{metadata:{priceFallback:true}}])assert.equal(completePropertyMatch(property,{...property,...patch}),false);
  assert.equal(exactPropertyMatch(property,{address:'100 Main Street #A, Fort Collins, CO'}),true);
});
test('area discovery stops at adequate coverage and bounds concurrent source work',async()=>{
  let started=0,active=0,max=0;
  const tasks=Array.from({length:80},(_,i)=>async()=>{
    started++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,3));active--;
    return {id:String(i),listings:Array.from({length:15},(_,j)=>({address:`${i}-${j}`}))};
  });
  const result=await boundedDiscovery(tasks,{identity:p=>p.address});
  assert.equal(max,2);assert.ok(started<=3);assert.ok(result.listings.length>=25);assert.equal(result.paused,true);
  started=0;await boundedDiscovery(tasks,{initial:result.listings,identity:p=>p.address});assert.equal(started,0);
});
test('sparse discovery has a request budget and preserves candidates across failed providers',async()=>{
  const result=await boundedDiscovery(Array.from({length:30},()=>async()=>{throw Error('429')}),{maxTasks:4,initial:[property]});
  assert.equal(result.attempted,4);assert.deepEqual(result.listings,[property]);assert.equal(backoffMilliseconds('Retry after 90000ms. Rate limit exceeded'),90000);
});
test('cached candidates render before network completion and survive empty responses',async()=>{
  const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
  let response={listings:[property]};
  const provider=createJsonProvider({id:'test',endpoint:'https://api.test/listings',fetchImpl:async()=>({ok:true,json:async()=>response})});
  await provider.search({location:'Fort Collins, CO'});
  response={listings:[]};let first;
  const result=await provider.search({location:'Fort Collins, CO'},{onResults:(rows,meta)=>{first||={rows,meta};}});
  assert.equal(first.meta.stage,'saved');assert.equal(first.rows[0].metadata.verificationPending,true);assert.equal(result.length,1);
  delete globalThis.localStorage;
});
test('complete verified property requires zero additional sources; incomplete match checks at most two',async()=>{
  let requests=0;
  const verified=verifiedProperty(property);
  await resolveMissingListing(verified,{},async()=>{requests++;throw Error('unexpected');});assert.equal(requests,0);
  const incomplete={...property,lat:null,metadata:{sourceUrls:[property.sourceUrl,'https://secondary.test/100-main-a','https://third.test/100-main-a']}};
  const result=await resolveMissingListing(incomplete,{},async()=>{requests++;return {ok:true,json:async()=>({state:'active',listing:{...property,lat:null},verification:verification(property.sourceUrl)})};});
  assert.ok(requests<=2);assert.equal(result.state,'active');
});
test('unverified source link remains usable without claiming verified availability',()=>{
  assert.equal(listingAction(property).url,property.sourceUrl);assert.equal(listingAction(property).candidate,true);assert.equal(hasVerifiedListing(property),false);
});
test('speed metrics keep first useful timings separate and never overwrite them',()=>{
  let clock=0;const metrics=createSpeedMetrics({now:()=>clock});clock=100;metrics.mark('firstVisibleCard');clock=400;metrics.mark('firstVisiblePin');clock=700;metrics.mark('firstCandidateBatch');clock=900;metrics.mark('firstVisibleCard');
  assert.deepEqual(metrics.snapshot(),{firstVisibleCard:{ms:100},firstVisiblePin:{ms:400},firstCandidateBatch:{ms:700}});
});
