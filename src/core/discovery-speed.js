import { directListingUrl } from './listing.js';
import { streetAddressKey, addressUnit, addressCity } from './address.js';

export function exactPropertyMatch(a = {}, b = {}) {
  const left = a.address || '', right = b.address || '';
  return Boolean(streetAddressKey(left) && streetAddressKey(left) === streetAddressKey(right)
    && addressUnit(left) === addressUnit(right)
    && (!addressCity(left) || !addressCity(right) || addressCity(left) === addressCity(right)));
}

export function completePropertyMatch(target, listing) {
  return exactPropertyMatch(target, listing) && Boolean(directListingUrl(listing?.sourceUrl))
    && Number(listing.price) > 0 && listing.beds != null && Number(listing.beds) >= 0
    && listing.lat != null && listing.lng != null
    && Number.isFinite(Number(listing.lat)) && Number.isFinite(Number(listing.lng))
    && !listing.metadata?.factsConflict && !listing.metadata?.priceFallback;
}

export function sourcePriority(url = '') {
  try { return /(?:zillow|trulia|realtor|redfin|hotpads|apartments|rent|apartmentlist|forrent)\.com$/i.test(new URL(url).hostname) ? 1 : 0; }
  catch { return 2; }
}

// Tasks are lazy: once coverage is adequate no additional provider is started.
export async function boundedDiscovery(tasks, { target = 25, concurrency = 2, maxTasks = 8,
  initial = [], identity = row => row.sourceUrl || row.address, select = rows => rows,
  now = Date.now, deadlineMs = 12000, onBatch = () => {} } = {}) {
  const started = now(), rows = new Map(initial.map(row => [identity(row), row]));
  const adapters = []; let next = 0;
  const worker = async () => {
    while (next < Math.min(tasks.length, maxTasks) && now() - started < deadlineMs
      && select([...rows.values()]).length < target) {
      const task = tasks[next++];
      let result;
      try { result = await task(); } catch (error) { result = {id:'provider', listings:[], error:String(error)}; }
      adapters.push(result);
      for (const row of result.listings || []) {
        const key = identity(row); if (key) rows.set(key, row);
      }
      await onBatch([...rows.values()], result);
    }
  };
  await Promise.all(Array.from({length:concurrency}, worker));
  return {listings:[...rows.values()], adapters, attempted:next, paused:next < tasks.length};
}

export function backoffMilliseconds(error = '') {
  const message = String(error);
  if (!/429|403|rate.limit|concurrent.session|websocket timeout|signal timed out/i.test(message)) return 0;
  const requested = Number(message.match(/retry after\s+(\d+)\s*ms/i)?.[1] || 0);
  return Math.max(60000, Math.min(10 * 60000, requested));
}
