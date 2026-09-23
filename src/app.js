import { properties as seedProperties } from "./data/properties.js";
import { createPropertyStore } from "./core/store.js";
import { filterProperties, searchProperties, PROPERTY_STATUS } from "./core/property.js";
import { propertyFromUrl } from "./core/import.js";
import { googleMapsMultiStopUrl } from "./core/route.js";
import { loadPreferences, savePreferences } from "./core/preferences.js";
import { rankProperties, rankProperty } from "./core/ranking.js";
import { recordActivity, getActivity } from "./core/activity.js";
import { nextFollowUp, markShowingRequested } from "./core/followup.js";
import { exportRookData } from "./core/export.js";
import { searchProviders } from "./integrations/providers.js";
import { openDirections } from "./integrations/maps.js";
import { config } from "./config.js";

const app = document.querySelector("#app");
const store = createPropertyStore(seedProperties);
let activeFilter = "all";
let query = "";
let preferences = loadPreferences();

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

function renderList() {
  const visible = visibleProperties();
  document.querySelector("#property-count").textContent = `${visible.length} shown`;
  document.querySelector("#property-list").innerHTML = visible.map(propertyCard).join("");
  const saved = store.getAll().filter(p => p.saved && p.status !== PROPERTY_STATUS.ARCHIVED).length;
  document.querySelector("#map-summary").textContent = `${saved} saved properties ready to route`;
  renderActivity();
}

app.innerHTML = `<main class="shell">
<header class="topbar"><div><p class="eyebrow">HOUSE HUNTING</p><h1>ROOK</h1></div><button id="settings-button" class="icon-button" aria-label="Settings">⚙</button></header>
<section class="search-panel"><label for="property-search">Search properties</label><div class="search-row"><input id="property-search" type="search" placeholder="Address, neighborhood, property…" /><button id="refresh">Refresh</button></div>
<nav class="filters" aria-label="Property filters"><button class="active" data-filter="all">All</button><button data-filter="rent">Rent</button><button data-filter="buy">Buy</button><button data-filter="shortlist">Shortlist</button></nav>
<div class="quick-actions"><button id="add-listing">＋ Add listing</button><button id="route-shortlist">Route shortlist</button></div></section>
<section class="map-placeholder" aria-label="Map"><div><strong>Map</strong><span id="map-summary">Saved properties ready to route</span></div></section>
<section class="results"><div class="section-heading"><h2>Properties</h2><span id="property-count"></span></div><div id="property-list"></div></section>
<section class="activity-panel"><div class="section-heading"><h2>Recent activity</h2></div><ul id="activity-list"></ul></section>

<dialog id="import-dialog"><form method="dialog"><h2>Add listing</h2><p class="muted">Paste a listing URL. Rook keeps the source and routes it through the shared property model.</p><input id="listing-url" type="url" placeholder="https://…" required /><div class="dialog-actions"><button value="cancel">Cancel</button><button id="import-confirm" value="default">Add</button></div></form></dialog>

<dialog id="settings-dialog"><form method="dialog"><h2>Search preferences</h2>
<label>Minimum bedrooms<input id="pref-min-beds" type="number" min="0" step="1"></label>
<label>Maximum monthly rent<input id="pref-max-price" type="number" min="0" step="50"></label>
<label class="check-row"><input id="pref-kid-friendly" type="checkbox"> Prioritize kid-friendly areas</label>
<label class="check-row"><input id="pref-school" type="checkbox"> Prioritize nearby schools</label>
<div class="dialog-actions"><button id="export-data" type="button">Export backup</button><button value="cancel">Cancel</button><button id="save-settings" value="default">Save</button></div></form></dialog>
</main>`;

document.querySelector("#property-search").addEventListener("input", e => { query = e.target.value; renderList(); });

document.querySelector(".filters").addEventListener("click", e => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  activeFilter = b.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(el => el.classList.toggle("active", el === b));
  renderList();
});

document.querySelector("#property-list").addEventListener("click", e => {
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

document.querySelector("#refresh").addEventListener("click", async e => {
  const button = e.currentTarget;
  button.disabled = true;
  button.textContent = "Refreshing…";
  try {
    const found = await searchProviders({ ...preferences, query });
    store.upsertMany(found);
    if (found.length) recordActivity("provider-refresh", null, { count: found.length });
  } finally {
    button.disabled = false;
    button.textContent = "Refresh";
    renderList();
  }
});

document.querySelector("#settings-button").addEventListener("click", () => {
  document.querySelector("#pref-min-beds").value = preferences.minBeds ?? 2;
  document.querySelector("#pref-max-price").value = preferences.maxPrice ?? "";
  document.querySelector("#pref-kid-friendly").checked = Boolean(preferences.kidFriendlyPriority);
  document.querySelector("#pref-school").checked = Boolean(preferences.schoolPriority);
  document.querySelector("#settings-dialog").showModal();
});

document.querySelector("#save-settings").addEventListener("click", e => {
  e.preventDefault();
  preferences = {
    ...preferences,
    minBeds: Number(document.querySelector("#pref-min-beds").value) || 0,
    maxPrice: Number(document.querySelector("#pref-max-price").value) || null,
    kidFriendlyPriority: document.querySelector("#pref-kid-friendly").checked,
    schoolPriority: document.querySelector("#pref-school").checked
  };
  savePreferences(preferences);
  recordActivity("preferences-updated", null);
  document.querySelector("#settings-dialog").close();
  renderList();
});

document.querySelector("#export-data").addEventListener("click", () => {
  exportRookData(store.getAll(), preferences);
  recordActivity("backup-exported", null);
  renderActivity();
});

store.subscribe(renderList);
renderList();
