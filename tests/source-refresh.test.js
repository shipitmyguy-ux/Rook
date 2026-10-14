import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {directListingUrl} from '../src/core/listing.js';
const source=fs.readFileSync(new URL('../supabase/functions/rook-listings/index.ts',import.meta.url),'utf8');
test('every configured provider refreshes despite adequate saved coverage',async()=>{
 const start=source.indexOf('      const providers=(runtimeDiscovery.providers'),end=source.indexOf('      const freshCandidates=',start);
 const ids=['realtor','rent','apartmentlist','apartments','hotpads','trulia','zillow'],calls=[];
 const ctx={runtimeDiscovery:{providers:{providers:ids.map(id=>({id,cityFeed:'https://example.com/'+id,browserDiscovery:false}))}},primaryCity:'Fort Collins',renderFeedTemplate:v=>v,sourceRefreshes:[],snapshotKey:'area',hotpadsRefresh:null,uncachedSearchDiscovery:async()=>({id:'search-discovery',listings:[]}),sourceAdapter:async(id,label,url,browser,force)=>{calls.push({id,force});return {id,listings:[{sourceUrl:url}],discovery:{freshCount:1}}},readCache:async()=>null,writeCache:async()=>{}};
 vm.createContext(ctx);await vm.runInContext(stripTypeScriptTypes('(async()=>{'+source.slice(start,end)+'})()'),ctx);
 assert.equal(calls.length,7);assert.ok(calls.every(call=>call.force));
});
test('public JSON reads hydration and community-only listings without inventing unit prices',()=>{
 const code=source.slice(source.indexOf('function discoveryJsonListings('),source.indexOf('async function structuredDiscovery'));
 const ctx={URL,JSON,num:v=>{const m=String(v??'').replace(/,/g,'').match(/\d+(?:\.\d+)?/);return m?Number(m[0]):null},absolute:(v,b)=>v?new URL(v,b).href:null,directListingUrl,isAllowedListingHost:()=>true,propertySquareFeet:()=>null,jsonLdListings:()=>[]};
 vm.createContext(ctx);vm.runInContext(stripTypeScriptTypes(code),ctx);
 const fixtures=[
 ['zillow','https://www.zillow.com/fort-collins-co/rentals/',{detailUrl:'https://www.zillow.com/homedetails/123-Test-Dr-Fort-Collins-CO-80524/123_zpid/',addressStreet:'123 Test Dr',addressCity:'Fort Collins',unformattedPrice:2400,beds:3}],
 ['trulia','https://www.trulia.com/for_rent/Fort_Collins,CO/',{url:'/building/example-123-test-dr-fort-collins-co-80524-123',location:{streetAddress:'123 Test Dr',city:'Fort Collins'},price:{min:1000,max:2000},bedrooms:{min:1,max:3}}],
 ['apartmentlist','https://www.apartmentlist.com/co/fort-collins',{name:'Example Community',url:'https://www.apartmentlist.com/co/fort-collins/example',offers:{lowPrice:1000,highPrice:2000}}]
 ];
 for(const [provider,url,item] of fixtures){const html='<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{listings:[item]}})+'</script>';const rows=ctx.publicPageListings(html,provider,url);assert.equal(rows.length,1,provider);assert.ok(rows[0].address||rows[0].label);if(provider!=='zillow')assert.equal(rows[0].price,null)}
});
test('normal JSON and stream responses include every discovered candidate',async()=>{
 const tail=source.slice(source.lastIndexOf('  const needsRefinement=')).trim().replace(/\}\);$/,'');
 const rows=Array.from({length:160},(_,i)=>({address:'House '+i}));rows[138]={address:'1121 Fenwick Dr'};
 for(const stream of [false,true]){const ctx={Response,ReadableStream,TextEncoder,Date,JSON,quick:{discovery:{}},quickListings:rows.slice(0,25),selectListings:r=>r,refine:async()=>rows,hotpadsRefresh:null,sourceRefreshes:[],jobState:'paused',discoveryStarted:Date.now(),url:new URL('https://example.com/'+(stream?'?stream=1':'')),corsHeaders:{}};
 vm.createContext(ctx);const response=await vm.runInContext(stripTypeScriptTypes('(async()=>{'+tail+'})()'),ctx);const text=await response.text();const body=JSON.parse(stream?text.trim().split('\n').at(-1):text);assert.equal(body.listings.length,160);assert.equal(body.listings[138].address,'1121 Fenwick Dr')}
});
