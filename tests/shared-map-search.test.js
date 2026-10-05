import test from 'node:test';
import assert from 'node:assert/strict';
import { searchMainMap } from '../src/integrations/map-search.js';
import { createMapPointResolver } from '../src/integrations/map-points.js';
import { createPropertyStore } from '../src/core/store.js';
import { mainInventoryCandidates } from '../src/core/workspace-filters.js';

const storage = () => {const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};};

test('filtered workspace considers full Main inventory and preserves independent lifecycle state', async () => {
  globalThis.localStorage=storage();
  const rows=Array.from({length:184},(_,i)=>({id:`main-${i}`,address:`${i} Example St`,listingType:'rent',price:2000,beds:2,
    saved:true,note:'Main note',status:'showing-scheduled',showingAt:'2026-10-10T19:00:00Z',
    metadata:{tour:{startsAt:'2026-10-10T19:00:00Z'},workspacePropertyKey:`key-${i}`,mapPoint:{lat:40,lng:-105}}}));
  const main=createPropertyStore(rows);
  const temp=createPropertyStore([],{namespace:'full-inventory'});
  const qualified=[];
  await searchMainMap(temp,{}, {initialResults:mainInventoryCandidates(main.getAll()),
    search:async()=>[],transformResults:async candidates=>{
      qualified.push(...candidates.map(p=>p.id));
      return candidates.filter(p=>p.id==='main-183');
    }});
  assert.equal(qualified.length,184);
  assert.deepEqual(temp.getAll().map(p=>p.id),['main-183']);
  const copied=temp.getAll()[0];
  assert.equal(copied.saved,false);assert.equal(copied.note,'');assert.equal(copied.showingAt,null);
  assert.equal(copied.metadata.tour,undefined);assert.equal(copied.metadata.workspacePropertyKey,undefined);
  temp.update(copied.id,{status:'rejected'});
  assert.equal(main.getAll()[183].status,'showing-scheduled');
  assert.equal(main.getAll()[183].saved,true);
  assert.equal(mainInventoryCandidates([{listingType:'rent',status:'rejected'},{listingType:'buy'}]).length,0);
});

test('quick results display before refinement; existing Main history and temp isolation survive', async () => {
  globalThis.localStorage=storage();
  const main=createPropertyStore([{id:'kept',address:'10 Old St, Fort Collins, CO',saved:true,note:'Keep this',metadata:{tour:{startsAt:'2026-10-10T19:00:00Z'}}}]);
  const temp=createPropertyStore([{id:'temp-only',address:'20 Temp St, Fort Collins, CO'}],{namespace:'temp-test'});
  let finish;
  const search=async(criteria,{onResults})=>{
    onResults([{id:'quick',address:'30 New St, Fort Collins, CO',price:null}],{stage:'quick'});
    await new Promise(resolve=>{finish=resolve});
    return [{id:'quick',address:'30 New St, Fort Collins, CO',price:2100}];
  };
  const run=searchMainMap(main,{}, {search});
  assert.equal(main.getAll().length,2);
  assert.equal(main.getAll().find(p=>p.id==='quick').price,null);
  finish();await run;
  assert.equal(main.getAll().find(p=>p.id==='quick').price,2100);
  const kept=main.getAll().find(p=>p.id==='kept');
  assert.equal(kept.saved,true);assert.equal(kept.note,'Keep this');
  assert.equal(kept.metadata.tour.startsAt,'2026-10-10T19:00:00Z');
  assert.deepEqual(temp.getAll().map(p=>p.id),['temp-only']);
  await searchMainMap(temp,{}, {search:async()=>[{id:'new-temp',address:'40 Other St, Fort Collins, CO'}]});
  assert.equal(main.getAll().length,2);
  await assert.rejects(searchMainMap(main,{}, {search:async()=>{throw Error('offline')}}));
  assert.equal(main.getAll().length,2);
});

test('shared search filters streamed and final rows before saving filtered-workspace results', async () => {
  const workspace=createPropertyStore([],{namespace:'laurel-rentals-test'});
  const search=async(criteria,{onResults})=>{
    onResults([{id:'rental',listingType:'rent'},{id:'sale',listingType:'buy'}],{stage:'quick'});
    return [{id:'rental',listingType:'rent'},{id:'sale',listingType:'buy'}];
  };
  const found=await searchMainMap(workspace,{}, {
    search,
    transformResults:async rows=>rows.filter(row=>row.listingType==='rent'),
  });
  assert.deepEqual(found.map(row=>row.id),['rental']);
  assert.deepEqual(workspace.getAll().map(row=>row.id),['rental']);
});

test('coordinate resolver starts four lookups in parallel, coalesces repeats and caches results',async()=>{
  let active=0,max=0,calls=0;const releases=[];
  const resolve=createMapPointResolver({endpoint:'https://example.com/resolve',fetchImpl:async()=>{
    calls++;active++;max=Math.max(max,active);
    await new Promise(done=>releases.push(done));active--;
    return {ok:true,json:async()=>({point:{lat:40.5,lng:-105}})};
  }});
  const rows=Array.from({length:6},(_,i)=>({address:`${i} Test St`}));
  const tasks=rows.map(resolve);assert.equal(resolve(rows[0]),tasks[0]);
  await new Promise(done=>setImmediate(done));assert.equal(calls,4);
  releases.splice(0).forEach(done=>done());
  await new Promise(done=>setImmediate(done));assert.equal(calls,6);
  releases.splice(0).forEach(done=>done());await Promise.all(tasks);
  assert.equal(max,4);assert.deepEqual(await resolve(rows[0]),{lat:40.5,lng:-105});assert.equal(calls,6);
});

test('null coordinates are rejected and failed lookups retry after cooldown',async()=>{
  let clock=0,calls=0;
  const resolve=createMapPointResolver({endpoint:'https://example.com/',now:()=>clock,fetchImpl:async()=>({ok:true,json:async()=>{calls++;return {point:calls===1?{lat:null,lng:null}:{lat:40,lng:-105}}}})});
  assert.equal(await resolve({address:'Test'}),null);
  assert.equal(await resolve({address:'Test'}),null);assert.equal(calls,1);
  clock=60001;assert.deepEqual(await resolve({address:'Test'}),{lat:40,lng:-105});
});
