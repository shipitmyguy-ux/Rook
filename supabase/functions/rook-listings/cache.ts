// Service-only cache. Candidate snapshots never constitute availability evidence.
const inflight=new Map<string,Promise<any>>();
const memory=new Map<string,{row:any;until:number}>();
async function cacheRequest(path:string,init:RequestInit={}){
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!key)return null;
  try{
    const response=await fetch((Deno.env.get("SUPABASE_URL")||"https://umvmilulnqnmeqvfoxxc.supabase.co")+"/rest/v1/rook_discovery_cache"+path,{
      ...init,signal:AbortSignal.timeout(1200),headers:{apikey:key,authorization:"Bearer "+key,"content-type":"application/json",...(init.headers||{})}
    });
    if(!response.ok)return null;
    return response.status === 204 ? true : await response.json().catch(()=>true);
  }catch{return null}
}
export async function readCache(key:string,fresh=false){
  const local=memory.get(key);if(!fresh&&local&&local.until>Date.now())return local.row;
  const rows=await cacheRequest("?cache_key=eq."+encodeURIComponent(key)+"&select=payload,expires_at,updated_at&limit=1");
  const row=Array.isArray(rows)?rows[0]||null:null;
  if(row){if(memory.size>=300)memory.delete(memory.keys().next().value!);memory.set(key,{row,until:Date.now()+15000})}
  return row;
}
export async function writeCache(key:string,payload:any,ttlMs:number){
  const row={cache_key:key,payload,updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+ttlMs).toISOString()};
  const result=await cacheRequest("?on_conflict=cache_key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)});
  if(result){if(memory.size>=300)memory.delete(memory.keys().next().value!);memory.set(key,{row,until:Date.now()+15000})}
  return Boolean(result);
}
// Atomic insert/CAS on the existing service-only table coordinates edge instances.
// Fail closed: cache outages must not trigger another expensive provider crawl.
export async function claimLease(key:string,ttlMs=90000){
  const token=crypto.randomUUID(),now=new Date().toISOString();
  const row={cache_key:key,payload:{token},updated_at:now,expires_at:new Date(Date.now()+ttlMs).toISOString()};
  const inserted=await cacheRequest("?on_conflict=cache_key",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify(row)});
  if(Array.isArray(inserted)&&inserted.length)return token;
  const replaced=await cacheRequest("?cache_key=eq."+encodeURIComponent(key)+"&expires_at=lte."+encodeURIComponent(now),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(row)});
  return Array.isArray(replaced)&&replaced.length?token:null;
}
export async function releaseLease(key:string,token:string){
  await cacheRequest("?cache_key=eq."+encodeURIComponent(key)+"&payload->>token=eq."+encodeURIComponent(token),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({expires_at:new Date().toISOString()})});
}
export function coalesce<T>(key:string,work:()=>Promise<T>):Promise<T>{
  const pending=inflight.get(key);if(pending)return pending;
  const promise=work().finally(()=>inflight.delete(key));inflight.set(key,promise);return promise;
}
