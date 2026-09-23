// Provider adapters normalize every source into the same Rook property shape.
// Network-specific scraping/API logic belongs in adapters, never in the UI.
export const providers = new Map();

export function registerProvider(provider) {
  if (!provider?.id || typeof provider.search !== "function") throw new Error("Invalid property provider");
  providers.set(provider.id, provider);
}

export async function searchProviders(criteria) {
  const settled = await Promise.allSettled(
    [...providers.values()].map(provider => provider.search(criteria))
  );
  return settled.flatMap(result => result.status === "fulfilled" ? result.value : []);
}
