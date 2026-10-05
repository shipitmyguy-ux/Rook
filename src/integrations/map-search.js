import { searchProviders } from "./providers.js";

// Main owns the search pipeline; temp maps supply their own isolated store.
// Cached/quick batches render immediately while the same request refines them.
// Discovery merges results and never replaces the existing listing collection.
export async function searchMainMap(store, criteria = {}, options = {}) {
  const search = options.search || searchProviders;
  const publish = (rows, meta) => {
    store.upsertMany(rows);
    options.onResults?.(rows, meta);
  };
  const rows = await search(criteria, { onResults:publish });
  store.upsertMany(rows);
  return rows;
}
