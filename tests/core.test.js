import { classifyHousingEmail, matchEmailToProperty } from "../src/integrations/email.js";
import { isShowingEvent, matchCalendarEventToProperty, googleCalendarShowingUrl } from "../src/integrations/calendar.js";
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProperty, filterProperties, PROPERTY_STATUS, applyEvidence, classifyPropertyKind } from "../src/core/property.js";
import { propertyIdentity, dedupeProperties } from "../src/core/dedupe.js";
import { nextFollowUp, markShowingRequested } from "../src/core/followup.js";
import { rankProperty } from "../src/core/ranking.js";
import { googleMapsMultiStopUrl } from "../src/core/route.js";
import { parseRookBackup } from "../src/core/export.js";
import { normalizePreferences } from "../src/core/preferences.js";
import { config } from "../src/config.js";
import { poiLocationQuery, normalizePoiSearchCandidate, poiSearchQueries, mapLandLayerKind } from "../src/integrations/maps.js";
import { normalizeTour, tourState, tourLabel, applyTour } from "../src/core/tours.js";
import { normalizePointStyles, resolvePoiStyle, poiGlyph, poiColorHex } from "../src/core/poi-style.js";
import { normalizeProviderResult, matchesSearchDefaults, createJsonProvider, dedupeProviderResults, isUsableListing, resolveMissingListing, resolveMissingImage, canonicalAddress, isIncomeRestrictedListing } from "../src/integrations/providers.js";

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

test("normalizeProperty persists enriched image fields", () => {
  const property = normalizeProperty({
    id:"img",
    imageUrl:"https://example.com/home.jpg",
    metadata:{ image:"https://example.com/home.jpg" }
  });
  assert.equal(property.image, "https://example.com/home.jpg");
  assert.equal(property.imageUrl, "https://example.com/home.jpg");
  assert.equal(property.primaryImageUrl, "https://example.com/home.jpg");
});

test("image resolver returns normalized backend image", async () => {
  const fetchImpl = async () => ({
    ok:true,
    async json(){ return { state:"found", imageUrl:"https://cdn.example.com/photo.jpg", sourceUrl:"https://example.com/listing", checkedAt:"2026-09-25T00:00:00Z", method:"listing-metadata" }; }
  });
  const result = await resolveMissingImage({ address:"100 Main St, Fort Collins, CO" }, { location:"Fort Collins, CO" }, fetchImpl);
  assert.equal(result.state, "found");
  assert.equal(result.imageUrl, "https://cdn.example.com/photo.jpg");
  assert.equal(result.method, "listing-metadata");
});

test("archive filtering hides archived properties", () => {
  const visible = normalizeProperty({ id: "a", label: "Visible" });
  const archived = normalizeProperty({ id: "b", label: "Archived", status: PROPERTY_STATUS.ARCHIVED });
  assert.deepEqual(filterProperties([visible, archived], "all").map(p => p.id), ["a"]);
});

test("702 E Myrtle seed does not hard-code a comparable price", async () => {
  const seed = (await import("../src/data/properties.js")).properties.find(p => p.id === "702-myrtle");
  assert.equal(seed.price, null);
});

test("missing listing resolver carries generic comparable price evidence", async () => {
  const fetchImpl = async url => {
    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get("beds"), "2");
    assert.equal(parsed.searchParams.get("baths"), "1");
    return {
      ok:true,
      async json(){
        return {
          state:"unknown",
          listing:null,
          checkedAt:"2026-09-25T00:00:00Z",
          priceFallback:{
            price:1395,
            priceLabel:"$1,395/mo (building 2BR)",
            checkedAt:"2026-09-25T00:00:00Z",
            targetBeds:2,
            method:"same-street-building-comparable",
            evidence:[{source:"example",sourceUrl:"https://example.com/listing",price:1395,beds:2}]
          }
        };
      }
    };
  };
  const result = await resolveMissingListing(
    { address:"702 E Myrtle St, Fort Collins, CO 80524", label:"702 E Myrtle St", beds:2, baths:1 },
    { location:"Fort Collins, CO" },
    fetchImpl
  );
  assert.equal(result.state, "unknown");
  assert.equal(result.priceFallback.price, 1395);
  assert.match(result.priceFallback.priceLabel, /building 2BR/);
});

test("dedupe preserves a known image when a later listing has none", () => {
  const image = "https://images.example.com/property.jpg";
  const first = normalizeProperty({ id:"image-a", address:"123 Main St, Fort Collins, CO", imageUrl:image, metadata:{ image } });
  const later = normalizeProperty({ id:"image-b", address:"123 Main St, Fort Collins, CO", price:1800, image:null, imageUrl:null, primaryImageUrl:null, metadata:{} });
  const merged = dedupeProperties([first, later]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].imageUrl, image);
  assert.equal(merged[0].primaryImageUrl, image);
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
  assert.equal(rankProperty(property, { minBeds: 2, maxPrice: 1800 }), 98);
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


test("legacy primary POI migrates into the unified POI list", () => {
  const prefs = normalizePreferences({
    address1:{ label:"Ridge Runner", query:"Ridge Runner", lat:40.58, lng:-105.05 },
    pointsOfInterest:[]
  });
  assert.equal(prefs.address1, null);
  assert.equal(prefs.pointsOfInterest.length, 1);
  assert.equal(prefs.pointsOfInterest[0].id, "address-1");
  assert.equal(prefs.pointsOfInterest[0].primary, false);
});

test("loose POI names are scoped to the current search location", () => {
  assert.equal(poiLocationQuery({ query:"Ridge Runner" }, "Fort Collins, CO"), "Ridge Runner, Fort Collins, CO");
  assert.equal(poiLocationQuery({ address:"5480 Ziegler Rd, Fort Collins, CO 80528" }, "Fort Collins, CO"), "5480 Ziegler Rd, Fort Collins, CO 80528");
  assert.equal(poiLocationQuery({ query:"Twin Silo Park" }, "Fort Collins, CO"), "Twin Silo Park, Fort Collins, CO");
});

test("partial road names generate location-scoped suggestions", () => {
  const queries = poiSearchQueries("Ridge Runner", "Fort Collins, CO");
  assert.equal(queries[0], "Ridge Runner, Fort Collins, CO");
  assert.ok(queries.includes("Ridge Runner Drive, Fort Collins, CO"));
  assert.ok(queries.includes("Ridge Runner Road, Fort Collins, CO"));
  assert.equal(poiSearchQueries("Ridge Runner Dr", "Fort Collins, CO").length, 1);
});

test("POI lookup candidates preserve resolved map data for approval", () => {
  const candidate = normalizePoiSearchCandidate({
    lat:"40.585",
    lon:"-105.055",
    display_name:"Ridge Runner Drive, Fort Collins, Larimer County, Colorado, United States",
    namedetails:{ name:"Ridge Runner Drive" },
    type:"residential"
  }, "Ridge Runner");
  assert.deepEqual(candidate, {
    label:"Ridge Runner Drive",
    address:"Ridge Runner Drive, Fort Collins, Larimer County, Colorado, United States",
    query:"Ridge Runner",
    lat:40.585,
    lng:-105.055,
    placeType:"residential",
    source:"OpenStreetMap"
  });
});

test("tour defaults use one hour and two hour reminders", () => {
  const tour = normalizeTour({ startsAt:"2026-09-29T20:30:00Z" }, {});
  assert.equal(tour.durationMinutes, 60);
  assert.equal(tour.reminderMinutes, 120);
  assert.equal(new Date(tour.endsAt) - new Date(tour.startsAt), 60 * 60 * 1000);
});

test("tour lifecycle exposes upcoming soon and past states", () => {
  const tour = normalizeTour({ startsAt:"2026-09-29T20:30:00Z" }, {});
  assert.equal(tourState(tour, new Date("2026-09-28T18:00:00Z")), "upcoming");
  assert.equal(tourState(tour, new Date("2026-09-29T18:00:00Z")), "soon");
  assert.equal(tourState(tour, new Date("2026-09-29T22:00:00Z")), "past");
  assert.match(tourLabel(tour, new Date("2026-09-28T18:00:00Z")), /Sep|Tue|Mon|Tomorrow|Today/);
  const property = applyTour({ id:"p", metadata:{} }, tour, {});
  assert.equal(property.status, "showing-scheduled");
  assert.equal(property.metadata.tour.reminderMinutes, 120);
});

test("address marker styles normalize to predefined icons and colors", () => {
  const styles = normalizePointStyles({
    "address-2": { icon:"diamond", color:"blue" },
    "address-3": { icon:"not-real", color:"not-real" }
  });
  assert.deepEqual(styles["address-2"], { icon:"diamond", color:"blue" });
  assert.equal(styles["address-3"].color, "slate");
  assert.ok(poiGlyph(styles["address-2"].icon));
  assert.match(poiColorHex(styles["address-2"].color), /^#/);
  assert.deepEqual(resolvePoiStyle({ id:"address-2" }, 0, styles), { icon:"diamond", color:"blue" });
});

test("Buffalo Run is excluded when income-restricted housing is disabled", () => {
  const buffalo = normalizeProperty({
    id:"buffalo-run",
    label:"Buffalo Run Apartments",
    address:"1245 E Lincoln Ave, Fort Collins, CO 80524",
    type:"Apartment",
    listingType:"rent",
    price:1849,
    beds:2,
    metadata:{ badges:["Popular Rental"] }
  });
  assert.equal(isIncomeRestrictedListing(buffalo), true);
  assert.equal(matchesSearchDefaults(buffalo, { minBeds:2, propertyTypes:["apartment"], excludeIncomeRestricted:true }), false);
  assert.equal(matchesSearchDefaults(buffalo, { minBeds:2, propertyTypes:["apartment"], excludeIncomeRestricted:false }), true);
});

test("income restriction detection scans provider metadata", () => {
  const listing = normalizeProperty({
    id:"restricted",
    label:"Example Apartments",
    address:"100 Main St, Fort Collins, CO",
    type:"Apartment",
    metadata:{ amenities:["Fitness Center", "Income Restricted"] }
  });
  assert.equal(isIncomeRestrictedListing(listing), true);
});

test("map theme distinguishes parks from generic vegetation", () => {
  assert.equal(mapLandLayerKind("landuse_park"), "park");
  assert.equal(mapLandLayerKind("park-boundary"), "park");
  assert.equal(mapLandLayerKind("landcover_wood"), "vegetation");
  assert.equal(mapLandLayerKind("grass"), "vegetation");
  assert.equal(mapLandLayerKind("water"), "water");
});

test("overview map uses MapLibre with OpenFreeMap", () => {
  assert.equal(config.maps.provider, "maplibre");
  assert.equal(config.maps.tiles, "openfreemap");
  assert.match(config.maps.styleUrl, /^https:\/\/tiles\.openfreemap\.org\/styles\//);
});



test("listing address normalization treats unit designators as the same address", () => {
  const canonical = canonicalAddress("3051 Sage Creek Road Unit G38, Fort Collins, CO 80528");
  assert.equal(canonical, canonicalAddress("3051 Sage Creek Rd #G38, Fort Collins, CO 80528"));
  assert.equal(canonical, canonicalAddress("3051 Sage Creek Rd Apt G-38, Fort Collins, CO 80528"));
});

test("missing listing resolver distinguishes recovered closed and unknown states", async () => {
  const recovered = await resolveMissingListing(
    { address:"123 Main St, Fort Collins, CO", label:"123 Main St" },
    { location:"Fort Collins, CO" },
    async () => ({ ok:true, json:async()=>({ state:"active", checkedAt:"2026-09-24T17:00:00Z", listing:{ address:"123 Main Street, Fort Collins, CO", sourceUrl:"https://example.test/listing" } }) })
  );
  assert.equal(recovered.state, "active");
  assert.equal(recovered.url, "https://example.test/listing");

  const unconfirmedClosed = await resolveMissingListing(
    { address:"123 Main St, Fort Collins, CO" },
    { location:"Fort Collins, CO" },
    async () => ({ ok:true, json:async()=>({ state:"closed", checkedAt:"2026-09-24T17:00:00Z", listing:null }) })
  );
  assert.equal(unconfirmedClosed.state, "unknown");

  const confirmedClosed = await resolveMissingListing(
    { address:"123 Main St, Fort Collins, CO" },
    { location:"Fort Collins, CO" },
    async () => ({ ok:true, json:async()=>({ state:"closed", checkedAt:"2026-09-24T17:00:00Z", listing:null, evidence:{ confirmed:true, kind:"direct-listing-status" } }) })
  );
  assert.equal(confirmedClosed.state, "closed");
  assert.equal(confirmedClosed.evidence.confirmed, true);
});

test("live source URL overrides a stale closed state during dedupe", () => {
  const live = normalizeProperty({ id:"live", address:"123 Main St, Fort Collins, CO", sourceUrl:"https://example.test/live", listingState:"active" });
  const stale = normalizeProperty({ id:"stale", address:"123 Main Street, Fort Collins, CO", listingState:"closed", metadata:{ listingClosedEvidence:{ confirmed:true } } });
  const [merged] = dedupeProperties([live, stale]);
  assert.equal(merged.sourceUrl, "https://example.test/live");
  assert.equal(merged.listingState, "active");
});

test("resolver enrichment preserves recovered price and source URL", async () => {
  const enriched = await resolveMissingListing(
    { address:"303 W Prospect Rd, Fort Collins, CO 80526", label:"Prospect Station", price:null },
    { location:"Fort Collins, CO" },
    async () => ({ ok:true, json:async()=>({
      state:"active",
      checkedAt:"2026-09-24T17:00:00Z",
      listing:{
        address:"303 W Prospect Rd, Fort Collins, CO 80526",
        label:"Prospect Station",
        price:1595,
        beds:2,
        baths:2,
        sourceUrl:"https://www.prospectstation.com/floorplans/303-w-prospect-rd-2-bed%2C-2-bath"
      }
    }) })
  );
  assert.equal(enriched.state, "active");
  assert.equal(enriched.listing.price, 1595);
  assert.equal(enriched.listing.beds, 2);
  assert.equal(enriched.listing.baths, 2);
  assert.match(enriched.url, /prospectstation\.com/);
});

test("provider results normalize into the shared property model", () => {
  const property = normalizeProviderResult({ address: "1 Main St", price: "1800", beds: "2", url: "https://example.com/1" }, { id: "demo", label: "Demo" });
  assert.equal(property.price, 1800);
  assert.equal(property.beds, 2);
  assert.equal(property.source, "Demo");
  assert.equal(property.metadata.providerId, "demo");
});

test("provider defaults exclude undersized and restricted housing", () => {
  assert.equal(matchesSearchDefaults({ address:"1 A St", beds: 1, listingType: "rent", metadata: {} }, { minBeds: 2 }), false);
  assert.equal(matchesSearchDefaults({ address:"2 A St", beds: 2, listingType: "rent", label: "Income restricted apartment", metadata: {} }), false);
  assert.equal(matchesSearchDefaults({ address:"3 A St", beds: 2, listingType: "rent", label: "Regular apartment", metadata: {} }), true);
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


test("provider dedupe merges the same address across sources", () => {
  const rows = [
    normalizeProviderResult({ address: "123 Main Street, Fort Collins, CO", price: 1800, sourceUrl: "https://a.test/1" }, { id: "a", label: "Source A" }),
    normalizeProviderResult({ address: "123 Main St., Fort Collins, CO", beds: 2, sourceUrl: "https://b.test/2" }, { id: "b", label: "Source B" })
  ];
  const merged = dedupeProviderResults(rows);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].price, 1800);
  assert.equal(merged[0].beds, 2);
  assert.deepEqual(merged[0].metadata.sources.sort(), ["Source A", "Source B"]);
});


test("ranking rewards more monthly rent cushion under the same cap", () => {
  const preferences = { minBeds: 2, maxPrice: 2000 };
  const cheaper = rankProperty({ beds: 2, price: 1500, listingType: "rent" }, preferences);
  const pricier = rankProperty({ beds: 2, price: 1900, listingType: "rent" }, preferences);
  assert.ok(cheaper > pricier);
});


test("housing email evidence recognizes showing confirmations and matches address", () => {
  const email = { subject: "Showing confirmed", body: "Your tour at 702 E Myrtle St, Fort Collins is scheduled." };
  assert.equal(classifyHousingEmail(email), "showing-scheduled");
  assert.equal(matchEmailToProperty(email, [{ id: "myrtle", address: "702 E Myrtle St, Fort Collins, CO" }]).id, "myrtle");
});

test("calendar showing detection and property matching use shared property identity text", () => {
  const event = { title: "Apartment tour", location: "702 E Myrtle St, Fort Collins, CO" };
  assert.equal(isShowingEvent(event), true);
  assert.equal(matchCalendarEventToProperty(event, [{ id: "myrtle", address: "702 E Myrtle St, Fort Collins, CO" }]).id, "myrtle");
});


test("email/calendar evidence advances lifecycle without erasing property state", () => {
  const property = normalizeProperty({ id: "evidence", address: "5225 White Willow Dr", saved: true, note: "Interested" });
  const scheduled = applyEvidence(property, { kind: "showing-scheduled", occurredAt: "2026-09-23T22:23:33Z" });
  assert.equal(scheduled.status, PROPERTY_STATUS.SHOWING_SCHEDULED);
  assert.equal(scheduled.saved, true);
  assert.equal(scheduled.note, "Interested");
  assert.equal(scheduled.metadata.evidence.length, 1);
});


test("live refresh cannot erase manual lifecycle state or notes", () => {
  const manual = normalizeProperty({ id:"manual", address:"123 Main St, Fort Collins, CO", saved:true, status:PROPERTY_STATUS.VISITED, note:"Great area", price:1800 });
  const refreshed = normalizeProperty({ id:"live", address:"123 Main Street, Fort Collins, CO", source:"Live", sourceUrl:"https://example.test/123", price:1750 });
  const [merged] = dedupeProperties([refreshed, manual]);
  assert.equal(merged.status, PROPERTY_STATUS.VISITED);
  assert.equal(merged.saved, true);
  assert.equal(merged.note, "Great area");
  assert.equal(merged.price, 1750);
});


test("listing quality gate rejects malformed prices and unsafe source URLs", () => {
  assert.equal(isUsableListing({ address:"1 Main St", price:-1 }), false);
  assert.equal(isUsableListing({ address:"1 Main St", price:1800, sourceUrl:"javascript:alert(1)" }), false);
  assert.equal(isUsableListing({ address:"1 Main St", price:1800, sourceUrl:"https://example.test/home" }), true);
});


test("Google Calendar showing handoff contains property and time", () => {
  const url = new URL(googleCalendarShowingUrl({ label:"Test Home", address:"123 Main St, Fort Collins, CO" }, "2026-09-29T20:30:00.000Z"));
  assert.equal(url.hostname, "calendar.google.com");
  assert.match(url.searchParams.get("text"), /Test Home/);
  assert.match(url.searchParams.get("location"), /123 Main St/);
});


test("active feeds hide rejected properties", () => {
  const rows = [normalizeProperty({ id:"keep", status:PROPERTY_STATUS.NEW }), normalizeProperty({ id:"drop", status:PROPERTY_STATUS.REJECTED })];
  assert.deepEqual(filterProperties(rows, "all").map(p => p.id), ["keep"]);
});


test("search preferences normalize location radius types and exclusions", () => {
  const prefs = normalizePreferences({ location:"  Fort Collins, CO  ", radiusMiles:20, minBeds:2, maxPrice:1800, propertyTypes:["townhome","house"], excludeIncomeRestricted:true, excludeMobileHomes:true });
  assert.equal(prefs.location, "Fort Collins, CO");
  assert.equal(prefs.radiusMiles, 20);
  assert.deepEqual(prefs.propertyTypes, ["townhome","house"]);
  assert.equal(prefs.maxPrice, 1800);
});

test("provider type filter honors selected rental property types", () => {
  assert.equal(matchesSearchDefaults({ address:"1 Main St", beds:2, type:"Townhouse", label:"Home", listingType:"rent" }, { minBeds:2, propertyTypes:["townhome"] }), true);
  assert.equal(matchesSearchDefaults({ address:"2 Main St", beds:2, type:"Apartment", label:"Apartment", listingType:"rent" }, { minBeds:2, propertyTypes:["house"] }), false);
});


test("shared property kind classifier distinguishes apartments townhomes and houses", () => {
  assert.equal(classifyPropertyKind({ type:"Apartment" }), "apartment");
  assert.equal(classifyPropertyKind({ label:"Oak Street Townhouse" }), "townhome");
  assert.equal(classifyPropertyKind({ metadata:{ description:"Detached single-family home" } }), "house");
  assert.equal(classifyPropertyKind({ label:"Unknown rental" }), "rental");
});

test("property kind classifier does not misclassify generic home wording as a house", () => {
  assert.equal(classifyPropertyKind({ label:"Welcome Home Apartments" }), "apartment");
});
