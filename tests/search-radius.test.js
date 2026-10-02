import test from "node:test";
import assert from "node:assert/strict";
import {distanceMiles,pointWithinSearchRadius} from "../src/core/search-radius.js";
import {isPropertyWithinSearchRadius} from "../src/integrations/maps.js";
const center={lat:40.5853,lng:-105.0844};
const loveland={lat:40.3813678,lng:-105.1108067};
test("Loveland listing is inside 15 miles but outside 10 miles from the configured center",()=>{
 assert.ok(Math.abs(distanceMiles(loveland,center)-14.1587)<0.001);
 assert.equal(pointWithinSearchRadius(loveland,center,15),true);
 assert.equal(pointWithinSearchRadius(loveland,center,10),false);
 assert.equal(pointWithinSearchRadius(center,center,10),true);
 const boundary=distanceMiles(loveland,center);
 assert.equal(pointWithinSearchRadius(loveland,center,boundary),true);
});
test("reducing radius filters persisted geocoded listings without deleting their saved state",()=>{
 globalThis.localStorage={getItem:key=>key==="rook.geocode-cache.v2"?JSON.stringify({"2432 SW 10th Street":loveland}):"{}"};
 const property={id:"cached",address:"2432 SW 10th Street",saved:true,status:"shortlisted"};
 assert.equal(isPropertyWithinSearchRadius(property,{center,radiusMiles:15}),true);
 assert.equal(isPropertyWithinSearchRadius(property,{center,radiusMiles:10}),false);
 assert.equal(property.saved,true);
 assert.equal(property.status,"shortlisted");
 assert.equal(isPropertyWithinSearchRadius({lat:40.59,lng:-105.02},{center,radiusMiles:10}),true);
 assert.equal(isPropertyWithinSearchRadius({address:"Unresolved address"},{center,radiusMiles:10}),true);
});

test("the map source also rejects an outside-radius property",async()=>{
 const {renderPropertyMap}=await import("../src/integrations/maps.js");
 let data,onStyle;
 const map={addControl(){},on(event,handler){if(event==="style.load")onStyle=handler;},getSource(){return {setData(value){data=value}};},getLayer(){return true;},setFilter(){},fitBounds(){},jumpTo(){},getStyle(){return {layers:[],sources:{}};}};
 globalThis.window={maplibregl:{Map:function(){return map;},AttributionControl:function(){}}};
 const container={replaceChildren(){},dataset:{}};
 renderPropertyMap(container,[{id:"near",lat:40.59,lng:-105.02},{id:"far",...loveland}],{center,radiusMiles:10});
 await new Promise(resolve=>setImmediate(resolve));onStyle();
 assert.deepEqual(data.features.map(f=>f.id),["near"]);
});
