import { properties as seedProperties } from "./data/properties.js";
import { createPropertyStore } from "./core/store.js";
import { filterProperties, searchProperties, PROPERTY_STATUS, applyEvidence, classifyPropertyKind, ignorePropertyPatch, restoreIgnoredPatch } from "./core/property.js";
import { housingEvidence } from "./data/evidence.js";
import { propertyFromUrl } from "./core/import.js";
import { googleMapsMultiStopUrl } from "./core/route.js";
import { loadPreferences, savePreferences } from "./core/preferences.js";
import { rankProperties, rankProperty } from "./core/ranking.js";
import { recordActivity, getActivity } from "./core/activity.js";
import { nextFollowUp, markShowingRequested } from "./core/followup.js";
import { exportRookData, parseRookBackup } from "./core/export.js";
import { searchProviders, registerConfiguredProviders, firstImageUrl, resolveMissingListing } from "./integrations/providers.js";
import { openDirections, renderPropertyMap, updateCardDistances, getCachedPropertyDistances, focusPropertyOnMap } from "./integrations/maps.js?v=distance-strip-v1";
import { googleCalendarShowingUrl } from "./integrations/calendar.js";
import { config } from "./config.js";

const app = document.querySelector("#app");
const store = createPropertyStore(seedProperties);
let activeFilter = "all";
let query = "";
let preferences = loadPreferences();
document.documentElement.dataset.theme = preferences.visualTheme || "default";
let refreshInFlight = false;
let selectedMapPropertyId = null;
let selectedMapCard = null;
let selectedMapCardPlaceholder = null;
let pullStartY = null;
let pullDistance = 0;
let renderQueued = false;
let distanceObserver = null;
const BROWSER_QA_MODE = typeof location !== "undefined" && new URLSearchParams(location.search).has("browser-qa");
const LISTING_RESOLVER_VERSION = 2;
// Distance values are derived once per property/address pair and persisted; rerenders only read the cache. The compact strip scales to every configured address and never resets during ordinary card rerenders; one document-level event handles cards in either list or map-detail placement.
registerConfiguredProviders();

function applySyncedEvidence() {
  for (const evidence of housingEvidence) {
    const hint = String(evidence.propertyHint || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const property = store.getAll().find(item => {
      const address = String(item.address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const label = String(item.label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return hint && ((address.length > 6 && (address.includes(hint) || hint.includes(address))) || (label.length > 6 && (label.includes(hint) || hint.includes(label))));
    });
    if (property && !(property.metadata?.evidence || []).some(item => JSON.stringify(item) === JSON.stringify(evidence))) store.upsert(applyEvidence(property, evidence));
  }
}
applySyncedEvidence();

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}

function followUpBadge(property) {
  const next = nextFollowUp(property, new Date(), config.followUp.defaultHours);
  if (!next) return "";
  const date = new Date(next.at);
  const label = next.kind === "follow-up-due" ? "Follow-up due" : next.kind === "showing" ? "Showing" : "Waiting";
  const detail = Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
  return `<span class="status-chip ${next.kind}">${esc(label)}${detail ? " · " + esc(detail) : ""}</span>`;
}

// Generic no-photo silhouettes use solid bodies with recessed window/door lines.
function propertyKindIcon(kind) {
  return kind === "apartment" ? "▦" : kind === "townhome" ? "▥" : kind === "house" ? "⌂" : "◇";
}

function cardPointsOfInterest() {
  const primary = {
    id: "address-1",
    kind: "primary",
    primary: true,
    label: "Address 1",
    ...(preferences.address1 || {})
  };
  const configured = Array.isArray(preferences.pointsOfInterest)
    ? preferences.pointsOfInterest.filter(p => p && (p.address || p.query || p.location || (p.lat != null && p.lng != null)))
    : [];
  const fixed = [
    { id: "address-2", kind: "poi", label: "Address 2", lat: 40.57589, lng: -105.06223, address: "1000 Locust St, Fort Collins, CO 80524" },
    { id: "address-3", kind: "poi", label: "Address 3", lat: 40.5104806, lng: -105.0171262, address: "5480 Ziegler Rd, Fort Collins, CO 80528" }
  ];
  const secondary = [...fixed, ...configured.filter(p => !fixed.some(f => f.id === p.id))];
  return [...(preferences.address1 ? [primary] : []), ...secondary.filter(p => p.id !== primary.id && p.address !== primary.address)];
}

function icon(name) { const paths = {"pin":"<path d=\"M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z\"/><circle cx=\"12\" cy=\"10\" r=\"2.5\"/>","phone":"<path d=\"m5 3 4 1 1 5-3 2a16 16 0 0 0 6 6l2-3 5 1 1 4c-1 5-8 3-13-2S1 4 5 3Z\"/>","bed":"<path d=\"M3 18V5m18 13V9H3m0 6h18M6 9V6h6v3\"/>","bath":"<path d=\"M3 12h18l-2 7H5Zm3 7-1 3m13-3 1 3M6 12V5a3 3 0 0 1 6 0\"/>","calendar":"<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M7 2v6m10-6v6M3 11h18\"/>","house":"<path d=\"M2 11 12 2l10 9v11H2Z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M6 13h4v4H6zm8 0h4v4h-4zm-3 9v-5h3v5\" stroke=\"#07111b\" fill=\"none\"/>","building":"<path d=\"M5 2h14v20H5Z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M8 6h3m2 0h3M8 10h3m2 0h3M8 14h3m2 0h3M10 22v-4h4v4\" stroke=\"#07111b\" fill=\"none\"/>","townhome":"<path d=\"M2 10 7 4l5 6v12H2Zm10 0 5-6 5 6v12H12Z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M5 13h4m6 0h4M6 22v-5h2v5m8 0v-5h2v5\" stroke=\"#07111b\" fill=\"none\"/>","tree":"<path d=\"m12 2-7 9h4l-5 7h6v4h4v-4h6l-5-7h4Z\"/>","school":"<path d=\"m2 8 10-5 10 5-10 5Zm4 3v6q6 6 12 0v-6M22 8v9\"/>","star":"<path d=\"m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z\"/>","more":"<circle cx=\"4\" cy=\"12\" r=\"1\"/><circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"20\" cy=\"12\" r=\"1\"/>"}; return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.house}</svg>`; }

// Recovery searches are discovery links, not verified source URLs.
function propertySearchUrl(property) {
  return "https://www.google.com/search?q=" + encodeURIComponent([
    property?.address ? `"${property.address}"` : null,
    property?.label && property?.label !== property?.address ? property.label : null,
    preferences.location || config.search.location,
    property?.listingType === "buy" ? "real estate listing" : "rental listing"
  ].filter(Boolean).join(" "));
}

function propertyListingUrl(property) {
  const direct = safeListingUrl(property?.sourceUrl);
  const confirmedClosed = property?.listingState === "closed" && property?.metadata?.listingClosedEvidence?.confirmed === true;
  const legacyClosedNeedsRecheck = property?.listingState === "closed" && !confirmedClosed;
  const staleResolverState = Number(property?.metadata?.listingResolverVersion || 0) < LISTING_RESOLVER_VERSION;
  return {
    url: direct,
    direct: Boolean(direct),
    closed: confirmedClosed,
    resolving: !direct && (staleResolverState || legacyClosedNeedsRecheck || (!confirmedClosed && !property?.listingCheckedAt)),
    searchUrl: propertySearchUrl(property)
  };
}

function distanceTone(distance) {
  if (!Number.isFinite(distance)) return "unknown";
  if (distance <= 3) return "near";
  if (distance <= 7) return "mid";
  return "far";
}

function distanceLabel(distance) {
  if (!Number.isFinite(distance)) return "—";
  return distance < 10 ? distance.toFixed(1) : String(Math.round(distance));
}

function distancePanel(property) {
  const points = cardPointsOfInterest();
  const cached = getCachedPropertyDistances(property, points, preferences.location || config.search.location);
  const numeric = cached.map(item => item.distance).filter(Number.isFinite);
  const maxDistance = numeric.length ? Math.max(...numeric, 1) : 1;
  const rows = cached.map((item, index) => {
    const short = /^Address\s+(\d+)$/i.exec(item.label)?.[1] || String(index + 1);
    const tone = item.resolved ? distanceTone(item.distance) : "pending";
    const value = item.resolved ? distanceLabel(item.distance) : "—";
    const ratio = Number.isFinite(item.distance) ? Math.max(0.08, Math.min(1, item.distance / maxDistance)) : 0;
    return `<div class="distance-row distance-${tone}" data-distance-id="${esc(item.id)}" title="${esc(item.label)} distance">
      <b>A${esc(short)}</b>
      <span class="distance-row__value">${esc(value)}${value !== "—" ? " mi" : ""}</span>
      <span class="distance-row__track" aria-hidden="true"><i style="--distance-ratio:${ratio}"></i></span>
    </div>`;
  }).join("");
  const allResolved = cached.length > 0 && cached.every(item => item.resolved);
  return `<aside class="distance-panel" data-poi-distances data-distance-resolved="${allResolved}" aria-label="Distances to saved addresses">${rows}</aside>`;
}

function renderResolvedDistances(target, distances = []) {
  const numeric = distances.map(item => item.distance).filter(Number.isFinite);
  const maxDistance = numeric.length ? Math.max(...numeric, 1) : 1;
  for (const item of distances) {
    const row = target.querySelector(`[data-distance-id="${CSS.escape(String(item.id))}"]`);
    if (!row) continue;
    const value = distanceLabel(item.distance);
    row.className = `distance-row distance-${distanceTone(item.distance)}`;
    const valueEl = row.querySelector(".distance-row__value");
    if (valueEl) valueEl.textContent = value + (value !== "—" ? " mi" : "");
    const bar = row.querySelector(".distance-row__track i");
    if (bar) {
      const ratio = Number.isFinite(item.distance) ? Math.max(0.08, Math.min(1, item.distance / maxDistance)) : 0;
      bar.style.setProperty("--distance-ratio", String(ratio));
    }
  }
  target.dataset.distanceResolved = "true";
}


function propertyContactMethods(property) {
  const metadata = property?.metadata || {};
  const phone = property?.phone || metadata.phone || metadata.contactPhone || metadata.contact_phone || null;
  const email = property?.email || metadata.email || metadata.contactEmail || metadata.contact_email || null;
  return {
    phone: phone ? String(phone) : null,
    email: email ? String(email) : null,
    listing: propertyListingUrl(property)
  };
}

let workflowPropertyId = null;
let workflowIntent = "contact";

function markPropertyContacted(property) {
  store.update(property.id, { status: PROPERTY_STATUS.CONTACTED, contactedAt: new Date().toISOString() });
  recordActivity("contacted", property);
}

function openContactWorkflow(property, intent = "contact") {
  if (!property) return;
  workflowPropertyId = String(property.id);
  workflowIntent = intent;
  const methods = propertyContactMethods(property);
  const title = intent === "showing" ? "Request showing" : "Contact";
  document.querySelector("#contact-workflow-title").textContent = title;
  document.querySelector("#contact-workflow-property").textContent = property.label || property.address || "Property";
  const actions = document.querySelector("#contact-workflow-actions");
  actions.replaceChildren();

  if (methods.phone) {
    const call = document.createElement("a");
    call.href = "tel:" + methods.phone.replace(/[^+\d]/g, "");
    call.className = "workflow-action";
    call.textContent = "Call " + methods.phone;
    call.addEventListener("click", () => {
      if (intent === "showing") {
        store.upsert(markShowingRequested(property));
        recordActivity("showing-requested", property, { via: "phone" });
      } else markPropertyContacted(property);
    });
    actions.append(call);
  }

  if (methods.email) {
    const email = document.createElement("a");
    const subject = intent === "showing" ? "Showing request — " + (property.label || property.address || "property") : "Question about " + (property.label || property.address || "property");
    const body = intent === "showing"
      ? "Hi, I’m interested in this property and would like to request a showing. Please let me know what times are available."
      : "Hi, I’m interested in this property and would like more information. Please let me know when you have a chance.";
    email.href = "mailto:" + encodeURIComponent(methods.email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    email.className = "workflow-action";
    email.textContent = "Email " + methods.email;
    email.addEventListener("click", () => {
      if (intent === "showing") {
        store.upsert(markShowingRequested(property));
        recordActivity("showing-requested", property, { via: "email" });
      } else markPropertyContacted(property);
    });
    actions.append(email);
  }

  if (methods.listing.url) {
    const listing = document.createElement("a");
    listing.href = methods.listing.url;
    listing.target = "_blank";
    listing.rel = "noopener noreferrer";
    listing.className = "workflow-action";
    listing.textContent = intent === "showing" ? "Open source listing to request showing" : "Open source listing";
    listing.addEventListener("click", () => {
      if (intent === "showing") {
        store.upsert(markShowingRequested(property));
        recordActivity("showing-requested", property, { via: "listing" });
      } else markPropertyContacted(property);
    });
    actions.append(listing);
  }

  const manual = document.createElement("button");
  manual.type = "button";
  manual.className = "workflow-action";
  manual.textContent = intent === "showing" ? "Already requested" : "Mark as contacted";
  manual.addEventListener("click", () => {
    if (intent === "showing") {
      store.upsert(markShowingRequested(property));
      recordActivity("showing-requested", property, { via: "manual" });
    } else markPropertyContacted(property);
    document.querySelector("#contact-workflow-dialog").close();
  });
  actions.append(manual);

  document.querySelector("#contact-workflow-dialog").showModal();
}

function openShowingWorkflow(property) {
  if (!property) return;
  workflowPropertyId = String(property.id);
  document.querySelector("#showing-workflow-property").textContent = property.label || property.address || "Property";
  document.querySelector("#showing-workflow-dialog").showModal();
}

function propertyCard(property) {
  const saved = property.saved || property.status === PROPERTY_STATUS.SHORTLISTED;
  const score = Math.max(0, Math.min(100, rankProperty(property, preferences)));
  const kind = classifyPropertyKind(property);
  const image = firstImageUrl(property) || "";
  const listing = propertyListingUrl(property);
  const displayAddress = property.address || (/^\d+\s/.test(String(property.label || "")) ? property.label : "Address unavailable");
  const displayPrice = property.metadata?.priceLabel
    || (property.type === "Rental area" ? "Area research"
    : Number.isFinite(Number(property.price)) && Number(property.price) > 0
      ? "$" + Number(property.price).toLocaleString() + (property.listingType === "rent" ? "/mo" : "")
      : "Price unavailable");
  return `<article class="property-card visual-card type-${kind}" data-id="${esc(property.id)}" tabindex="0" aria-label="View summary for ${esc(property.label)}" aria-haspopup="dialog" style="--score:${score}">
      <button class="save-button ${saved ? "is-saved" : ""}" aria-pressed="${saved}" data-action="save" aria-label="Save ${esc(property.label)}">${icon("star")}</button>
    <section class="property-card__media" aria-label="Listing image">
      <div class="property-visual ${image ? "" : "property-visual--fallback"}" ${image ? `style="--property-image:url(\'${esc(image)}\')"` : ""} aria-hidden="true">${!image ? `<span class="property-placeholder-icon">${icon(kind === "apartment" ? "building" : kind === "townhome" ? "townhome" : "house")}</span>` : ""}</div>

    </section>
    <section class="property-card__summary">
      <header class="property-card__identity"><span class="property-type-icon" role="img" aria-label="${kind}" title="${kind}">${icon(kind === "apartment" ? "building" : kind === "townhome" ? "townhome" : "house")}</span><div><h2>${esc(property.label)}</h2><p class="muted">${esc(displayAddress)}</p></div></header>
      <div class="property-card__facts"><strong>${displayPrice}</strong><span>${icon("bed")} ${property.beds ?? "—"} bd</span><span>${icon("bath")} ${property.baths ?? "—"} ba</span></div>
      <p class="note compact-note">${esc(property.note || "No visit notes yet.")}</p>
      <div class="property-card__actions compact-actions">
        ${listing.url
          ? `<a class="status-action listing-action source-link" href="${esc(listing.url)}" target="_blank" rel="noopener noreferrer" aria-label="View source listing for ${esc(property.label)}" title="View source listing"><span aria-hidden="true">↗</span><b>View listing</b></a>`
          : listing.closed
            ? `<span class="status-action listing-action listing-closed" aria-label="Listing closed" title="Rook could not find a current listing after checking live sources"><span aria-hidden="true">×</span><b>Closed</b></span>`
            : listing.resolving
              ? `<span class="status-action listing-action listing-resolving" aria-label="Rook is looking for this listing" title="Rook is checking live sources"><span aria-hidden="true">…</span><b>Finding…</b></span>`
              : `<a class="status-action listing-action listing-recovery-link" href="${esc(listing.searchUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Find a current listing for ${esc(property.label)}" title="Rook already checked live sources — search manually"><span aria-hidden="true">⌕</span><b>Find listing</b></a>`}
        <button class="icon-action" data-action="map" aria-label="Focus on map" title="Focus on map">${icon("pin")}</button>
        <button class="icon-action more-card-actions" data-action="expand" aria-label="More property actions" aria-expanded="false">${icon("more")}</button>
      </div>
      <div class="property-card__more" hidden>
        ${listing.url
          ? `<a class="source-link more-listing-link" href="${esc(listing.url)}" target="_blank" rel="noopener noreferrer">View listing</a>`
          : listing.closed
            ? `<span class="more-listing-link listing-closed">Closed</span>`
            : `<a class="listing-recovery-link more-listing-link" href="${esc(listing.searchUrl)}" target="_blank" rel="noopener noreferrer">Find listing</a>`}
        <button data-action="visited">Visited</button><button data-action="showing">Request showing</button><button data-action="schedule">Schedule</button><button data-action="note">Notes</button><button data-action="reject">Ignore</button><button data-action="archive">Archive</button>
      </div>
    </section>
    ${distancePanel(property)}
    <div class="fit-ring" title="Match score ${score}" aria-label="Match score ${score}"><span>${score}</span></div>
    <aside class="property-card__context" aria-label="Neighborhood context">

      <div class="card-map-art card-map-art--disabled" aria-hidden="true"></div>
    </aside>
  </article>`;
}

function visibleProperties() {
  const filtered = searchProperties(filterProperties(store.getAll(), activeFilter), query);
  return rankProperties(filtered, preferences);
}

function renderActivity() {
  const items = getActivity().slice(0, 8);
  const target = document.querySelector("#activity-list");
  if (!target) return;
  target.innerHTML = items.length
    ? items.map(item => `<li><strong>${esc(item.kind.replaceAll("-", " "))}</strong><span>${esc(item.label || "Property")}</span><time>${new Date(item.at).toLocaleString()}</time></li>`).join("")
    : '<li class="muted">No activity yet.</li>';
}

// Rook attempts live source recovery before exposing a manual Find listing search.
async function resolveUnavailableListings() {
  const candidates = store.getAll().filter(property => {
    if (!property.address && !property.label && !safeListingUrl(property.sourceUrl)) return false;
    const confirmedClosed = property.listingState === "closed" && property.metadata?.listingClosedEvidence?.confirmed === true;
    if (confirmedClosed) return false;
    if (property.listingState === "closed") return true; // legacy closed states are invalidated and rechecked immediately
    const missingAddress = !String(property.address || "").trim();
    const missingSource = !safeListingUrl(property.sourceUrl);
    const missingPrice = !(Number.isFinite(Number(property.price)) && Number(property.price) > 0) && !property.metadata?.priceLabel;
    const needsEnrichment = missingAddress || missingSource || missingPrice;
    if (!needsEnrichment) return false;
    const staleResolverState = Number(property.metadata?.listingResolverVersion || 0) < LISTING_RESOLVER_VERSION;
    if (staleResolverState) return true;
    const checkedAt = property.listingCheckedAt ? new Date(property.listingCheckedAt).getTime() : 0;
    return !checkedAt || Date.now() - checkedAt > 30 * 60 * 1000;
  }).slice(0, 12);

  for (const property of candidates) {
    try {
      const result = await resolveMissingListing(property, { location: preferences.location || config.search.location });
      if (result.state === "active" && result.listing) {
        store.upsert({
          ...result.listing,
          id: property.id,
          saved: property.saved,
          status: property.status,
          note: property.note,
          listingState: "active",
          listingCheckedAt: result.checkedAt,
          metadata: {
            ...(property.metadata || {}),
            ...(result.listing.metadata || {}),
            listingResolverVersion: LISTING_RESOLVER_VERSION
          }
        });
        recordActivity("listing-recovered", property, { sourceUrl: result.url });
      } else {
        const nextMetadata = { ...(property.metadata || {}), listingResolverVersion: LISTING_RESOLVER_VERSION };
        if (result.state === "closed" && result.evidence?.confirmed === true) {
          nextMetadata.listingClosedEvidence = result.evidence;
        } else {
          delete nextMetadata.listingClosedEvidence;
        }
        store.update(property.id, {
          listingState: result.state,
          listingCheckedAt: result.checkedAt,
          metadata: nextMetadata
        });
        if (result.state === "closed" && result.evidence?.confirmed === true) recordActivity("listing-closed", property);
      }
    } catch (error) {
      recordActivity("listing-resolve-error", property, { message: String(error?.message || error) });
    }
  }
}

async function refreshListings(trigger = "manual") {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const buttons = document.querySelectorAll("[data-refresh-listings]");
  buttons.forEach(button => { button.disabled = true; button.textContent = "Refreshing…"; });
  document.querySelector("#pull-indicator")?.classList.add("refreshing");
  try {
    const { address1, ...searchPreferences } = preferences;
    const found = await searchProviders({ ...searchPreferences, location: preferences.location || config.search.location, radiusMiles: preferences.radiusMiles, query });
    store.upsertMany(found);
    void resolveUnavailableListings().then(() => renderList());
    recordActivity("provider-refresh", null, { count: found.length, trigger });
    const indicator = document.querySelector("#pull-indicator");
    if (indicator) indicator.textContent = found.length ? `Found ${found.length} listings · checking missing details` : "Listings checked · checking missing details";
  } catch (error) {
    recordActivity("provider-refresh-error", null, { trigger, message: String(error?.message || error) });
    const indicator = document.querySelector("#pull-indicator");
    if (indicator) indicator.textContent = "Refresh failed · saved listings kept";
  } finally {
    refreshInFlight = false;
    buttons.forEach(button => { button.disabled = false; button.textContent = "Refresh listings"; });
    const indicator = document.querySelector("#pull-indicator");
    if (indicator) {
      indicator.classList.remove("refreshing", "ready");
      indicator.style.setProperty("--pull", "0px");
      const resultText = indicator.textContent;
      window.setTimeout(() => {
        if (!refreshInFlight && indicator.textContent === resultText) indicator.textContent = "Pull to refresh";
      }, 2200);
    }
    renderList();
  }
}

function restoreSelectedMapCard({ keepSelection = false } = {}) {
  const panel = document.querySelector("#map-details");
  if (selectedMapCard && selectedMapCardPlaceholder?.isConnected) {
    selectedMapCardPlaceholder.replaceWith(selectedMapCard);
  } else if (selectedMapCard?.isConnected && selectedMapCard.closest("#map-details")) {
    selectedMapCard.remove();
  }
  selectedMapCard = null;
  selectedMapCardPlaceholder = null;
  if (panel) {
    panel.replaceChildren();
    panel.hidden = true;
    delete panel.dataset.selectedPropertyId;
  }
  if (!keepSelection) selectedMapPropertyId = null;
}

function movePropertyCardUnderMap(id) {
  const propertyId = String(id || "");
  if (!propertyId) return;
  if (selectedMapPropertyId === propertyId && selectedMapCard?.isConnected && selectedMapCard.closest("#map-details")) return;

  restoreSelectedMapCard();
  const panel = document.querySelector("#map-details");
  const list = document.querySelector("#property-list");
  const card = list?.querySelector(`[data-id="${CSS.escape(propertyId)}"]`);
  if (!panel || !card) return;

  const placeholder = document.createElement("div");
  placeholder.hidden = true;
  placeholder.dataset.mapCardPlaceholder = propertyId;
  card.before(placeholder);

  selectedMapPropertyId = propertyId;
  selectedMapCard = card;
  selectedMapCardPlaceholder = placeholder;
  panel.replaceChildren(card);
  panel.hidden = false;
  panel.dataset.selectedPropertyId = propertyId;
  queueDistanceUpdates(panel);
}

function ensureDistanceObserver() {
  if (distanceObserver || typeof IntersectionObserver === "undefined") return distanceObserver;
  distanceObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      distanceObserver.unobserve(entry.target);
      if (entry.target.dataset.distanceResolved === "true") continue;
      const card = entry.target.closest("[data-id]");
      const property = card && store.getAll().find(p => String(p.id) === String(card.dataset.id));
      if (property) void updateCardDistances(entry.target, property, cardPointsOfInterest(), preferences.location || config.search.location);
    }
  }, { rootMargin: "200px" });
  return distanceObserver;
}

function queueDistanceUpdates(root = document) {
  const targets = root.querySelectorAll?.("[data-poi-distances]") || [];
  const points = cardPointsOfInterest();
  if (!points.length) return;
  const observer = ensureDistanceObserver();
  for (const target of targets) {
    if (target.dataset.distanceResolved === "true") continue;
    if (observer) observer.observe(target);
    else {
      const card = target.closest("[data-id]");
      const property = card && store.getAll().find(p => String(p.id) === String(card.dataset.id));
      if (property) void updateCardDistances(target, property, points, preferences.location || config.search.location);
    }
  }
}


function scheduleRenderList() {
  if (renderQueued) return;
  renderQueued = true;
  const run = () => {
    renderQueued = false;
    renderList();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else queueMicrotask(run);
}

function renderList() {
  const mapSelectionToRestore = selectedMapPropertyId;
  if (mapSelectionToRestore) restoreSelectedMapCard({ keepSelection: true });
  const visible = visibleProperties();
  document.querySelector("#property-count").textContent = `${visible.length} shown · ${preferences.location || config.search.location} · ${preferences.radiusMiles || 15} mi`;
  document.querySelector("#property-list").innerHTML = visible.map(propertyCard).join("");
  // Map exactly the same property set the user can currently see.
  // This keeps list/map completeness as a hard invariant.
  renderPropertyMap(document.querySelector("#property-map"), visible, {
    activeFilter,
    dataAlreadyFiltered: true,
    location: preferences.location || config.search.location,
    pointsOfInterest: cardPointsOfInterest(),
    onPropertyAction(action, id) {
      const property = store.getAll().find(p => String(p.id) === id);
      if (!property) return;
      const card = document.querySelector(`#property-list [data-id="${CSS.escape(id)}"]`);
      if (action === "directions") return openDirections(property);
      if (action === "view") {
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      card?.querySelector(`[data-action="${action}"]`)?.click();
    }
  });
  // Per-card background maps are temporarily disabled to avoid flashing and excess GPU/CPU work.
  queueDistanceUpdates(document.querySelector("#property-list"));
  renderActivity();
  renderIgnoredProperties();
  if (mapSelectionToRestore) movePropertyCardUnderMap(mapSelectionToRestore);
}

app.innerHTML = `<main class="shell">
<header class="topbar"><div><p class="eyebrow">HOUSE HUNTING</p><h1>ROOK</h1></div><button id="settings-button" class="icon-button" aria-label="Settings">⚙</button></header>
<div id="pull-indicator" class="pull-indicator" aria-live="polite">Pull to refresh</div>
<section class="map-shell overview-map" aria-label="Property map and page scroll gutters"><div class="map-scroll-gutter map-scroll-gutter--left" aria-hidden="true"></div><div class="map-panel"><div id="property-map" class="property-map" role="region" aria-label="Interactive property map"></div></div><div class="map-scroll-gutter map-scroll-gutter--right" aria-hidden="true"></div></section>
<section id="map-details" class="map-details" aria-label="Property details" aria-live="polite" hidden></section>
<section class="results"><div class="section-heading"><h2>Properties</h2><span id="property-count"></span></div><div id="property-list"></div></section>
<section class="activity-panel"><div class="section-heading"><h2>Recent activity</h2></div><ul id="activity-list"></ul></section>

<button id="more-button" class="more-button" aria-label="Open Rook actions" aria-haspopup="dialog">•••</button>
<dialog id="actions-dialog" class="actions-dialog"><form method="dialog"><div class="dialog-heading"><div><p class="eyebrow">ROOK</p><h2>Actions</h2></div><button class="dialog-close" value="cancel" aria-label="Close">×</button></div>
<label for="property-search">Search properties</label><input id="property-search" type="search" placeholder="Address, neighborhood, property…">
<nav class="filters" aria-label="Property filters"><button type="button" class="active" data-filter="all">All</button><button type="button" data-filter="rent">Rent</button><button type="button" data-filter="buy">Buy</button><button type="button" data-filter="shortlist">Favorited</button></nav>
<div class="action-menu"><button id="open-ignored" type="button">Ignored properties</button><button id="add-listing" type="button">＋ Add listing</button><button id="route-shortlist" type="button">Route favorites</button><button type="button" data-refresh-listings>Refresh listings</button><button id="open-settings" type="button">Search preferences</button></div>
</form></dialog>

<div id="ignore-toast" class="ignore-toast" role="status" hidden><span id="ignore-message"></span><button id="undo-ignore" type="button">Undo</button><button id="dismiss-ignore" type="button" aria-label="Dismiss">×</button></div>
<dialog id="ignored-dialog"><div class="dialog-heading"><h2>Ignored properties</h2><button id="close-ignored" class="dialog-close" aria-label="Close ignored properties">×</button></div><p>Restore a property to put it back in your results.</p><div id="ignored-list"></div></dialog>
<dialog id="property-summary-dialog" aria-labelledby="property-summary-title"><div class="dialog-heading"><h2 id="property-summary-title">Property summary</h2><button id="close-property-summary" class="dialog-close" aria-label="Close property summary">×</button></div><div id="property-summary-content"></div></dialog>
<dialog id="contact-workflow-dialog" class="workflow-dialog" aria-labelledby="contact-workflow-title">
  <div class="dialog-heading"><div><p class="eyebrow">PROPERTY</p><h2 id="contact-workflow-title">Contact</h2></div><button id="close-contact-workflow" class="dialog-close" aria-label="Close contact options">×</button></div>
  <p id="contact-workflow-property" class="workflow-property"></p>
  <div id="contact-workflow-actions" class="workflow-actions"></div>
</dialog>
<dialog id="showing-workflow-dialog" class="workflow-dialog" aria-labelledby="showing-workflow-title">
  <div class="dialog-heading"><div><p class="eyebrow">PROPERTY</p><h2 id="showing-workflow-title">Showing</h2></div><button id="close-showing-workflow" class="dialog-close" aria-label="Close showing options">×</button></div>
  <p id="showing-workflow-property" class="workflow-property"></p>
  <div class="workflow-actions">
    <button type="button" id="showing-contact-request" class="workflow-action">Contact to request showing</button>
    <button type="button" id="showing-already-requested" class="workflow-action">Already requested</button>
    <button type="button" id="showing-schedule-confirmed" class="workflow-action">Schedule confirmed showing</button>
  </div>
</dialog>
<dialog id="import-dialog"><form method="dialog"><h2>Add listing</h2><p class="muted">Paste a listing URL. Rook keeps the source and routes it through the shared property model.</p><input id="listing-url" type="url" placeholder="https://…" required /><div class="dialog-actions"><button value="cancel">Cancel</button><button id="import-confirm" value="default">Add</button></div></form></dialog>

<dialog id="settings-dialog"><form method="dialog"><h2>Search preferences</h2>
<label>Address 1 location<input id="pref-address-1" type="text" placeholder="Paste a Google Maps place link"><small>Saved in this browser only. Leave blank to hide Address 1.</small></label>
<label>Search location<input id="pref-location" type="text" autocomplete="address-level2" placeholder="Fort Collins, CO"></label>
<label>Search radius (miles)<input id="pref-radius" type="number" min="1" max="100" step="1"></label>
<label>Minimum bedrooms<input id="pref-min-beds" type="number" min="0" step="1"></label>
<label>Maximum monthly rent<input id="pref-max-price" type="number" min="0" step="50"></label>
<fieldset class="type-options"><legend>Property types</legend>
<label class="check-row"><input id="pref-type-apartment" type="checkbox"> Apartments</label>
<label class="check-row"><input id="pref-type-townhome" type="checkbox"> Townhomes</label>
<label class="check-row"><input id="pref-type-house" type="checkbox"> Houses</label></fieldset>
<label class="check-row"><input id="pref-exclude-income" type="checkbox"> Exclude income-restricted housing</label>
<label class="check-row"><input id="pref-exclude-mobile" type="checkbox"> Exclude mobile/manufactured homes</label>
<label class="check-row"><input id="pref-kid-friendly" type="checkbox"> Prioritize kid-friendly areas</label>
<label class="check-row"><input id="pref-school" type="checkbox"> Prioritize nearby schools</label>
<label>Visual theme<select id="pref-theme"><option value="default">Default · Twilight</option><option value="warm">Warm</option><option value="night">Night</option><option value="mono">Monochrome</option></select></label>
<input id="restore-data" type="file" accept="application/json,.json" hidden><div class="dialog-actions"><button id="restore-button" type="button">Restore backup</button><button id="export-data" type="button">Export backup</button><button value="cancel">Cancel</button><button id="save-settings" value="default">Save</button></div></form></dialog>
</main>`;


let lastIgnoredId = null;
const isIgnored = property => [PROPERTY_STATUS.REJECTED, PROPERTY_STATUS.ARCHIVED].includes(property.status);
function renderIgnoredProperties() {
  const ignored = store.getAll().filter(isIgnored);
  document.querySelector("#open-ignored").textContent = `Ignored properties (${ignored.length})`;
  document.querySelector("#ignored-list").innerHTML = ignored.length
    ? ignored.map(p => `<article class="ignored-property"><div><h3>${esc(p.label)}</h3><p>${esc(p.address)}</p></div><button type="button" data-restore-id="${esc(p.id)}">Restore</button></article>`).join("")
    : "<p>No ignored properties.</p>";
}
function restoreIgnoredProperty(id) {
  const property = store.getAll().find(p => p.id === id);
  if (!property || !isIgnored(property)) return;
  store.update(id, restoreIgnoredPatch(property));
  recordActivity("restored", property);
  if (lastIgnoredId === id) {
    lastIgnoredId = null;
    document.querySelector("#ignore-toast").hidden = true;
  }
  renderActivity();
}
document.querySelector("#open-ignored").addEventListener("click", () => {
  document.querySelector("#actions-dialog").close();
  renderIgnoredProperties();
  document.querySelector("#ignored-dialog").showModal();
});
document.querySelector("#close-ignored").addEventListener("click", () => document.querySelector("#ignored-dialog").close());
document.querySelector("#ignored-list").addEventListener("click", event => {
  const id = event.target.closest("[data-restore-id]")?.dataset.restoreId;
  if (id) restoreIgnoredProperty(id);
});
document.querySelector("#undo-ignore").addEventListener("click", () => restoreIgnoredProperty(lastIgnoredId));
document.querySelector("#dismiss-ignore").addEventListener("click", () => { document.querySelector("#ignore-toast").hidden = true; });
function ignoreProperty(property, status) {
  store.update(property.id, ignorePropertyPatch(property, status));
  lastIgnoredId = property.id;
  document.querySelector("#ignore-message").textContent = `${property.label} ignored.`;
  document.querySelector("#ignore-toast").hidden = false;
}

document.addEventListener("rook:distances-resolved", event => {
  const target = event.target.closest?.("[data-poi-distances]") || event.target;
  if (target?.matches?.("[data-poi-distances]")) renderResolvedDistances(target, event.detail?.distances || []);
});

document.querySelector("#property-map").addEventListener("rook:map-select", event => {
  const id = String(event.detail?.id || "");
  if (!id) return;
  movePropertyCardUnderMap(id);
});
document.querySelector("#property-map").addEventListener("rook:map-clear", () => {
  restoreSelectedMapCard();
});
document.querySelector("#more-button").addEventListener("click", () => document.querySelector("#actions-dialog").showModal());
document.querySelector("#property-search").addEventListener("input", e => { query = e.target.value; renderList(); });

document.querySelector(".filters").addEventListener("click", e => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  activeFilter = b.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(el => el.classList.toggle("active", el === b));
  renderList();
});


function safeListingUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function openPropertySummary(id) {
  const property = store.getAll().find(p => p.id === id);
  if (!property) return;
  const url = safeListingUrl(property.sourceUrl);
  const price = property.price ? "$" + Number(property.price).toLocaleString() + (property.listingType === "buy" ? "" : "/mo") : "Price TBD";
  const searchUrl = propertySearchUrl(property);
  document.querySelector("#property-summary-title").textContent = property.label || "Property summary";
  document.querySelector("#property-summary-content").innerHTML = `
    <p>${esc(property.address || "Address unavailable")}</p>
    <p><strong>${esc(price)}</strong> · ${esc(property.beds ?? "—")} bedrooms · ${esc(property.baths ?? "—")} bathrooms</p>
    <p>${esc(property.type || "Property")} · ${esc((property.status || "new").replaceAll("-", " "))} · Match ${rankProperty(property, preferences)}</p>
    ${property.metadata?.description ? `<p>${esc(property.metadata.description)}</p>` : ""}
    <h3>Notes</h3><p>${esc(property.note || "No notes yet.")}</p>
    ${url ? "" : "<p class='listing-unavailable'>No original listing link is saved for this property.</p>"}
    <div class="map-detail-actions"><a href="${esc(url || searchUrl)}" target="_blank" rel="noopener noreferrer">${url ? "Open listing" : "Find listing"}</a><button type="button" id="summary-directions">Directions</button></div>`;
  document.querySelector("#summary-directions").addEventListener("click", () => openDirections(property));
  document.querySelector("#property-summary-dialog").showModal();
}
document.querySelector("#close-property-summary").addEventListener("click", () => document.querySelector("#property-summary-dialog").close());
document.querySelector("#close-contact-workflow").addEventListener("click", () => document.querySelector("#contact-workflow-dialog").close());
document.querySelector("#close-showing-workflow").addEventListener("click", () => document.querySelector("#showing-workflow-dialog").close());
document.querySelector("#showing-contact-request").addEventListener("click", () => {
  const property = store.getAll().find(p => String(p.id) === workflowPropertyId);
  document.querySelector("#showing-workflow-dialog").close();
  if (property) openContactWorkflow(property, "showing");
});
document.querySelector("#showing-already-requested").addEventListener("click", () => {
  const property = store.getAll().find(p => String(p.id) === workflowPropertyId);
  if (property) {
    store.upsert(markShowingRequested(property));
    recordActivity("showing-requested", property, { via: "manual" });
  }
  document.querySelector("#showing-workflow-dialog").close();
});
document.querySelector("#showing-schedule-confirmed").addEventListener("click", () => {
  const property = store.getAll().find(p => String(p.id) === workflowPropertyId);
  document.querySelector("#showing-workflow-dialog").close();
  if (!property) return;
  const value = window.prompt("Showing date/time (example: 2026-09-29 14:30)", "");
  if (!value) return;
  const startsAt = new Date(value);
  if (Number.isNaN(startsAt.getTime())) return;
  store.update(property.id, { status: PROPERTY_STATUS.SHOWING_SCHEDULED, showingAt: startsAt.toISOString(), contactOutcome: "showing-scheduled" });
  recordActivity("showing-scheduled", property, { startsAt: startsAt.toISOString() });
  const calendarUrl = googleCalendarShowingUrl(property, startsAt);
  if (calendarUrl) window.open(calendarUrl, "_blank", "noopener,noreferrer");
});
function handlePropertyCardKeydown(event) {
  // Property cards are passive containers; actions are available through explicit controls only.
}

function handlePropertyCardClick(e) {
  const recoveryLink = e.target.closest(".listing-recovery-link");
  if (recoveryLink) {
    const recoveryCard = e.target.closest("[data-id]");
    const recoveryProperty = recoveryCard && store.getAll().find(x => String(x.id) === String(recoveryCard.dataset.id));
    if (recoveryProperty) {
      if (recoveryProperty.status === PROPERTY_STATUS.NEW) store.update(recoveryProperty.id, { status: PROPERTY_STATUS.VIEWED });
      recordActivity("listing-search", recoveryProperty, { query: recoveryLink.href });
    }
    return;
  }

  const sourceLink = e.target.closest(".source-link");
  if (sourceLink) {
    const sourceCard = e.target.closest("[data-id]");
    const sourceProperty = sourceCard && store.getAll().find(x => String(x.id) === String(sourceCard.dataset.id));
    if (sourceProperty?.status === PROPERTY_STATUS.NEW) {
      store.update(sourceProperty.id, { status: PROPERTY_STATUS.VIEWED });
      recordActivity("viewed", sourceProperty);
    }
    return;
  }

  const action = e.target.closest("[data-action]")?.dataset.action;
  const card = e.target.closest("[data-id]");
  if (!action || !card) return;
  const p = store.getAll().find(x => String(x.id) === String(card.dataset.id));
  if (!p) return;

  if (action === "expand") {
    const more = card.querySelector(".property-card__more");
    const button = card.querySelector(".more-card-actions");
    const opening = more.hidden;
    more.hidden = !opening;
    card.classList.toggle("expanded", opening);
    button.setAttribute("aria-expanded", String(opening));
    return;
  }

  if (action === "save") {
    store.toggleSaved(p.id);
    recordActivity(p.saved ? "unfavorited" : "favorited", p);
  }
  if (action === "map") {
    recordActivity("focused-map", p);
    void focusPropertyOnMap(p);
    document.querySelector(".map-shell")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (action === "visited") {
    store.update(p.id, { status: PROPERTY_STATUS.VISITED });
    recordActivity("visited", p);
  }
  if (action === "contact") {
    openContactWorkflow(p, "contact");
    return;
  }
  if (action === "showing") {
    openShowingWorkflow(p);
    return;
  }
  if (action === "note") {
    const note = window.prompt("Property notes", p.note || "");
    if (note !== null) {
      store.update(p.id, { note });
      recordActivity("note-updated", p);
    }
  }
  if (action === "reject") {
    ignoreProperty(p, PROPERTY_STATUS.REJECTED);
    recordActivity("rejected", p);
  }
  if (action === "schedule") {
    const value = window.prompt("Showing date/time (example: 2026-09-29 14:30)", "");
    if (value) {
      const startsAt = new Date(value);
      if (!Number.isNaN(startsAt.getTime())) {
        store.update(p.id, { status: PROPERTY_STATUS.SHOWING_SCHEDULED, showingAt: startsAt.toISOString(), contactOutcome: "showing-scheduled" });
        recordActivity("showing-scheduled", p, { startsAt: startsAt.toISOString() });
        const calendarUrl = googleCalendarShowingUrl(p, startsAt);
        if (calendarUrl) window.open(calendarUrl, "_blank", "noopener,noreferrer");
      }
    }
  }
  if (action === "archive") {
    ignoreProperty(p, PROPERTY_STATUS.ARCHIVED);
    recordActivity("archived", p);
  }
  renderActivity();
}

document.querySelector("#property-list").addEventListener("keydown", handlePropertyCardKeydown);
document.querySelector("#map-details").addEventListener("keydown", handlePropertyCardKeydown);
document.querySelector("#property-list").addEventListener("click", handlePropertyCardClick);
document.querySelector("#map-details").addEventListener("click", handlePropertyCardClick);

document.querySelector("#add-listing").addEventListener("click", () => document.querySelector("#import-dialog").showModal());
document.querySelector("#import-confirm").addEventListener("click", e => {
  const input = document.querySelector("#listing-url");
  if (!input.checkValidity()) return;
  e.preventDefault();
  try {
    const property = propertyFromUrl(input.value);
    store.upsert(property);
    recordActivity("imported", property, { sourceUrl: input.value });
    input.value = "";
    document.querySelector("#import-dialog").close();
  } catch {
    input.setCustomValidity("Enter a valid listing URL");
    input.reportValidity();
  }
});
document.querySelector("#listing-url").addEventListener("input", e => e.target.setCustomValidity(""));

document.querySelector("#route-shortlist").addEventListener("click", () => {
  const properties = store.getAll().filter(p => p.saved && p.status !== PROPERTY_STATUS.ARCHIVED);
  const url = googleMapsMultiStopUrl(properties);
  if (url) {
    properties.forEach(p => recordActivity("routed", p));
    window.open(url, "_blank", "noopener,noreferrer");
  }
});

document.querySelectorAll("[data-refresh-listings]").forEach(button => button.addEventListener("click", () => refreshListings("manual")));

function openSettings() {
  document.querySelector("#pref-address-1").value = preferences.address1?.mapLink || "";
  document.querySelector("#pref-location").value = preferences.location || config.search.location;
  document.querySelector("#pref-radius").value = preferences.radiusMiles ?? 15;
  document.querySelector("#pref-min-beds").value = preferences.minBeds ?? 2;
  document.querySelector("#pref-max-price").value = preferences.maxPrice ?? "";
  const types = preferences.propertyTypes || ["apartment","townhome","house"];
  document.querySelector("#pref-type-apartment").checked = types.includes("apartment");
  document.querySelector("#pref-type-townhome").checked = types.includes("townhome");
  document.querySelector("#pref-type-house").checked = types.includes("house");
  document.querySelector("#pref-exclude-income").checked = preferences.excludeIncomeRestricted !== false;
  document.querySelector("#pref-exclude-mobile").checked = preferences.excludeMobileHomes !== false;
  document.querySelector("#pref-kid-friendly").checked = Boolean(preferences.kidFriendlyPriority);
  document.querySelector("#pref-school").checked = Boolean(preferences.schoolPriority);
  document.querySelector("#pref-theme").value = preferences.visualTheme || "default";
  document.querySelector("#settings-dialog").showModal();
}
document.querySelector("#settings-button").addEventListener("click", openSettings);
document.querySelector("#open-settings").addEventListener("click", () => {
  document.querySelector("#actions-dialog").close();
  openSettings();
});

document.querySelector("#save-settings").addEventListener("click", e => {
  e.preventDefault();
  const selectedTypes = [["apartment","#pref-type-apartment"],["townhome","#pref-type-townhome"],["house","#pref-type-house"]].filter(([,selector]) => document.querySelector(selector).checked).map(([type]) => type);
  if (!selectedTypes.length) {
    document.querySelector("#pref-type-apartment").setCustomValidity("Select at least one property type");
    document.querySelector("#pref-type-apartment").reportValidity();
    return;
  }
  document.querySelector("#pref-type-apartment").setCustomValidity("");
  const address1Link = document.querySelector("#pref-address-1").value.trim();
  const coordinateMatch = address1Link.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || address1Link.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (address1Link && (!coordinateMatch || Math.abs(Number(coordinateMatch[1])) > 90 || Math.abs(Number(coordinateMatch[2])) > 180)) {
    document.querySelector("#pref-address-1").setCustomValidity("Paste the full Google Maps place link from the address bar.");
    document.querySelector("#pref-address-1").reportValidity();
    return;
  }
  document.querySelector("#pref-address-1").setCustomValidity("");
  preferences = {
    ...preferences,
    address1: coordinateMatch ? { lat: Number(coordinateMatch[1]), lng: Number(coordinateMatch[2]), mapLink: address1Link } : null,
    location: document.querySelector("#pref-location").value.trim() || config.search.location,
    radiusMiles: Math.max(1, Number(document.querySelector("#pref-radius").value) || 15),
    minBeds: Number(document.querySelector("#pref-min-beds").value) || 0,
    maxPrice: Number(document.querySelector("#pref-max-price").value) || null,
    propertyTypes: selectedTypes,
    excludeIncomeRestricted: document.querySelector("#pref-exclude-income").checked,
    excludeMobileHomes: document.querySelector("#pref-exclude-mobile").checked,
    kidFriendlyPriority: document.querySelector("#pref-kid-friendly").checked,
    schoolPriority: document.querySelector("#pref-school").checked,
    visualTheme: document.querySelector("#pref-theme").value || "default"
  };
  savePreferences(preferences);
  document.documentElement.dataset.theme = preferences.visualTheme || "default";
  recordActivity("preferences-updated", null);
  document.querySelector("#settings-dialog").close();
  renderList();
  refreshListings("preferences");
});

document.querySelector("#restore-button").addEventListener("click", () => document.querySelector("#restore-data").click());

document.querySelector("#restore-data").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const backup = parseRookBackup(await file.text());
    store.replaceAll(backup.properties);
    preferences = { ...preferences, ...backup.preferences };
    savePreferences(preferences);
    recordActivity("backup-restored", null, { propertyCount: backup.properties.length });
    document.querySelector("#settings-dialog").close();
    renderList();
  } catch (error) {
    window.alert(error?.message || "Could not restore this Rook backup.");
  } finally {
    e.target.value = "";
  }
});

document.querySelector("#export-data").addEventListener("click", () => {
  exportRookData(store.getAll(), preferences);
  recordActivity("backup-exported", null);
  renderActivity();
});

document.addEventListener("touchstart", e => {
  if (e.target.closest(".map-panel")) return;
  if (window.scrollY > 0 || document.querySelector("dialog[open]")) return;
  pullStartY = e.touches[0]?.clientY ?? null;
  pullDistance = 0;
}, { passive: true });

document.addEventListener("touchmove", e => {
  if (pullStartY == null || window.scrollY > 0 || refreshInFlight) return;
  pullDistance = Math.max(0, Math.min(110, (e.touches[0]?.clientY ?? pullStartY) - pullStartY));
  const indicator = document.querySelector("#pull-indicator");
  if (!indicator) return;
  indicator.style.setProperty("--pull", pullDistance + "px");
  const ready = pullDistance >= 72;
  indicator.classList.toggle("ready", ready);
  indicator.textContent = ready ? "Release to refresh" : "Pull to refresh";
}, { passive: true });

document.addEventListener("touchend", () => {
  const shouldRefresh = pullStartY != null && pullDistance >= 72 && window.scrollY === 0;
  pullStartY = null;
  pullDistance = 0;
  if (shouldRefresh) refreshListings("pull");
  else {
    const indicator = document.querySelector("#pull-indicator");
    if (indicator) {
      indicator.classList.remove("ready");
      indicator.style.setProperty("--pull", "0px");
      indicator.textContent = "Pull to refresh";
    }
  }
}, { passive: true });

store.subscribe(scheduleRenderList);
renderList();
if (!BROWSER_QA_MODE) queueMicrotask(() => refreshListings("startup"));



