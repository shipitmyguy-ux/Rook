import test from "node:test";
import assert from "node:assert/strict";
import {renderPropertyMap} from "../src/integrations/maps.js";
test("publisher coordinates override configured street fallbacks and retain a named tour marker",async()=>{
 const address="180 N Aria Way, Fort Collins, CO 80524";
 const sourceUrl="https://hotpads.com/bloom-rental-living-fort-collins-co-80524-24p4wg2/pad";
 const cache={["publisher:"+sourceUrl+"|"+address]:{lat:40.5889485,lng:-105.017353}};
 globalThis.localStorage={getItem:()=>JSON.stringify(cache)};
 let data,onStyle;
 const map={addControl(){},on(event,handler){if(event==="style.load")onStyle=handler;},getSource(){return {setData(value){data=value}};},getLayer(){return true;},setFilter(){},fitBounds(){},jumpTo(){},getStyle(){return {layers:[],sources:{}};}};
 globalThis.window={maplibregl:{Map:function(){return map;},AttributionControl:function(){}}};
 const container={replaceChildren(){},dataset:{}};
 renderPropertyMap(container,[{id:"bloom",label:"Bloom Rental Living",address,sourceUrl,metadata:{mapPoint:{lat:40.5904928,lng:-105.0175825},tour:{startsAt:new Date(Date.now()+86400000).toISOString()}}}]);
 await new Promise(resolve=>setImmediate(resolve));onStyle();
 assert.deepEqual(data.features[0].geometry.coordinates,[-105.017353,40.5889485]);
 assert.equal(data.features[0].properties.label,"Bloom Rental Living");
 assert.equal(data.features[0].properties.hasTour,true);
});