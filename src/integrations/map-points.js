// Shared by every map. No workspace-specific branch or serial browser geocoder.
export function createMapPointResolver({ endpoint, fetchImpl = (...args) => fetch(...args), concurrency = 4, now = Date.now } = {}) {
  const pending = new Map(), cache = new Map(), waiters = [];
  let active = 0;
  const acquire = async () => {
    if (active >= concurrency) await new Promise(resolve => waiters.push(resolve));
    else active++;
  };
  const release = () => { const next = waiters.shift(); if (next) next(); else active--; };
  return function resolveMapPoint(property = {}) {
    const address = String(property.address || "").trim();
    if (!endpoint || !address) return Promise.resolve(null);
    const key = address.toLowerCase();
    const prior = cache.get(key);
    if (prior && prior.expires > now()) return Promise.resolve(prior.point);
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      await acquire();
      try {
        const url = new URL(endpoint);
        url.searchParams.set("mapPoint", "1");
        url.searchParams.set("address", address);
        if (property.label) url.searchParams.set("label", property.label);
        if (property.sourceUrl) url.searchParams.set("sourceUrl", property.sourceUrl);
        const response = await fetchImpl(url, { headers:{Accept:"application/json"}, signal:AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`Map resolver returned ${response.status}`);
        const { point } = await response.json();
        const numeric = value => value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value));
        const valid = numeric(point?.lat) && numeric(point?.lng) && Math.abs(Number(point.lat)) <= 90 && Math.abs(Number(point.lng)) <= 180;
        const result = valid ? {lat:Number(point.lat),lng:Number(point.lng)} : null;
        cache.set(key, {point:result,expires:now() + (result ? 30*86400000 : 60000)});
        return result;
      } catch {
        cache.set(key, {point:null,expires:now()+60000});
        return null;
      } finally { release(); }
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}
