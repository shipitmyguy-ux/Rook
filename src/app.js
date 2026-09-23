import { properties as seedProperties } from "./data/properties.js";
import { createPropertyStore } from "./core/store.js";
import { filterProperties, searchProperties, PROPERTY_STATUS } from "./core/property.js";
import { propertyFromUrl } from "./core/import.js";
import { googleMapsMultiStopUrl } from "./core/route.js";
import { openDirections } from "./integrations/maps.js";
import { createRookBackend } from "./integrations/backend.js";
import { syncGoogleActivity } from "./integrations/google.js";
import { config } from "./config.js";

const app = document.querySelector("#app");
const store = createPropertyStore(seedProperties);
const backend = createRookBackend(config);
let activeFilter = "all";
let query = "";

function propertyCard(property) {
  const saved = property.saved || property.status === PROPERTY_STATUS.SHORTLISTED;
  return `<article class="property-card" data-id="${property.id}">
    <div class="property-card__top"><div><p class="eyebrow">${property.type} · ${property.status}</p><h2>${property.label}</h2><p class="muted">${property.address || property.source || ""}</p></div><button class="save-button" data-action="save" aria-label="Save ${property.label}">${saved ? "★" : "☆"}</button></div>
    <div class="property-card__facts"><strong>${property.price ? "$" + property.price.toLocaleString() + (property.listingType === "rent" ? "/mo" : "") : "Price TBD"}</strong><span>${property.beds ?? "—"} bd</span><span>${property.baths ?? "—"} ba</span></div>
    <p class="note">${property.note || "No visit notes yet."}</p><div class="property-card__actions"><button data-action="map">Map</button><button data-action="visited">Visited</button><button data-action="contact">Contact</button></div>
  </article>`;
}
function visibleProperties() { return searchProperties(filterProperties(store.getAll(), activeFilter), query); }
function renderList() { const visible = visibleProperties(); document.querySelector("#property-count").textContent = `${visible.length} shown`; document.querySelector("#property-list").innerHTML = visible.map(propertyCard).join(""); }
function setSyncStatus(message) { document.querySelector("#sync-status").textContent = message; }

app.innerHTML = `<main class="shell">
<header class="topbar"><div><p class="eyebrow">HOUSE HUNTING</p><h1>ROOK</h1></div><button id="settings" class="icon-button" aria-label="Settings">⚙</button></header>
<section class="search-panel"><label for="property-search">Search properties</label><div class="search-row"><input id="property-search" type="search" placeholder="Address, neighborhood, property…" /><button id="refresh">Refresh</button></div>
<nav class="filters" aria-label="Property filters"><button class="active" data-filter="all">All</button><button data-filter="rent">Rent</button><button data-filter="buy">Buy</button><button data-filter="shortlist">Shortlist</button></nav>
<div class="quick-actions"><button id="add-listing">＋ Add listing</button><button id="route-shortlist">Route shortlist</button></div></section>
<section class="map-placeholder" aria-label="Map"><div><strong>Map</strong><span>Property map and terrain layer</span></div></section>
<section class="results"><div class="section-heading"><h2>Properties</h2><span id="property-count"></span></div><div id="property-list"></div></section>
<dialog id="import-dialog"><form method="dialog"><h2>Add listing</h2><p class="muted">Paste a listing URL. Rook keeps the source and routes it through the shared property model.</p><input id="listing-url" type="url" placeholder="https://…" required /><div class="dialog-actions"><button value="cancel">Cancel</button><button id="import-confirm" value="default">Add</button></div></form></dialog>
<dialog id="settings-dialog"><form method="dialog"><h2>Connections</h2><p id="sync-status" class="muted">${backend ? "Sign in to keep Rook synced and detect showing activity." : "Rook is using local storage. Add public Supabase settings to enable syncing."}</p><div class="dialog-actions"><button id="google-connect" type="button">${backend ? "Connect Google" : "Backend not configured"}</button><button id="google-sync" type="button" ${backend ? "" : "disabled"}>Sync Gmail & Calendar</button><button value="cancel">Close</button></div></form></dialog>
</main>`;

document.querySelector("#property-search").addEventListener("input", event => { query = event.target.value; renderList(); });
document.querySelector(".filters").addEventListener("click", event => { const button = event.target.closest("[data-filter]"); if (!button) return; activeFilter = button.dataset.filter; document.querySelectorAll("[data-filter]").forEach(item => item.classList.toggle("active", item === button)); renderList(); });
document.querySelector("#property-list").addEventListener("click", event => { const action = event.target.closest("[data-action]")?.dataset.action; const card = event.target.closest("[data-id]"); if (!action || !card) return; const property = store.getAll().find(item => item.id === card.dataset.id); if (!property) return; if (action === "save") store.toggleSaved(property.id); if (action === "map") openDirections(property); if (action === "visited") store.update(property.id, { status: PROPERTY_STATUS.VISITED }); if (action === "contact") store.update(property.id, { status: PROPERTY_STATUS.CONTACTED, contactedAt: new Date().toISOString() }); });
document.querySelector("#add-listing").addEventListener("click", () => document.querySelector("#import-dialog").showModal());
document.querySelector("#import-confirm").addEventListener("click", event => { const input = document.querySelector("#listing-url"); if (!input.checkValidity()) return; event.preventDefault(); try { store.upsert(propertyFromUrl(input.value)); input.value = ""; document.querySelector("#import-dialog").close(); } catch { input.setCustomValidity("Enter a valid listing URL"); input.reportValidity(); } });
document.querySelector("#listing-url").addEventListener("input", event => event.target.setCustomValidity(""));
document.querySelector("#route-shortlist").addEventListener("click", () => { const url = googleMapsMultiStopUrl(store.getAll().filter(property => property.saved)); if (url) window.open(url, "_blank", "noopener,noreferrer"); });
document.querySelector("#refresh").addEventListener("click", renderList);
document.querySelector("#settings").addEventListener("click", () => document.querySelector("#settings-dialog").showModal());
document.querySelector("#google-connect").addEventListener("click", async () => { if (!backend) return; try { await backend.signInWithGoogle(); } catch (error) { setSyncStatus(error.message); } });
document.querySelector("#google-sync").addEventListener("click", async () => { if (!backend) return; try { setSyncStatus("Syncing Gmail and Calendar…"); const events = await syncGoogleActivity({ token: backend.getGoogleAccessToken(), properties: store.getAll(), storeExternalEvents: events => backend.saveExternalEvents(events) }); for (const event of events) store.update(event.property_id, event.kind === "showing" ? { status: PROPERTY_STATUS.SHOWING_SCHEDULED, showingAt: event.occurred_at } : { status: PROPERTY_STATUS.CONTACTED, contactedAt: event.occurred_at }); setSyncStatus(`Synced ${events.length} property activities.`); } catch (error) { setSyncStatus(error.message); } });
store.subscribe(renderList); renderList();
if (backend) backend.connect().then(async user => { if (!user) return; const remote = await backend.loadProperties(); store.hydrate(remote); store.setRemotePersistence(properties => backend.saveProperties(properties)); setSyncStatus("Rook is synced to " + user.email + "."); }).catch(() => {});
