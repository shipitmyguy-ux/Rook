import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

test('edge instances share an atomic lease, old owners cannot release a new lease, and warm searches skip crawlers',async()=>{
  const table=new Map();let handler, external=0;
  const previousFetch=globalThis.fetch;
  globalThis.Deno={env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'test-service-key':undefined},serve:fn=>{handler=fn;}};
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(input),key=url.searchParams.get('cache_key')?.replace(/^eq\./,'');
    if(url.pathname.includes('/rook_discovery_cache')) {
      if(init.method==='POST'){
        const row=JSON.parse(init.body),old=table.get(row.cache_key);
        if(init.headers?.Prefer?.includes('ignore-duplicates')&&old)return Response.json([]);
        table.set(row.cache_key,row);return Response.json([row]);
      }
      if(init.method==='PATCH'){
        const old=table.get(key);if(!old)return Response.json([]);
        const expires=url.searchParams.get('expires_at')?.replace(/^lte\./,'');
        const token=url.searchParams.get('payload->>token')?.replace(/^eq\./,'');
        if((expires&&old.expires_at>expires)||(token&&old.payload.token!==token))return Response.json([]);
        const row={...old,...JSON.parse(init.body)};table.set(key,row);return Response.json([row]);
      }
      return Response.json(table.has(key)?[table.get(key)]:[]);
    }
    if(url.pathname.includes('/config/'))return Response.json(JSON.parse(await fs.readFile(new URL('../config/'+url.pathname.split('/').pop(),import.meta.url),'utf8')));
    external++;throw Error('An adequate cached result must not contact providers');
  };
  const cachePath=new URL('../supabase/functions/rook-listings/.speed-cache.mjs',import.meta.url);
  const indexPath=new URL('../supabase/functions/rook-listings/.speed-index.mjs',import.meta.url);
  try {
    const cache=await fs.readFile(new URL('../supabase/functions/rook-listings/cache.ts',import.meta.url),'utf8');
    await fs.writeFile(cachePath,stripTypeScriptTypes(cache));
    const a=await import(cachePath.href+'?instance=a'),b=await import(cachePath.href+'?instance=b');
    const [first,second]=await Promise.all([a.claimLease('lease:test'),b.claimLease('lease:test')]);
    assert.equal([first,second].filter(Boolean).length,1);
    table.get('lease:test').expires_at=new Date(0).toISOString();
    const replacement=await b.claimLease('lease:test');assert.ok(replacement);
    await a.releaseLease('lease:test',first||second);assert.equal(table.get('lease:test').payload.token,replacement);assert.ok(Date.parse(table.get('lease:test').expires_at)>Date.now());
    const listings=Array.from({length:30},(_,i)=>({address:`${100+i} Main St, Fort Collins, CO`,sourceUrl:`https://manager.test/${i}`,price:1800,beds:2,lat:40.55,lng:-105.07}));
    await a.writeCache('area:v1:fortcollinsco',{listings},5*60000);
    const index=await fs.readFile(new URL('../supabase/functions/rook-listings/index.ts',import.meta.url),'utf8');
    await fs.writeFile(indexPath,stripTypeScriptTypes(index).replace('./cache.ts','./.speed-cache.mjs'));
    await import(indexPath.href);
    const response=await handler(new Request('https://api.test/?stream=1&location=Fort%20Collins%2C%20CO'));
    const batches=(await response.text()).trim().split('\n').map(JSON.parse);
    assert.equal(batches[0].listings.length,25);assert.equal(batches[0].meta.source,'area-snapshot');assert.equal(batches.at(-1).meta.done,true);assert.equal(batches.at(-1).meta.paused,true);
    assert.equal(external,0);assert.equal(table.get('area:v1:fortcollinsco').payload.listings.length,30);
  } finally {
    globalThis.fetch=previousFetch;delete globalThis.Deno;
    await fs.rm(cachePath,{force:true});await fs.rm(indexPath,{force:true});
  }
});
