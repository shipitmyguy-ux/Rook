// Service-only cache. Candidate snapshots never constitute availability evidence.
const inflight=new Map<string,Promise<any>>();
async function cacheRequest(path:string,init:RequestInit={}){
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!key)return null;
  try{
    const response=await fetch((Deno.env.get("SUPABASE_URL")||"https://umvmilulnqnmeqvfoxxc.supabase.co")+"/rest/v1/rook_discovery_cache"+path,{
      ...init,signal:AbortSignal.timeout(1200),headers:{apikey:key,authorization:"Bearer "+key,"content-type":"application/json",...(init.headers||{})}
    });
    if(!response.ok)return null;
    return init.method ? true : await response.json();
  }catch{return null}
}
export async function readCache(key:string){
  const rows=await cacheRequest("?cache_key=eq."+encodeURIComponent(key)+"&select=payload,expires_at,updated_at&limit=1");
  return Array.isArray(rows)?rows[0]||null:null;
}
export async function writeCache(key:string,payload:any,ttlMs:number){
  await cacheRequest("?on_conflict=cache_key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({cache_key:key,payload,updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+ttlMs).toISOString()})});
}
export function coalesce<T>(key:string,work:()=>Promise<T>):Promise<T>{
  const pending=inflight.get(key);if(pending)return pending;
  const promise=work().finally(()=>inflight.delete(key));inflight.set(key,promise);return promise;
}
