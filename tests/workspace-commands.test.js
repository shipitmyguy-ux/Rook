import test from "node:test";
import assert from "node:assert/strict";
import { runWorkspaceCommand } from "../src/core/workspace-commands.js";
import { createScratchSession } from "../src/core/scratch-session.js";
import { normalizePreferences, loadPreferences } from "../src/core/preferences.js";
import { matchesWorkspacePreferences } from "../src/core/workspace-filters.js";

const memory = () => { const data = new Map(); return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)}; };
test("hide apartments applies to existing, pinned and newly discovered apartments and persists", async () => {
  const storage=memory();
  const rows=[{id:'a',type:'Apartment'}, {id:'label-apt',type:'Property',label:'Example Apartments'},
    {id:'town',type:'Townhome'}, {id:'house',type:'House'}, {id:'unknown',type:'Property'}];
  const session=createScratchSession('hide-types',{storage});
  session.togglePin('a');
  const options={session,store:{getAll:()=>rows}};
  await runWorkspaceCommand('hide apartments',options);
  assert.deepEqual(session.apply(rows).map(p=>p.id),['town','house','unknown']);
  const reloaded=createScratchSession('hide-types',{storage});
  assert.equal(reloaded.apply([{id:'new',type:'Condo'}]).length,0);
  await runWorkspaceCommand('restore apartments',{...options,session:reloaded});
  assert.equal(reloaded.apply(rows).length,5);
  await runWorkspaceCommand('undo',{...options,session:reloaded});
  assert.equal(reloaded.apply(rows).length,3);
  reloaded.removeFilter('excludedTypes');
  assert.equal(reloaded.apply(rows).length,5);
  await runWorkspaceCommand('hide all apartments from the map',options);
  assert.equal(session.apply(rows).length,3);
});
test("workspace filters require known matching price and bedrooms, even for pins", () => {
  const prefs = {maxPrice:2800,minBeds:2};
  assert.equal(matchesWorkspacePreferences({price:2800,beds:2},prefs),true);
  for (const p of [{price:2801,beds:2},{price:2200,beds:1},{price:null,beds:2},{price:2200,beds:null}]) assert.equal(matchesWorkspacePreferences(p,prefs),false);
  assert.equal(matchesWorkspacePreferences({}, {maxPrice:null,minBeds:0}),true);
});
test("first filtered workspace inherits Main price and bedroom limits only", () => {
  const previousStorage=globalThis.localStorage,previousLocation=globalThis.location;
  try {
    globalThis.localStorage=memory(); globalThis.location={search:"?workspace=laurel-rentals"};
    localStorage.setItem("rook.preferences.v1",JSON.stringify({maxPrice:2350,minBeds:3,location:"Other city"}));
    const prefs=loadPreferences({}, {inheritMain:true});
    assert.equal(prefs.maxPrice,2350); assert.equal(prefs.minBeds,3); assert.equal(prefs.location,"Fort Collins, CO");
    localStorage.setItem("rook.preferences.v1",JSON.stringify({maxPrice:9000,minBeds:1}));
    assert.equal(loadPreferences({}, {inheritMain:true}).maxPrice,2350);
  } finally {globalThis.localStorage=previousStorage;globalThis.location=previousLocation;}
});
test("missing preferences retain defaults while explicit unlimited remains valid", () => {
  assert.equal(normalizePreferences().maxPrice,2800);
  assert.equal(normalizePreferences().minBeds,2);
  assert.equal(normalizePreferences({maxPrice:null,minBeds:0}).maxPrice,null);
  assert.equal(normalizePreferences({maxPrice:null,minBeds:0}).minBeds,0);
});
test("prompt hides, restores and undoes a particular listing without affecting other rows", async () => {
  const rows=[{id:"a",address:"100 Example St"},{id:"b",address:"200 Example St"}];
  const session=createScratchSession("one",{storage:memory()}); const options={session,store:{getAll:()=>rows}};
  await runWorkspaceCommand("hide 100 Example St",options);
  assert.deepEqual(session.apply(rows).map(p=>p.id),["b"]);
  await runWorkspaceCommand("restore 100 Example St",options);
  assert.equal(session.apply(rows).length,2);
  await runWorkspaceCommand("undo",options);
  assert.deepEqual(session.apply(rows).map(p=>p.id),["b"]);
});
test("prompt additions use existing resolver and must pass spatial qualification", async () => {
  const rows=[]; const session=createScratchSession("two",{storage:memory()});
  const options={session,store:{getAll:()=>rows,upsert:p=>rows.push(p)},resolve:async p=>({state:"active",listing:{...p,price:2400,beds:2}}),qualify:async()=>[]};
  assert.match(await runWorkspaceCommand("add 100 Example St",options),/outside/); assert.equal(rows.length,0);
  options.qualify=async rows=>rows;
  assert.match(await runWorkspaceCommand("add 100 Example St",options),/added/); assert.equal(rows.length,1);
});
test("unrecognized prompts provide guidance without mutating state", async () => {
  const session=createScratchSession("three",{storage:memory()});
  assert.match(await runWorkspaceCommand("do a thing",{session}),/Try:/);
  assert.equal(session.getState().history.length,0);
});
