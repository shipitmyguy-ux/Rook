import test from 'node:test';
import assert from 'node:assert/strict';
import { directListingUrl, hasVerifiedListing, listingAction, needsListingCheck, LISTING_MAX_AGE } from '../src/core/listing.js';
import { filterProperties, normalizeProperty } from '../src/core/property.js';
import { dedupeProperties } from '../src/core/dedupe.js';
import { createPropertyStore } from '../src/core/store.js';
import { resolveMissingListing } from '../src/integrations/providers.js';
import { assessListingPage, verifyDirectListing } from '../supabase/functions/rook-listings/verification.js';
import { verifiedProperty, verification } from './listing-fixtures.js';

const url = 'https://rentals.example.test/100-main';
const property = { id:'home', address:'100 Main St Unit A, Fort Collins, CO', label:'100 Main St Unit A', sourceUrl:url, listingType:'rent' };
const closed = () => ({ ...verifiedProperty(property), listingState:'closed', metadata:{ listingClosedEvidence:{ confirmed:true } } });

test('search pages and ZIP indexes cannot become listing links', () => {
  for (const link of ['', 'javascript:alert(1)', 'https://www.google.com/search?q=home', 'https://www.zillow.com/fort-collins-co-80528/rentals/', 'https://www.rent.com/colorado/fort-collins-apartments', 'https://www.realtor.com/apartments/Fort-Collins_CO']) assert.equal(directListingUrl(link), null, link);
  assert.ok(directListingUrl('https://www.zillow.com/homedetails/100-Main/123_zpid/'));
  assert.ok(directListingUrl('https://www.rent.com/apartment/the-landing-at-lemay-fort-collins-co-lc6340753'));
});

test('main results exclude missing, unverified, expired, and confirmed closed listings; history stays accessible', () => {
  const active = verifiedProperty(property);
  const missing = normalizeProperty({id:'missing', saved:true});
  const unchecked = normalizeProperty({id:'unchecked', sourceUrl:url});
  const expired = verifiedProperty({...property, id:'expired', listingCheckedAt:new Date(Date.now()-LISTING_MAX_AGE-1).toISOString()});
  const rows = [active,missing,unchecked,expired,{...closed(),id:'closed'}];
  assert.deepEqual(filterProperties(rows,'all').map(p=>p.id), ['home']);
  assert.deepEqual(filterProperties(rows,'rent').map(p=>p.id), ['home']);
  assert.equal(filterProperties(rows,'review').length, 4);
  assert.equal(filterProperties(rows,'shortlist').length, 0);
  assert.ok(filterProperties(rows,'review').some(p=>p.id==='missing' && p.saved));
  assert.equal(listingAction(closed()).url, null);
  assert.equal(listingAction(closed()).closed, true);
});

test('expired complete records are checked, and unknown records respect cooldown', () => {
  const active = verifiedProperty(property);
  assert.equal(needsListingCheck(active), false);
  assert.equal(needsListingCheck(active, Date.parse(active.listingCheckedAt)+LISTING_MAX_AGE), true);
  assert.equal(needsListingCheck({...active,listingState:'unknown'}), false);
  assert.equal(needsListingCheck({...active,listingState:'unknown'}, Date.parse(active.listingCheckedAt)+31*60000), true);
  assert.equal(needsListingCheck({...active,status:'rejected'}), false);
});

test('fresh closure survives refresh and seed reload; only newer verification can reopen it', () => {
  const old = verifiedProperty({...property,listingCheckedAt:'2026-09-20T00:00:00Z'});
  const shut = {...closed(),saved:true,note:'Keep tour notes',showingAt:'2026-10-03T17:00:00Z',listingCheckedAt:'2026-09-27T00:00:00Z'};
  for (const rows of [[old,shut],[shut,old]]) {
    const [merged] = dedupeProperties(rows);
    assert.equal(merged.listingState,'closed');
    assert.equal(listingAction(merged).url,null);
    assert.equal(merged.saved,true);
  }
  const saved = new Map();
  globalThis.localStorage = {getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
  const store = createPropertyStore([old]);
  store.upsert(shut);
  store.upsert({...property,price:1800});
  const reloaded = createPropertyStore([old]).getAll()[0];
  assert.equal(reloaded.listingState,'closed');
  assert.equal(reloaded.note,shut.note);
  assert.equal(reloaded.showingAt,shut.showingAt);
  const newer = verifiedProperty({...property,sourceUrl:'https://rentals.example.test/new-source',listingCheckedAt:'2026-09-28T00:00:00Z'});
  store.upsert(newer);
  const reopened = store.getAll()[0];
  assert.equal(reopened.listingState,'active');
  assert.equal(reopened.sourceUrl,newer.sourceUrl);
  assert.equal(reopened.metadata.listingClosedEvidence,undefined);
  delete globalThis.localStorage;
});

test('backend requires matching property and positive availability, including the correct unit', () => {
  assert.equal(assessListingPage('100 Main St Unit A is for rent at $1,800/mo',property).state,'active');
  for (const text of ['200 Main St Unit A is for rent at $1,800/mo','100 Main St Unit B is for rent at $1,800/mo','100 Main St Unit AB is for rent at $1,800/mo','100 Main St Unit A. 2 beds, 1 bath. Rent Zestimate: $1,800','100 Main St Unit A. Sold in 2022.']) assert.equal(assessListingPage(text,property).state,'unknown',text);
  assert.equal(assessListingPage('100 Main St Unit A is no longer for rent. Previously $1,800/mo',property).state,'closed');
});

test('HTTP 200 archived pages cannot pass through stale titles or historical prices', () => {
  const html = '<title>100 Main St Unit A for rent $1,800/mo</title><main>This property is no longer for rent.</main>';
  assert.equal(assessListingPage(html, property, {html:true}).state, 'closed');
  const oldStatus = '<title>100 Main St Unit A for rent $1,800/mo</title><script>{"homeStatus":"OFF_MARKET"}</script>';
  assert.equal(assessListingPage(oldStatus, property, {html:true}).state, 'unknown');
});

test('direct verification rejects redirects, unreachable/challenge pages, and confirms reader closure', async () => {
  let readers=0;
  let result = await verifyDirectListing(property,{inspect:async()=>({reachable:true,html:'',finalUrl:'https://www.zillow.com/fort-collins-co/rentals/'}),reader:async()=>{readers++;return ''}});
  assert.equal(result.state,'unknown'); assert.equal(readers,0);
  result=await verifyDirectListing(property,{inspect:async()=>({reachable:false,reason:'http-404-410'}),reader:async()=>''});
  assert.equal(result.state,'closed'); assert.equal(result.evidence.confirmed,true);
  result=await verifyDirectListing(property,{inspect:async()=>({reachable:false}),reader:async()=> '100 Main St Unit A is no longer for rent. $1,800/mo'});
  assert.equal(result.state,'closed');
  result=await verifyDirectListing(property,{inspect:async()=>({reachable:true,html:'<h1>100 Main St Unit A</h1><p>captcha</p>'}),reader:async()=> 'Verify you are human'});
  assert.equal(result.state,'unknown');
});

test('client rejects contradictory, unverified, and index-only resolver payloads', async () => {
  for (const payload of [
    {state:'closed',listing:{...property},evidence:{confirmed:true}},
    {state:'active',listing:{...property}},
    {state:'active',listing:{...property,sourceUrl:'https://www.zillow.com/fort-collins-co/rentals/'},verification:verification('https://www.zillow.com/fort-collins-co/rentals/')}
  ]) {
    const result=await resolveMissingListing(property,{},async()=>({ok:true,json:async()=>payload}));
    assert.notEqual(result.state,'active');
  }
});
