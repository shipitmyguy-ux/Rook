import test from 'node:test';
import assert from 'node:assert/strict';

test('background metadata updates do not resend 500 map pins; changed facts and style reload still render',async()=>{
  const {renderPropertyMap}=await import('../src/integrations/maps.js?runtime-perf');
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  let uploads=0,filters=0,onStyle,data;
  const map={addControl(){},on(event,fn){if(event==='style.load')onStyle=fn},getSource(){return {setData(value){uploads++;data=value}}},getLayer(){return true},setFilter(){filters++},fitBounds(){},jumpTo(){},getStyle(){return {layers:[],sources:{}}}};
  globalThis.window={maplibregl:{Map:function(){return map},AttributionControl:function(){}}};
  const container={replaceChildren(){},dataset:{}};
  const rows=Array.from({length:500},(_,i)=>({id:String(i),label:'Home '+i,lat:40.58+i/100000,lng:-105.08,price:2000}));
  renderPropertyMap(container,rows,{dataAlreadyFiltered:true});
  await new Promise(done=>setImmediate(done));onStyle();
  assert.equal(uploads,1);
  for(let i=0;i<20;i++)renderPropertyMap(container,rows.map(p=>({...p,metadata:{checkedAt:i}})),{dataAlreadyFiltered:true});
  assert.equal(uploads,1);assert.equal(filters,1);
  renderPropertyMap(container,[{...rows[0],price:2100},...rows.slice(1)],{dataAlreadyFiltered:true});
  assert.equal(uploads,2);assert.equal(data.features[0].properties.price,2100);
  onStyle();assert.equal(uploads,3);assert.equal(filters,2);
});
