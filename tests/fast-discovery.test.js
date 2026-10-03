import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("listing discovery emits cached quick candidates before authoritative refinement", async () => {
  const source = await fs.readFile(new URL("../supabase/functions/rook-listings/index.ts", import.meta.url), "utf8");
  assert.match(source, /recentCachedDiscovery/);
  assert.match(source, /source:"recent-provider-cache"/);
  assert.match(source, /quickCandidate:true/);
  assert.match(source, /selectQuickListings/);
  assert.match(source, /backgroundRefinement:true/);
  assert.match(source, /stage:"quick"/);
});

test("quick results are visibly marked provisional in property cards", async () => {
  const source = await fs.readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /quick-result-badge/);
  assert.match(source, /Quick result · refining/);
});
