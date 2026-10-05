import { searchProviders } from "./providers.js";

// Main owns the search pipeline; temp maps supply their own isolated store.
// Cached/quick batches render immediately while the same request refines them.
// Discovery merges results and never replaces the existing listing collection.
export async function searchMainMap(store, criteria = {}, options = {}) {
  const search = options.search || searchProviders;
  const pending = new Set();
  const prepare = rows => options.transformResults ? options.transformResults(rows) : rows;
  const publish = (rows, meta) => {
    if (!options.transformResults) {
      store.upsertMany(rows);
      const result = options.onResults?.(rows, meta);
      if (!result || typeof result.then !== "function") return result;
      pending.add(result);
      result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    }
    const task = (async () => {
      const prepared = await prepare(rows);
      store.upsertMany(prepared);
      await options.onResults?.(prepared, meta);
    })();
    pending.add(task);
    task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  const rows = await search(criteria, { onResults:publish });
  await Promise.all(pending);
  const prepared = await prepare(rows);
  store.upsertMany(prepared);
  return prepared;
}
