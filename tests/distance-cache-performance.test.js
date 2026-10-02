import test from "node:test";
import assert from "node:assert/strict";
import {getCachedPropertyDistances} from "../src/integrations/maps.js";
test("sorting hundreds of unresolved distances reads the persisted distance cache once",()=>{
 let reads=0;
 globalThis.localStorage={getItem(){reads++;return JSON.stringify({"unrelated|cache":1});}};
 const poi={id:"poi",address:"Saved address",lat:40.58,lng:-105.08};
 for(let pass=0;pass<3;pass++)for(let i=0;i<500;i++){
   const rows=getCachedPropertyDistances({id:i,address:"Unresolved "+i},[poi]);
   assert.equal(rows[0].resolved,false);
 }
 assert.equal(reads,1);
});