import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProperty, filterProperties, PROPERTY_STATUS } from "../src/core/property.js";
import { propertyIdentity, dedupeProperties } from "../src/core/dedupe.js";
import { nextFollowUp, markShowingRequested } from "../src/core/followup.js";
import { rankProperty } from "../src/core/ranking.js";
import { googleMapsMultiStopUrl } from "../src/core/route.js";
import { parseRookBackup } from "../src/core/export.js";
import { googleMapsEmbedUrl } from "../src/integrations/maps.js";
import { normalizeProviderResult, matchesSearchDefaults, createJsonProvider } from "../src/integrations/providers.js";

test("normalizeProperty preserves lifecycle and ranking metadata", () => {
  const property = normalizeProperty({
    id: "x",
    label: "Example",
    contactOutcome: "replied",
    nearSchool: true,
    kidFriendly: true,
    metadata: { providerId: "123" }
  });
  assert.equal(property.contactOutcome, "replied");
  assert.equal(property.nearSchool, true);
  assert.equal(property.kidFriendly, true);
  assert.equal(property.metadata.providerId, "123");
});

test("archive filtering hides archived properties", () => {
  const visible = normalizeProperty({ id: "a", label: "Visible" });
  const archived = normalizeProperty({ id: "b", label: "Archived", status: PROPERTY_STATUS.ARCHIVED });
  assert.deepEqual(filterProperties([visible, archived], "all").map(p => p.id), ["a"]);
});

test("dedupe merges the same address and preserves saved state", () => {
  const first = normalizeProperty({ id: "old", address: "702 E Myrtle St, Fort Collins, CO", saved: true, note: "Visited" });
  const newer = normalizeProperty({ id: "new", address: "702 E Myrtle St, Fort Collins, CO", price: 1800 });
  const merged = dedupeProperties([first, newer]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].saved, true);
  assert.equal(propertyIdentity(first), propertyIdentity(newer));
});

test("follow-up timing becomes due after configured interval", () => {
  const property = normalizeProperty({ id: "c", contactedAt: "2026-09-23T12:00:00.000Z" });
  const next = nextFollowUp(property, new Date("2026-09-23T18:01:00.000Z"), 6);
  assert.equal(next.kind, "follow-up-due");
  assert.equal(next.at, "2026-09-23T18:00:00.000Z");
});

test("showing request updates lifecycle state", () => {
  const property = normalizeProperty({ id: "d" });
  const changed = markShowingRequested(property);
  assert.equal(changed.status, PROPERTY_STATUS.SHOWING_REQUESTED);
  assert.equal(changed.contactOutcome, "showing-requested");
  assert.ok(changed.contactedAt);
});

test("ranking rewards matching family and price preferences", () => {
  const property = normalizeProperty({ id: "e", beds: 2, price: 1700, saved: true, nearSchool: true, kidFriendly: true });
  assert.equal(rankProperty(property, { minBeds: 2, maxPrice: 1800 }), 95);
});

test("multi-stop route uses final property as destination", () => {
  const url = googleMapsMultiStopUrl([
    { address: "100 A St, Fort Collins, CO" },
    { address: "200 B St, Fort Collins, CO" },
    { address: "300 C St, Fort Collins, CO" }
  ]);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("destination"), "300 C St, Fort Collins, CO");
  assert.equal(parsed.searchParams.get("waypoints"), "100 A St, Fort Collins, CO|200 B St, Fort Collins, CO");
});


test("backup parser accepts current Rook backup format", () => {
  const parsed = parseRookBackup(JSON.stringify({
    version: 1,
    properties: [{ id: "z", label: "Restored property" }],
    preferences: { minBeds: 3 }
  }));
  assert.equal(parsed.properties.length, 1);
  assert.equal(parsed.preferences.minBeds, 3);
});

test("backup parser rejects unsupported formats", () => {
  assert.throws(() => parseRookBackup('{"version":2,"properties":[]}'), /Unsupported Rook backup version/);
});


test("embedded map centers on saved property addresses", () => {
  const url = googleMapsEmbedUrl([{ address: "702 E Myrtle St, Fort Collins, CO" }]);
  assert.match(url, /^https:\/\/www\.google\.com\/maps\?q=/);
  assert.match(decodeURIComponent(url), /702 E Myrtle St, Fort Collins, CO/);
  assert.match(url, /output=embed$/);
});


test("provider results normalize into the shared property model", () => {
  const property = normalizeProviderResult({ address: "1 Main St", price: "1800", beds: "2", url: "https://example.com/1" }, { id: "demo", label: "Demo" });
  assert.equal(property.price, 1800);
  assert.equal(property.beds, 2);
  assert.equal(property.source, "Demo");
  assert.equal(property.metadata.providerId, "demo");
});

test("provider defaults exclude undersized and restricted housing", () => {
  assert.equal(matchesSearchDefaults({ beds: 1, listingType: "rent", metadata: {} }, { minBeds: 2 }), false);
  assert.equal(matchesSearchDefaults({ beds: 2, listingType: "rent", label: "Income restricted apartment", metadata: {} }), false);
  assert.equal(matchesSearchDefaults({ beds: 2, listingType: "rent", label: "Regular apartment", metadata: {} }), true);
});

test("generic JSON provider passes search criteria and reads listings payload", async () => {
  let requested;
  const provider = createJsonProvider({
    id: "demo",
    endpoint: "https://example.com/search",
    fetchImpl: async url => {
      requested = String(url);
      return { ok: true, json: async () => ({ listings: [{ address: "2 Main St" }] }) };
    }
  });
  const rows = await provider.search({ minBeds: 2, maxPrice: 2000 });
  assert.equal(rows.length, 1);
  assert.match(requested, /minBeds=2/);
  assert.match(requested, /maxPrice=2000/);
});
