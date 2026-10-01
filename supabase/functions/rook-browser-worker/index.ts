import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {nextPageUrl} from "./pagination.js";

const ORIGINS = new Set(["https://shipitmyguy-ux.github.io","http://localhost:3000","http://localhost:5173"]);
const ALLOWED = new Set(["ping","start","stop","open","snapshot","screenshot","click","type","select","wait","scroll","smoke","discover"]);

function H(req:Request){
  const o=req.headers.get("origin")||"";
  return {"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":ORIGINS.has(o)?o:"https://shipitmyguy-ux.github.io","access-control-allow-headers":"content-type,x-rook-client","access-control-allow-methods":"POST,OPTIONS","vary":"Origin"};
}
function O(req:Request,d:any,s=200){return new Response(JSON.stringify(d),{status:s,headers:H(req)})}
function key(){const k=Deno.env.get("STEEL_API_KEY");if(!k)throw Error("STEEL_API_KEY unavailable");return k}
async function steel(path:string,init:RequestInit={}){
  const r=await fetch("https://api.steel.dev"+path,{signal:AbortSignal.timeout(4000),...init,headers:{"steel-api-key":key(),"content-type":"application/json",...(init.headers||{})}});
  const t=await r.text();let b:any={};try{b=t?JSON.parse(t):{}}catch{b={raw:t.slice(0,500)}}
  if(!r.ok)throw Error(b?.message||b?.error||("Steel API "+r.status));return b;
}
async function start(){
  return await steel("/v1/sessions",{method:"POST",body:JSON.stringify({timeout:600000,inactivityTimeout:120000,dimensions:{width:1440,height:1000}})});
}
async function stop(id:string){return await steel("/v1/sessions/"+encodeURIComponent(id)+"/release",{method:"POST"})}

class C{
  ws:WebSocket;n=0;p=new Map<number,any>();deadline=Infinity;events:((m:any)=>void)[]=[];
  constructor(w:WebSocket){this.ws=w;w.onmessage=e=>{try{const m=JSON.parse(String(e.data)),p=this.p.get(m.id);if(!p){for(const handler of this.events)handler(m);return;}clearTimeout(p.t);this.p.delete(m.id);m.error?p.j(Error(m.error.message)):p.r(m.result||{})}catch{}}}
  send(method:string,params:any={},sessionId?:string){const id=++this.n;return new Promise<any>((r,j)=>{const t=setTimeout(()=>{this.p.delete(id);j(Error("CDP timeout: "+method))},Math.max(1,Math.min(15000,this.deadline-Date.now())));this.p.set(id,{r,j,t});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})}
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
    if(a==="scroll"){const y=Math.max(200,Math.min(5000,Number(b.y||1200)));const times=Math.max(1,Math.min(8,Number(b.times||1)));for(let i=0;i<times;i++){await ev(c,s,`window.scrollBy({top:${y},behavior:'instant'}); document.documentElement.scrollTop = Math.max(document.documentElement.scrollTop, window.scrollY);`);await new Promise(r=>setTimeout(r,Math.max(150,Math.min(2000,Number(b.delayMs||500)))))}return{ok:true,action:a,y,times,scrollY:await ev(c,s,"window.scrollY")}}
    if(a==="snapshot"){const v=await ev(c,s,`JSON.stringify({url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,30000),links:[...document.querySelectorAll('a[href]')].slice(0,800).map(a=>({text:(a.innerText||a.textContent||'').trim().slice(0,240),href:a.href,context:(a.closest('div,li,article')?.innerText||a.parentElement?.innerText||'').trim().slice(0,1200)})).filter(x=>/^https?:/i.test(x.href)),images:[...document.querySelectorAll('img')].slice(0,500).map(img=>({src:img.currentSrc||img.src||'',alt:(img.alt||'').trim().slice(0,240),href:img.closest('a[href]')?.href||'',dataSrc:img.getAttribute('data-src')||img.getAttribute('data-original')||img.getAttribute('data-imgurl')||'',width:img.width||0,height:img.height||0,naturalWidth:img.naturalWidth||0,naturalHeight:img.naturalHeight||0,context:(img.closest('figure,article,section,li,div')?.innerText||'').trim().slice(0,900)})).filter(x=>/^https?:/i.test(x.src)||/^https?:/i.test(x.dataSrc))})`);return{ok:true,action:a,snapshot:JSON.parse(v||"{}")}}
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

async function discover(b:any){
  const target=new URL(String(b.url||""));
  const hosts=["realtor.com","rent.com","apartmentlist.com","apartments.com","hotpads.com","trulia.com","zillow.com"];
  if(target.protocol!=="https:"||!hosts.some(h=>target.hostname===h||target.hostname.endsWith("."+h)))throw Error("Unsupported discovery host");
  const started=Date.now(),deadline=started+18000;
  const session=await start(),id=String(session.id||"");if(!id)throw Error("No browser session");
  try{return await withPage(id,async(c,s)=>{
    c.deadline=deadline;
    const responses:any[]=[];
    c.events.push(m=>{const r=m.params?.response;if(m.method==="Network.responseReceived"&&r?.mimeType?.includes("json")&&responses.length<12){try{if(new URL(r.url).origin===target.origin)responses.push({requestId:m.params.requestId,url:r.url})}catch{}}});
    await c.send("Network.enable",{},s);
    await c.send("Page.enable",{},s);
    await c.send("Page.navigate",{url:target.href},s);
    await new Promise(r=>setTimeout(r,1400));
    const links=new Map<string,any>(),visited=new Set<string>(),jsonData:any[]=[];
    let pages=1,steps=0,stale=0,reason="step-limit",last:any={};
    for(;steps<16&&Date.now()<deadline;steps++){
      try {last=await ev(c,s,`(()=>{
        const links=[...document.querySelectorAll('a[href]')].map(a=>({text:(a.innerText||a.textContent||'').trim().slice(0,240),href:a.href,context:(()=>{let e=a,best=a.innerText||'';for(let i=0;e&&i<7;i++,e=e.parentElement){const t=e.innerText||'';if(t.length>2200)break;if(t.length>best.length)best=t;if(/\\$[\\d,]+/.test(t)&&/(?:bed|bd|br)\\b/i.test(t))return t;}return best;})().trim().slice(0,2200)}));
        const next=[...document.querySelectorAll('a[rel="next"],a[aria-label*="Next"],button[aria-label*="Next"],a,button')].find(a=>!a.disabled&&a.getAttribute('aria-disabled')!=='true'&&(a.rel==='next'||/^(next(?: page)?|load more|show more)(?:\\s*[›»→])?$/i.test((a.innerText||a.getAttribute('aria-label')||'').trim())));
        return {url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,30000),links:links.slice(0,1600),jsonData:[...document.querySelectorAll('script[type="application/ld+json"],script#__NEXT_DATA__')].map(e=>e.textContent).filter(t=>t&&t.length<500000).slice(0,8),next:next?.href||null,hasNext:!!next};
      })()`);}catch{reason="deadline";break}
      if((last.links?.length||0)<10&&String(last.text||"").length<400&&Date.now()-started<9000){await new Promise(r=>setTimeout(r,600));continue}
      last.next=last.next||nextPageUrl(last.url,last.links);last.hasNext=last.hasNext||!!last.next;
      if(/captcha|verify you are human|access denied|unusual traffic/i.test(last.text||"")){reason="challenge";break}
      for(const raw of last.jsonData||[])if(jsonData.length<32){try{jsonData.push(JSON.parse(raw))}catch{}}
      const before=links.size;
      for(const link of last.links||[]){
        try{const u=new URL(link.href);u.hash="";for(const k of [...u.searchParams.keys()])if(/^(utm_|tracking)/i.test(k))u.searchParams.delete(k);
          const key=u.href;if(!links.has(key)&&links.size<1600)links.set(key,{...link,href:key});
        }catch{}
      }
      stale=links.size===before?stale+1:0;
      visited.add(last.url);
      if(links.size>=1600){reason="candidate-limit";break}
      if(stale>=2){
        if(!last.hasNext){reason="exhausted";break}
        if(pages>=4){reason="page-limit";break}
        if(last.next){const next=new URL(last.next,last.url);if(next.origin!==target.origin||visited.has(next.href)){reason="repeated-page";break}}
        const moved=last.next ? await c.send("Page.navigate",{url:last.next},s).then(()=>true).catch(()=>false) : await ev(c,s,`(()=>{
          const a=[...document.querySelectorAll('a[rel="next"],a[aria-label*="Next"],button[aria-label*="Next"],a,button')].find(a=>!a.disabled&&a.getAttribute('aria-disabled')!=='true'&&(a.rel==='next'||/^(next(?: page)?|load more|show more)(?:\\s*[›»→])?$/i.test((a.innerText||a.getAttribute('aria-label')||'').trim())));
          if(!a)return false;a.click();return true;
        })()`);
        if(!moved){reason="exhausted";break}pages++;stale=0;
        await new Promise(r=>setTimeout(r,1000));
      }else{
        try{await ev(c,s,`(()=>{
          window.scrollBy({top:1400,behavior:'instant'});
          for(const e of document.querySelectorAll('main,section,div'))if(e.clientHeight>200&&e.scrollHeight>e.clientHeight+200&&/(auto|scroll)/.test(getComputedStyle(e).overflowY))e.scrollTop+=1400;
        })()`);}catch{reason="deadline";break}
        await new Promise(r=>setTimeout(r,550));
      }
    }
    if(Date.now()>=deadline)reason="deadline";
    for(const response of responses.slice(-4)){if(Date.now()>deadline-700)break;try{const body=await c.send("Network.getResponseBody",{requestId:response.requestId},s);if(!body.base64Encoded&&body.body?.length<500000)jsonData.push(JSON.parse(body.body))}catch{}}
    return {ok:true,action:"discover",snapshot:{...last,links:[...links.values()],jsonData,images:[]},discovery:{pages,steps,uniqueLinks:links.size,reason,nextUrl:["deadline","page-limit","step-limit"].includes(reason)?last.next:null,elapsedMs:Date.now()-started}};
  })}finally{try{await stop(id)}catch{}}
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H(req)});
  if(req.method!=="POST")return O(req,{error:"POST required"},405);
  const o=req.headers.get("origin")||"";if(o&&!ORIGINS.has(o))return O(req,{error:"Origin not allowed"},403);
  if(req.headers.get("x-rook-client")!=="rook-web-v1")return O(req,{error:"Rook client header required"},403);
  try{
    const b=await req.json(),a=String(b.action||"");if(!ALLOWED.has(a))return O(req,{error:"Unsupported browser action"},400);
    if(a==="ping")return O(req,{ok:true,service:"rook-browser-worker",version:2,steelKeyConfigured:!!Deno.env.get("STEEL_API_KEY")});
    if(a==="start"){const s=await start();return O(req,{ok:true,action:a,sessionId:s.id,viewerUrl:s.sessionViewerUrl||s.debugUrl||null})}
    if(a==="stop"){const id=String(b.sessionId||"");if(!id)return O(req,{error:"sessionId required"},400);await stop(id);return O(req,{ok:true,action:a,sessionId:id})}
    if(a==="smoke"){const r=await smoke();return O(req,r,r.ok?200:500)}
    if(a==="discover")return O(req,await discover(b));
    return O(req,await act(a,b));
  }catch(e){return O(req,{ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
