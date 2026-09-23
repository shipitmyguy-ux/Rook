import { properties } from "./data/properties.js";

const app = document.querySelector("#app");

function propertyCard(property) {
  return `
    <article class="property-card" data-id="${property.id}">
      <div class="property-card__top">
        <div>
          <p class="eyebrow">${property.type}</p>
          <h2>${property.label}</h2>
          <p class="muted">${property.address}</p>
        </div>
        <button class="save-button" aria-label="Save ${property.label}">☆</button>
      </div>
      <div class="property-card__facts">
        <strong>${property.price ? "$" + property.price.toLocaleString() + "/mo" : "Price TBD"}</strong>
        <span>${property.beds ?? "—"} bd</span>
        <span>${property.baths ?? "—"} ba</span>
      </div>
      <p class="note">${property.note || "No visit notes yet."}</p>
      <div class="property-card__actions">
        <button>Map</button>
        <button>Details</button>
        <button>Contact</button>
      </div>
    </article>`;
}

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">HOUSE HUNTING</p>
        <h1>ROOK</h1>
      </div>
      <button class="icon-button" aria-label="Settings">⚙</button>
    </header>

    <section class="search-panel">
      <label for="property-search">Search properties</label>
      <div class="search-row">
        <input id="property-search" type="search" placeholder="Address, neighborhood, property…" />
        <button id="refresh">Refresh</button>
      </div>
      <nav class="filters" aria-label="Property filters">
        <button class="active">All</button>
        <button>Rent</button>
        <button>Buy</button>
        <button>Shortlist</button>
      </nav>
    </section>

    <section class="map-placeholder" aria-label="Map">
      <div>
        <strong>Map</strong>
        <span>Google Maps layer plugs in here</span>
      </div>
    </section>

    <section class="results">
      <div class="section-heading">
        <h2>Properties</h2>
        <span>${properties.length} loaded</span>
      </div>
      <div id="property-list">${properties.map(propertyCard).join("")}</div>
    </section>
  </main>`;

const input = document.querySelector("#property-search");
input.addEventListener("input", () => {
  const query = input.value.trim().toLowerCase();
  const filtered = properties.filter(p =>
    [p.label, p.address, p.type, p.note].filter(Boolean).some(v => v.toLowerCase().includes(query))
  );
  document.querySelector("#property-list").innerHTML = filtered.map(propertyCard).join("");
});
