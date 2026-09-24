import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ORIGINS = new Set(["https://shipitmyguy-ux.github.io","http://localhost:3000","http://localhost:5173"]);
const ALLOWED = new Set(["ping","start","stop","open","snapshot","screenshot","click","type","select","wait","smoke"]);

function H(req:Request){
  const o=req.headers.get("origin")||"";
  return {"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":ORIGINS.has(o)?o:"https://shipitmyguy-ux.github.io","access-control-allow-headers":"content-type,x-rook-client","access-control-allow-methods":"POST,OPTIONS","vary":"Origin"};
}
function O(req:Request,d:any,s=200){return new Response(JSON.stringify(d),{status:s,headers:H(req)})}
function key(){const k=Deno.env.get("STEEL_API_KEY");if(!k)throw Error("STEEL_API_KEY unavailable");return k}
async function steel(path:string,init:RequestInit={}){
  const r=await fetch("https://api.steel.dev"+path,{...init,headers:{"steel-api-key":key(),"content-type":"application/json",...(init.headers||{})}});
  const t=await r.text();let b:any={};try{b=t?JSON.parse(t):{}}catch{b={raw:t.slice(0,500)}}
  if(!r.ok)throw Error(b?.message||b?.error||("Steel API "+r.status));return b;
}
async function start(){
  return await steel("/v1/sessions",{method:"POST",body:JSON.stringify({timeout:600000,inactivityTimeout:120000,dimensions:{width:1440,height:1000}})});
}
async function stop(id:string){return await steel("/v1/sessions/"+encodeURIComponent(id)+"/release",{method:"POST"})}

class C{
  ws:WebSocket;n=0;p=new Map<number,any>();
  constructor(w:WebSocket){this.ws=w;w.onmessage=e=>{try{const m=JSON.parse(String(e.data)),p=this.p.get(m.id);if(!p)return;clearTimeout(p.t);this.p.delete(m.id);m.error?p.j(Error(m.error.message)):p.r(m.result||{})}catch{}}}
  send(method:string,params:any={},sessionId?:string){const id=++this.n;return new Promise<any>((r,j)=>{const t=setTimeout(()=>{this.p.delete(id);j(Error("CDP timeout: "+method))},15000);this.p.set(id,{r,j,t});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})}
}
async function conn(id:string){
  const w=new WebSocket("wss://connect.steel.dev?apiKey="+encodeURIComponent(key())+"&sessionId="+encodeURIComponent(id));
  await new Promise<void>((r,j)=>{const t=setTimeout(()=>j(Error("Steel websocket timeout")),15000);w.onopen=()=>{clearTimeout(t);r()};w.onerror=()=>j(Error("Steel websocket connection failed"))});return w;
}
async function page(c:C){
  const x=await c.send("Target.getTargets"),p=(x.targetInfos||[]).find((v:any)=>v.type==="page");if(!p)throw Error("No page target found");
  return (await c.send("Target.attachToTarget",{targetId:p.targetId,flatten:true})).sessionId;
}
async function ev(c:C,s:string,e:string){
  const r=await c.send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true},s);if(r.exceptionDetails)throw Error(r.exceptionDetails.text||"Page evaluation failed");return r?.result?.value;
}
async function withPage(id:string,fn:(c:C,s:string)=>Promise<any>){
  const w=await conn(id),c=new C(w);try{const s=await page(c);await c.send("Runtime.enable",{},s);return await fn(c,s)}finally{w.close()}
}

async function act(a:string,b:any){
  const id=String(b.sessionId||"");if(!id)throw Error("sessionId required");
  return await withPage(id,async(c,s)=>{
    if(a==="open"){
      const u=String(b.url||"");if(!/^https?:\/\//i.test(u))throw Error("Valid URL required");
      await c.send("Page.enable",{},s);await c.send("Page.navigate",{url:u},s);return{ok:true,action:a,url:u};
    }
    if(a==="wait"){const ms=Math.max(0,Math.min(10000,Number(b.ms||500)));await new Promise(r=>setTimeout(r,ms));return{ok:true,action:a,ms}}
    if(a==="snapshot"){const v=await ev(c,s,`JSON.stringify({url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,30000),links:[...document.querySelectorAll('a[href]')].slice(0,160).map(a=>({text:(a.innerText||a.textContent||'').trim().slice(0,180),href:a.href,context:(a.closest('div,li,article')?.innerText||a.parentElement?.innerText||'').trim().slice(0,600)})).filter(x=>/^https?:/i.test(x.href))})`);return{ok:true,action:a,snapshot:JSON.parse(v||"{}")}}
    if(a==="screenshot"){await c.send("Page.enable",{},s);const r=await c.send("Page.captureScreenshot",{format:"png",fromSurface:true},s);return{ok:true,action:a,mime:"image/png",data:r.data,bytes:Math.round((r.data?.length||0)*.75)}}

    const selector=String(b.selector||"");if(!selector)throw Error("selector required");const sel=JSON.stringify(selector);
    if(a==="click"){
      const v=await ev(c,s,`(()=>{const e=document.querySelector(${sel});if(!e)return {ok:false,error:'Element not found'};e.click();return {ok:true}})()`);
      if(!v?.ok)throw Error(v?.error||"Click failed");return{ok:true,action:a};
    }
    if(a==="select"){
      const val=JSON.stringify(String(b.text??b.value??""));
      const v=await ev(c,s,`(()=>{const e=document.querySelector(${sel});if(!e)return {ok:false,error:'Element not found'};if(!(e instanceof HTMLSelectElement))return {ok:false,error:'Element is not a select'};e.value=${val};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,value:e.value}})()`);
      if(!v?.ok)throw Error(v?.error||"Select failed");return{ok:true,action:a,value:v.value};
    }
    const txt=JSON.stringify(String(b.text||""));
    const v=await ev(c,s,`(()=>{const e=document.querySelector(${sel});if(!e)return {ok:false,error:'Element not found'};e.focus();const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const set=Object.getOwnPropertyDescriptor(proto,'value')?.set;set?set.call(e,${txt}):e.value=${txt};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,value:e.value}})()`);
    if(!v?.ok)throw Error(v?.error||"Type failed");return{ok:true,action:a,value:v.value};
  });
}

async function smoke(){
  const target="https://shipitmyguy-ux.github.io/Rook/",session=await start(),id=String(session.id||"");if(!id)throw Error("Steel did not return a session id");
  try{
    return await withPage(id,async(c,s)=>{
      await c.send("Page.enable",{},s);await c.send("Page.navigate",{url:target},s);await new Promise(r=>setTimeout(r,1800));
      const initial=await ev(c,s,"({title:document.title,h1:document.querySelector('h1')?.textContent||'',count:document.querySelector('#property-count')?.textContent||''})");
      const rent=await ev(c,s,"(()=>{const e=document.querySelector('[data-filter=rent]');if(!e)return false;e.click();return true})()");
      if(!rent)throw Error("Rent filter not found");
      const typed=await ev(c,s,"(()=>{const e=document.querySelector('#property-search');if(!e)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;set?set.call(e,'Timberwood'):e.value='Timberwood';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      if(!typed)throw Error("Search input not found");
      await new Promise(r=>setTimeout(r,250));
      const final=await ev(c,s,"({url:location.href,rentActive:document.querySelector('[data-filter=rent]')?.classList.contains('active')||false,searchValue:document.querySelector('#property-search')?.value||'',count:document.querySelector('#property-count')?.textContent||'',cards:document.querySelectorAll('.property-card').length})");
      const shot=await c.send("Page.captureScreenshot",{format:"png",fromSurface:true},s);
      const ok=initial?.title==="Rook"&&String(initial?.h1||"").trim()==="ROOK"&&final?.rentActive===true&&final?.searchValue==="Timberwood";
      return{ok,action:"smoke",target,sessionId:id,viewerUrl:session.sessionViewerUrl||session.debugUrl||null,initial,final,screenshotBytes:Math.round((shot.data?.length||0)*.75)};
    });
  }finally{try{await stop(id)}catch{}}
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H(req)});
  if(req.method!=="POST")return O(req,{error:"POST required"},405);
  const o=req.headers.get("origin")||"";if(o&&!ORIGINS.has(o))return O(req,{error:"Origin not allowed"},403);
  if(req.headers.get("x-rook-client")!=="rook-web-v1")return O(req,{error:"Rook client header required"},403);
  try{
    const b=await req.json(),a=String(b.action||"");if(!ALLOWED.has(a))return O(req,{error:"Unsupported browser action"},400);
    if(a==="ping")return O(req,{ok:true,service:"rook-browser-worker",version:1,steelKeyConfigured:!!Deno.env.get("STEEL_API_KEY")});
    if(a==="start"){const s=await start();return O(req,{ok:true,action:a,sessionId:s.id,viewerUrl:s.sessionViewerUrl||s.debugUrl||null})}
    if(a==="stop"){const id=String(b.sessionId||"");if(!id)return O(req,{error:"sessionId required"},400);await stop(id);return O(req,{ok:true,action:a,sessionId:id})}
    if(a==="smoke"){const r=await smoke();return O(req,r,r.ok?200:500)}
    return O(req,await act(a,b));
  }catch(e){return O(req,{ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
