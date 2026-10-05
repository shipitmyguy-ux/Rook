// Prompt actions reuse the existing listing resolver and workspace store.
export async function runWorkspaceCommand(text, { store, session, resolve, qualify, search }) {
  const raw = String(text || "").trim();
  if (!raw) return "Enter a map command.";
  const action = raw.match(/^(add|hide|remove|restore|show again)\s+(.+)$/i);
  if (action && !/^(apartments?|townhomes?|houses?)$/i.test(action[2])) {
    const verb = action[1].toLowerCase();
    const target = action[2].replace(/\s+(?:from|to)\s+(?:this |the )?map$/i, "").trim();
    const matches = store.getAll().filter(p => [p.id, p.address, p.label, p.sourceUrl].some(value => String(value || "").toLowerCase().includes(target.toLowerCase())));
    if (verb !== "add") {
      if (matches.length !== 1) return matches.length ? "Several listings match. Use a full address or listing URL." : "No matching listing. Use its address or listing URL.";
      if (verb === "restore" || verb === "show again") session.restore(matches[0].id);
      else session.exclude(matches[0].id);
      return `${verb === "restore" || verb === "show again" ? "Restored" : "Hidden"}: ${matches[0].address || matches[0].label}.`;
    }
    if (matches.length === 1) {
      session.restore(matches[0].id);
      return "Listing restored. It appears when it meets this map's boundary and filters.";
    }
    const isUrl = /^https?:\/\//i.test(target);
    if (!isUrl && !/^\d+\s+\S+/.test(target)) return "To add a rental, use Add followed by its full address or listing URL.";
    const base = { id:"prompt-" + target.toLowerCase().replace(/[^a-z0-9]+/g,"-"), label:isUrl ? "Imported rental" : target, address:isUrl ? "" : target, sourceUrl:isUrl ? target : null, listingType:"rent", status:"new" };
    const result = await resolve(base);
    if (result?.state !== "active" || !result.listing) return "Could not verify an active rental for that address or URL. Nothing was added.";
    const listing = { ...base, ...Object.fromEntries(Object.entries(result.listing).filter(([,v])=>v != null && v !== "")), id:base.id };
    const accepted = await qualify([listing]);
    if (!accepted.length) return "That rental is outside this map's boundary, or its location could not be verified. Nothing was added.";
    store.upsert(accepted[0]);
    session.restore(accepted[0].id);
    return "Rental added. It appears when its price and bedrooms meet your filters.";
  }
  if (!/under|below|max|\d\s*\+?\s*bed|apartments|townhomes|houses|playground|^(undo|undo that|clear|reset|start over|clear scratch)$/.test(raw.toLowerCase())) return "Try: under $2800, 2+ bedrooms; hide [address]; restore [address]; add [listing URL]; or undo.";
  session.command(raw);
  await search?.();
  return "Map filters updated.";
}
