import { properties as seedProperties } from "./data/properties.js";
import { createPropertyStore } from "./core/store.js";
import { filterProperties, searchProperties, PROPERTY_STATUS } from "./core/property.js";
import { openDirections } from "./integrations/maps.js";

const app = document.querySelector("#app");
const store = createPropertyStore(seedProperties);
let activeFilter = "all";
let query = "";

function propertyCard(property) {
  const saved = property.saved || property.status === PROPERTY_STATUS.SHORTLISTED;
  return `
    <article class="property-card" data-id="${property.id}">
      <div class="property-card__top">
        <div>
          <p class="eyebrow">${property.type} · ${property.status}</p>
          <h2>${property.label}</h2>
          <p class="muted">${property.address}</p>
        </div>
        <button class="save-button" data-action="save" aria-label="Save ${property.label}">${saved ? "★" : "☆"}</button>
      </div>
      <div class="property-card__facts">
        <strong>${property.price ? "$" + property.price.toLocaleString() + (property.listingType === "rent" ? "/mo" : "") : "Price TBD"}</strong>
        <span>${property.beds ?? "—"} bd</span>
        <span>${property.baths ?? "—"} ba</span>
      </div>
      <p class="note">${property.note || "No visit notes yet."}</p>
      <div class="property-card__actions">
        <button data-action="map">Map</button>
        <button data-action="visited">Visited</button>
        <button data-action="contact">Contact</button>
      </div>
    </article>`;
}

function visibleProperties() {
  return searchProperties(filterProperties(store.getAll(), activeFilter), query);
}

function renderList() {
  const visible = visibleProperties();
  document.querySelector("#property-count").textContent = `${visible.length} shown`;
  document.querySelector("#property-list").innerHTML = visible.map(propertyCard).join("");
}

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div><p class="eyebrow">HOUSE HUNTING</p><h1>ROOK</h1></div>
      <button class="icon-button" aria-label="Settings">⚙</button>
    </header>
    <section class="search-panel">
      <label for="property-search">Search properties</label>
      <div class="search-row">
        <input id="property-search" type="search" placeholder="Address, neighborhood, property…" />
        <button id="refresh">Refresh</button>
      </div>
      <nav class="filters" aria-label="Property filters">
        <button class="active" data-filter="all">All</button>
        <button data-filter="rent">Rent</button>
        <button data-filter="buy">Buy</button>
        <button data-filter="shortlist">Shortlist</button>
      </nav>
    </section>
    <section class="map-placeholder" aria-label="Map">
      <div><strong>Map</strong><span>Property map and terrain layer</span></div>
    </section>
    <section class="results">
      <div class="section-heading"><h2>Properties</h2><span id="property-count"></span></div>
      <div id="property-list"></div>
    </section>
  </main>`;

document.querySelector("#property-search").addEventListener("input", event => {
  query = event.target.value;
  renderList();
});

document.querySelector(".filters").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  activeFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(el => el.classList.toggle("active", el === button));
  renderList();
});

document.querySelector("#property-list").addEventListener("click", event => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  const card = event.target.closest("[data-id]");
  if (!action || !card) return;
  const property = store.getAll().find(p => p.id === card.dataset.id);
  if (!property) return;
  if (action === "save") store.toggleSaved(property.id);
  if (action === "map") openDirections(property);
  if (action === "visited") store.update(property.id, { status: PROPERTY_STATUS.VISITED });
  if (action === "contact") store.update(property.id, { status: PROPERTY_STATUS.CONTACTED, contactedAt: new Date().toISOString() });
});

document.querySelector("#refresh").addEventListener("click", renderList);
store.subscribe(renderList);
renderList();
