import { properties as seedProperties } from "./data/properties.js";
import { createPropertyStore } from "./core/store.js";
import { filterProperties, searchProperties, PROPERTY_STATUS, applyEvidence } from "./core/property.js";
import { housingEvidence } from "./data/evidence.js";
import { propertyFromUrl } from "./core/import.js";
import { googleMapsMultiStopUrl } from "./core/route.js";
import { loadPreferences, savePreferences } from "./core/preferences.js";
import { rankProperties, rankProperty } from "./core/ranking.js";
import { recordActivity, getActivity } from "./core/activity.js";
import { nextFollowUp, markShowingRequested } from "./core/followup.js";
import { exportRookData, parseRookBackup } from "./core/export.js";
import { searchProviders, registerConfiguredProviders } from "./integrations/providers.js";
import { openDirections, renderPropertyMap } from "./integrations/maps.js";
import { googleCalendarShowingUrl } from "./integrations/calendar.js";
import { config } from "./config.js";

const app = document.querySelector("#app");
const store = createPropertyStore(seedProperties);
let activeFilter = "all";
let query = "";
let preferences = loadPreferences();
let refreshInFlight = false;
let pullStartY = null;
let pullDistance = 0;
registerConfiguredProviders();

function applySyncedEvidence() {
  for (const evidence of housingEvidence) {
    const hint = String(evidence.propertyHint || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const property = store.getAll().find(item => {
      const address = String(item.address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const label = String(item.label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return hint && ((address.length > 6 && (address.includes(hint) || hint.includes(address))) || (label.length > 6 && (label.includes(hint) || hint.includes(label))));
    });
    if (property) store.upsert(applyEvidence(property, evidence));
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

function propertyCard(property) {
  const saved = property.saved || property.status === PROPERTY_STATUS.SHORTLISTED;
  const score = rankProperty(property, preferences);
  const source = property.sourceUrl
    ? `<a class="source-link" href="${esc(property.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(property.source || "Listing")}</a>`
    : esc(property.source || "");
  return `<article class="property-card" data-id="${esc(property.id)}">
    <div class="property-card__top"><div>
      <p class="eyebrow">${esc(property.type)} · ${esc(property.status)}</p>
      <h2>${esc(property.label)}</h2>
      <p class="muted">${esc(property.address || "")}${source ? ` ${source}` : ""}</p>
    </div><button class="save-button" data-action="save" aria-label="Save ${esc(property.label)}">${saved ? "★" : "☆"}</button></div>
    <div class="property-card__facts"><strong>${property.price ? "$"+property.price.toLocaleString()+(property.listingType==="rent"?"/mo":"") : "Price TBD"}</strong><span>${property.beds ?? "—"} bd</span><span>${property.baths ?? "—"} ba</span><span class="score">Fit ${score}</span></div>
    <div class="status-row">${followUpBadge(property)}${property.nearSchool ? '<span class="status-chip">Near school</span>' : ""}${property.kidFriendly ? '<span class="status-chip">Kid-friendly</span>' : ""}</div>
    <p class="note">${esc(property.note || "No visit notes yet.")}</p>
    <div class="property-card__actions">
      <button data-action="map">Map</button>
      <button data-action="visited">Visited</button>
      <button data-action="contact">Contacted</button>
      <button data-action="showing">Request showing</button>
      <button data-action="schedule">Schedule</button>
      <button data-action="note">Notes</button>
      <button data-action="reject">Not interested</button>
      <button data-action="archive">Archive</button>
    </div>
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

async function refreshListings(trigger = "manual") {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const buttons = document.querySelectorAll("[data-refresh-listings]");
  buttons.forEach(button => { button.disabled = true; button.textContent = "Refreshing…"; });
  document.querySelector("#pull-indicator")?.classList.add("refreshing");
  try {
    const found = await searchProviders({ ...preferences, location: preferences.location || config.search.location, radiusMiles: preferences.radiusMiles, query });
    store.upsertMany(found);
    recordActivity("provider-refresh", null, { count: found.length, trigger });
    const indicator = document.querySelector("#pull-indicator");
    if (indicator) indicator.textContent = found.length ? `Found ${found.length} listings` : "No new listings found";
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

function renderList() {
  const visible = visibleProperties();
  document.querySelector("#property-count").textContent = `${visible.length} shown · ${preferences.location || config.search.location} · ${preferences.radiusMiles || 15} mi`;
  document.querySelector("#property-list").innerHTML = visible.map(propertyCard).join("");
  const savedProperties = store.getAll().filter(p => p.saved && p.status !== PROPERTY_STATUS.ARCHIVED);
  document.querySelector("#map-summary").textContent = `${savedProperties.length} saved properties`;
  renderPropertyMap(document.querySelector("#property-map"), savedProperties);
  renderActivity();
}

app.innerHTML = `<main class="shell">
<header class="topbar"><div><p class="eyebrow">HOUSE HUNTING</p><h1>ROOK</h1></div><button id="settings-button" class="icon-button" aria-label="Settings">⚙</button></header>
<div id="pull-indicator" class="pull-indicator" aria-live="polite">Pull to refresh</div>
<section class="map-shell" aria-label="Property map and page scroll gutters"><div class="map-scroll-gutter map-scroll-gutter--left" aria-hidden="true"></div><div class="map-panel"><iframe id="property-map" class="property-map" loading="eager" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe><div class="map-caption"><strong>Map</strong><span id="map-summary">Saved properties</span></div></div><div class="map-scroll-gutter map-scroll-gutter--right" aria-hidden="true"></div></section>
<section class="results"><div class="section-heading"><h2>Properties</h2><span id="property-count"></span></div><div id="property-list"></div></section>
<section class="activity-panel"><div class="section-heading"><h2>Recent activity</h2></div><ul id="activity-list"></ul></section>

<button id="more-button" class="more-button" aria-label="Open Rook actions" aria-haspopup="dialog">•••</button>
<dialog id="actions-dialog" class="actions-dialog"><form method="dialog"><div class="dialog-heading"><div><p class="eyebrow">ROOK</p><h2>Actions</h2></div><button class="dialog-close" value="cancel" aria-label="Close">×</button></div>
<label for="property-search">Search properties</label><input id="property-search" type="search" placeholder="Address, neighborhood, property…">
<nav class="filters" aria-label="Property filters"><button type="button" class="active" data-filter="all">All</button><button type="button" data-filter="rent">Rent</button><button type="button" data-filter="buy">Buy</button><button type="button" data-filter="shortlist">Shortlist</button></nav>
<div class="action-menu"><button id="add-listing" type="button">＋ Add listing</button><button id="route-shortlist" type="button">Route shortlist</button><button type="button" data-refresh-listings>Refresh listings</button><button id="open-settings" type="button">Search preferences</button></div>
</form></dialog>

<dialog id="import-dialog"><form method="dialog"><h2>Add listing</h2><p class="muted">Paste a listing URL. Rook keeps the source and routes it through the shared property model.</p><input id="listing-url" type="url" placeholder="https://…" required /><div class="dialog-actions"><button value="cancel">Cancel</button><button id="import-confirm" value="default">Add</button></div></form></dialog>

<dialog id="settings-dialog"><form method="dialog"><h2>Search preferences</h2>
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
<input id="restore-data" type="file" accept="application/json,.json" hidden><div class="dialog-actions"><button id="restore-button" type="button">Restore backup</button><button id="export-data" type="button">Export backup</button><button value="cancel">Cancel</button><button id="save-settings" value="default">Save</button></div></form></dialog>
</main>`;

document.querySelector("#more-button").addEventListener("click", () => document.querySelector("#actions-dialog").showModal());
document.querySelector("#property-search").addEventListener("input", e => { query = e.target.value; renderList(); });

document.querySelector(".filters").addEventListener("click", e => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  activeFilter = b.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(el => el.classList.toggle("active", el === b));
  renderList();
});

document.querySelector("#property-list").addEventListener("click", e => {
  const sourceLink = e.target.closest(".source-link");
  if (sourceLink) {
    const sourceCard = e.target.closest("[data-id]");
    const sourceProperty = sourceCard && store.getAll().find(x => x.id === sourceCard.dataset.id);
    if (sourceProperty?.status === PROPERTY_STATUS.NEW) {
      store.update(sourceProperty.id, { status: PROPERTY_STATUS.VIEWED });
      recordActivity("viewed", sourceProperty);
    }
    return;
  }
  const action = e.target.closest("[data-action]")?.dataset.action;
  const card = e.target.closest("[data-id]");
  if (!action || !card) return;
  const p = store.getAll().find(x => x.id === card.dataset.id);
  if (!p) return;

  if (action === "save") {
    store.toggleSaved(p.id);
    recordActivity(p.saved ? "removed-shortlist" : "saved", p);
  }
  if (action === "map") {
    recordActivity("opened-map", p);
    openDirections(p);
  }
  if (action === "visited") {
    store.update(p.id, { status: PROPERTY_STATUS.VISITED });
    recordActivity("visited", p);
  }
  if (action === "contact") {
    store.update(p.id, { status: PROPERTY_STATUS.CONTACTED, contactedAt: new Date().toISOString() });
    recordActivity("contacted", p);
  }
  if (action === "showing") {
    store.upsert(markShowingRequested(p));
    recordActivity("showing-requested", p);
  }
  if (action === "note") {
    const note = window.prompt("Property notes", p.note || "");
    if (note !== null) {
      store.update(p.id, { note });
      recordActivity("note-updated", p);
    }
  }
  if (action === "reject") {
    store.update(p.id, { status: PROPERTY_STATUS.REJECTED, saved: false });
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
    store.update(p.id, { status: PROPERTY_STATUS.ARCHIVED, saved: false });
    recordActivity("archived", p);
  }
  renderActivity();
});

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
  preferences = {
    ...preferences,
    location: document.querySelector("#pref-location").value.trim() || config.search.location,
    radiusMiles: Math.max(1, Number(document.querySelector("#pref-radius").value) || 15),
    minBeds: Number(document.querySelector("#pref-min-beds").value) || 0,
    maxPrice: Number(document.querySelector("#pref-max-price").value) || null,
    propertyTypes: selectedTypes,
    excludeIncomeRestricted: document.querySelector("#pref-exclude-income").checked,
    excludeMobileHomes: document.querySelector("#pref-exclude-mobile").checked,
    kidFriendlyPriority: document.querySelector("#pref-kid-friendly").checked,
    schoolPriority: document.querySelector("#pref-school").checked
  };
  savePreferences(preferences);
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

store.subscribe(renderList);
renderList();
