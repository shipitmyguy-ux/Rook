import { searchProviders } from "./providers.js";

// Main owns the search pipeline; temp maps supply their own isolated store.
// Cached/quick batches render immediately while the same request refines them.
// Discovery merges results and never replaces the existing listing collection.
export async function searchMainMap(store, criteria = {}, options = {}) {
  const search = options.search || searchProviders;
  const pending = [];
  const publish = (rows, meta) => {
    if (!options.transformResults) {
      store.upsertMany(rows);
      const result = options.onResults?.(rows, meta);
      if (!result || typeof result.then !== "function") return result;
      pending.push(result);
      return result;
    }
    const task = (async () => {
      const filtered = await options.transformResults(rows);
      store.upsertMany(filtered);
      await options.onResults?.(filtered, meta);
    })();
    pending.push(task);
    return task;
  };
  // Existing Main inventory participates in the same qualification path as
  // streamed discovery; a smaller fresh batch must not discard those matches.
  if (options.initialResults?.length) publish(options.initialResults, { stage:"main-inventory" });
  const rows = await search(criteria, { onResults:publish });
  await Promise.all(pending);
  const filtered = options.transformResults ? await options.transformResults(rows) : rows;
  store.upsertMany(filtered);
  return filtered;
}
