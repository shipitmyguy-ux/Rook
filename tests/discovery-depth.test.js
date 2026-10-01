import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {directListingUrl} from '../src/core/listing.js';
import {nextPageUrl} from '../supabase/functions/rook-browser-worker/pagination.js';
import {createJsonProvider,matchesDiscoveryDefaults,matchesSearchDefaults} from '../src/integrations/providers.js';
import {dedupeProperties} from '../src/core/dedupe.js';

function backend(){
  const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/rook-listings/index.ts',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'');
  const context=vm.createContext({URL,Deno:{env:{get:()=>''},serve:()=>{}},directListingUrl,console,AbortSignal,Map,Set,Date,setTimeout,clearTimeout});
  vm.runInContext(source,context);return context;
}
test('card parsing rejects price-drop and bicycle-storage false addresses while preserving units',()=>{
  const c=backend();
  assert.equal(c.addressFromDiscoveryContext('$2,100 Price Drop 2 Beds 1 Bath 820 Sqft Bicycle storage'),'');
  assert.equal(c.addressFromDiscoveryContext('Available 123 Main Street Unit 4 Fort Collins CO $2,000 2 beds'),'123 Main Street Unit 4');
});
test('discovery retains more than 40 unique candidates and incomplete facts',()=>{
  const c=backend();const links=Array.from({length:120},(_,i)=>({href:`https://hotpads.com/listing-${i}/pad`,text:`${100+i} Main St`,context:`${100+i} Main St`}));
  const rows=c.browserDiscoveryListings({links:[...links,...links]},'HotPads');
  assert.equal(rows.length,120);assert.equal(rows[0].price,null);
});
test('numbered pagination follows only the next page within the same search and origin',()=>{
  const base='https://hotpads.com/fort-collins-co/apartments-for-rent';
  assert.equal(nextPageUrl(base,[{text:'2',href:base+'/page/2'},{text:'3',href:base+'/page/3'}]),base+'/page/2');
  assert.equal(nextPageUrl(base+'/page/2',[{text:'3',href:base+'/page/3'}]),base+'/page/3');
  assert.equal(nextPageUrl(base,[{text:'2',href:'https://example.com/page/2'},{text:'2',href:'https://hotpads.com/loveland/page/2'}]),null);
  assert.equal(nextPageUrl('https://www.zillow.com/fort-collins-co/rentals/',[{text:'2',href:'https://www.zillow.com/fort-collins-co/rentals/2_p/'}]),'https://www.zillow.com/fort-collins-co/rentals/2_p/');
});
test('rendered JSON normalization handles nested schemas without accepting index links',()=>{
  const c=backend();const rows=c.discoveryJsonListings([{data:{items:[{address:{streetAddress:'123 Main St',addressLocality:'Fort Collins'},url:'https://hotpads.com/123-main/pad',beds:2},{address:'123 Main St',url:'https://hotpads.com/fort-collins-co/apartments-for-rent'}]}}],'HotPads','https://hotpads.com/fort-collins-co/apartments-for-rent');
  assert.equal(rows.length,1);assert.equal(rows[0].beds,2);assert.equal(rows[0].metadata.discoveryMethod,'rendered-json');
});
test('unknown kinds enter enrichment without changing the visible criteria gate',()=>{
  const row={address:'123 Main St',type:'Property',price:null,beds:null};
  const criteria={propertyTypes:['house'],minBeds:2,maxPrice:3000};
  assert.equal(matchesDiscoveryDefaults(row,criteria),true);
  assert.equal(matchesSearchDefaults(row,criteria),false);
  assert.equal(matchesDiscoveryDefaults({...row,beds:1},criteria),false);
});
test('structured pagination merges observed linked pages and preserves partial results',async()=>{
  const c=backend();c.nextPageUrl=nextPageUrl;
  const base='https://hotpads.com/fort-collins-co/apartments-for-rent';
  c.fetchText=async url=>{
    if(url.endsWith('/page/3'))throw new Error('blocked page');
    const page=url.endsWith('/page/2')?2:1;
    return `<a href="${base}/page/2">2</a><a href="${base}/page/3">3</a><script type="application/ld+json">${JSON.stringify({address:`${page} Main St`,url:`https://hotpads.com/${page}-main/pad`,numberOfBedrooms:2})}</script>`;
  };
  const result=await c.structuredDiscovery(base,'HotPads');
  assert.equal(result.listings.length,2);assert.equal(result.pages,2);assert.equal(result.failedPages,1);
});
test('partitioned rental portals include non-apartment category feeds',()=>{
  const source=fs.readFileSync(new URL('../supabase/functions/rook-listings/index.ts',import.meta.url),'utf8');
  for (const token of [
    'hotpads-houses-',
    'hotpads-townhomes-',
    'rent-houses-',
    'rent-townhomes-',
    'rent-condos-',
    'apartments-houses-',
    'apartments-townhomes-',
    'apartments-condos-',
    'realtor-houses-',
    'realtor-townhomes-',
    'realtor-condos-'
  ]) assert.match(source,new RegExp(token));
});

test('streamed provider batches arrive before completion even when records cross byte chunks',async()=>{
  const encoder=new TextEncoder();let release;
  const blocked=new Promise(r=>release=r),batches=[];
  const line=JSON.stringify({listings:[{address:'123 Main St',beds:2}],meta:{count:1}})+'\n';
  const stream=new ReadableStream({async start(controller){controller.enqueue(encoder.encode(line.slice(0,19)));controller.enqueue(encoder.encode(line.slice(19)));await blocked;controller.enqueue(encoder.encode(JSON.stringify({listings:[],meta:{done:true,count:1}})+'\n'));controller.close();}});
  const provider=createJsonProvider({id:'test',endpoint:'https://example.com',fetchImpl:async()=>new Response(stream,{headers:{'content-type':'application/x-ndjson'}})});
  const pending=provider.search({}, {onResults:(rows,meta)=>batches.push({rows,meta})});
  await new Promise(r=>setTimeout(r,10));assert.equal(batches.length,1);assert.equal(batches[0].rows[0].address,'123 Main St');
  release();const results=await pending;assert.equal(results.length,1);assert.equal(batches[1].meta.done,true);
});

test('worker retains virtualized cards across scans, traverses next pages and releases its session',async()=>{
  const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/rook-browser-worker/index.ts',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'');
  let now=0,stopped=0,scan=0,page=1;
  const base='https://hotpads.com/fort-collins-co/apartments-for-rent';
  const context=vm.createContext({URL,nextPageUrl,Deno:{serve:()=>{}},WebSocket:class{},Request,Response,AbortSignal,console,Date:{now:()=>now},setTimeout:(fn,ms)=>{now+=ms;fn();return 1},clearTimeout:()=>{}});
  vm.runInContext(source,context);
  context.start=async()=>({id:'test'});context.stop=async()=>{stopped++};
  context.withPage=async(id,fn)=>fn({deadline:Infinity,events:[],send:async(method,params)=>{if(method==='Page.navigate'&&params.url!==base)page=2;return {}}},'test');
  context.ev=async(c,s,expression)=>{
    if(!expression.includes('const links='))return true;
    scan++;
    const n=page===2?3:scan===1?1:2;
    return {url:page===2?base+'/page/2':base,text:'Available rentals '.repeat(50),links:[{href:`https://hotpads.com/${n}-main/pad`,text:`${n} Main St`,context:`${n} Main St 2 beds $2000`}],next:page===1?base+'/page/2':null,hasNext:page===1};
  };
  const result=await context.discover({url:base});assert.equal(result.snapshot.links.length,3);assert.equal(result.discovery.pages,2);assert.equal(stopped,1);assert.ok(result.discovery.steps<16);
});
test('bounded search pool limits concurrent requests and preserves isolated failures',async()=>{
  const c=backend();let active=0,peak=0;
  const result=await c.mapSettledBounded([1,2,3,4,5,6],async value=>{
    active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;
    if(value===3)throw new Error('isolated failure');return value;
  },3);
  assert.equal(peak,3);assert.equal(result[2].status,'rejected');assert.equal(result[5].value,6);
});
test('warm source cache skips discovery entirely',async()=>{
  const c=backend();c.coalesce=async(key,fn)=>fn();
  c.readCache=async()=>({expires_at:new Date(Date.now()+60000).toISOString(),payload:{result:{id:'test',listings:[{address:'123 Main St'}],discovery:{pages:4}}}});
  c.fetchText=async()=>{throw new Error('must not fetch')};
  const result=await c.sourceAdapter('test','HotPads','https://hotpads.com/fort-collins-co/apartments-for-rent',true);
  assert.equal(result.listings.length,1);assert.equal(result.discovery.cacheHit,true);assert.equal(result.discovery.pages,4);
});
test('postal and street-suffix variants dedupe while distinct units and known cities survive',()=>{
  const common={label:'One Community',sourceUrl:'https://hotpads.com/common/pad'};
  const rows=dedupeProperties([
    {...common,id:'a',address:'123 Main Street Apt 4, Fort Collins, Colorado, 80525'},
    {...common,id:'b',address:'123 Main St Unit 4, Fort Collins, CO'},
    {...common,id:'c',address:'123 Main St Unit 5, Fort Collins, CO'},
    {...common,id:'d',address:'123 Main St Unit 4, Loveland, CO'}
  ]);
  assert.equal(rows.length,3);
  const c=backend();assert.equal(c.keyOf({address:'123 Main Street Unit 4, Fort Collins, CO 80525'}),c.keyOf({address:'123 Main St #4, Fort Collins, CO'}));
});
