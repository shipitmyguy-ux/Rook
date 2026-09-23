import { properties as seedProperties } from "./data/properties.js";
import { createPropertyStore } from "./core/store.js";
import { filterProperties, searchProperties, PROPERTY_STATUS } from "./core/property.js";
import { propertyFromUrl } from "./core/import.js";
import { googleMapsMultiStopUrl } from "./core/route.js";
import { openDirections } from "./integrations/maps.js";

const app = document.querySelector("#app");
const store = createPropertyStore(seedProperties);
let activeFilter = "all";
let query = "";

function propertyCard(property) {
  const saved = property.saved || property.status === PROPERTY_STATUS.SHORTLISTED;
  return `<article class="property-card" data-id="${property.id}">
    <div class="property-card__top"><div>
      <p class="eyebrow">${property.type} · ${property.status}</p>
      <h2>${property.label}</h2><p class="muted">${property.address || property.source || ""}</p>
    </div><button class="save-button" data-action="save" aria-label="Save ${property.label}">${saved ? "★" : "☆"}</button></div>
    <div class="property-card__facts"><strong>${property.price ? "$"+property.price.toLocaleString()+(property.listingType==="rent"?"/mo":"") : "Price TBD"}</strong><span>${property.beds ?? "—"} bd</span><span>${property.baths ?? "—"} ba</span></div>
    <p class="note">${property.note || "No visit notes yet."}</p>
    <div class="property-card__actions"><button data-action="map">Map</button><button data-action="visited">Visited</button><button data-action="contact">Contact</button></div>
  </article>`;
}
function visibleProperties(){return searchProperties(filterProperties(store.getAll(),activeFilter),query);}
function renderList(){const visible=visibleProperties();document.querySelector("#property-count").textContent=`${visible.length} shown`;document.querySelector("#property-list").innerHTML=visible.map(propertyCard).join("");}

app.innerHTML=`<main class="shell">
<header class="topbar"><div><p class="eyebrow">HOUSE HUNTING</p><h1>ROOK</h1></div><button class="icon-button" aria-label="Settings">⚙</button></header>
<section class="search-panel"><label for="property-search">Search properties</label><div class="search-row"><input id="property-search" type="search" placeholder="Address, neighborhood, property…" /><button id="refresh">Refresh</button></div>
<nav class="filters" aria-label="Property filters"><button class="active" data-filter="all">All</button><button data-filter="rent">Rent</button><button data-filter="buy">Buy</button><button data-filter="shortlist">Shortlist</button></nav>
<div class="quick-actions"><button id="add-listing">＋ Add listing</button><button id="route-shortlist">Route shortlist</button></div></section>
<section class="map-placeholder" aria-label="Map"><div><strong>Map</strong><span>Property map and terrain layer</span></div></section>
<section class="results"><div class="section-heading"><h2>Properties</h2><span id="property-count"></span></div><div id="property-list"></div></section>
<dialog id="import-dialog"><form method="dialog"><h2>Add listing</h2><p class="muted">Paste a listing URL. Rook keeps the source and routes it through the shared property model.</p><input id="listing-url" type="url" placeholder="https://…" required /><div class="dialog-actions"><button value="cancel">Cancel</button><button id="import-confirm" value="default">Add</button></div></form></dialog>
</main>`;

document.querySelector("#property-search").addEventListener("input",e=>{query=e.target.value;renderList();});
document.querySelector(".filters").addEventListener("click",e=>{const b=e.target.closest("[data-filter]");if(!b)return;activeFilter=b.dataset.filter;document.querySelectorAll("[data-filter]").forEach(el=>el.classList.toggle("active",el===b));renderList();});
document.querySelector("#property-list").addEventListener("click",e=>{const action=e.target.closest("[data-action]")?.dataset.action;const card=e.target.closest("[data-id]");if(!action||!card)return;const p=store.getAll().find(x=>x.id===card.dataset.id);if(!p)return;if(action==="save")store.toggleSaved(p.id);if(action==="map")openDirections(p);if(action==="visited")store.update(p.id,{status:PROPERTY_STATUS.VISITED});if(action==="contact")store.update(p.id,{status:PROPERTY_STATUS.CONTACTED,contactedAt:new Date().toISOString()});});
document.querySelector("#add-listing").addEventListener("click",()=>document.querySelector("#import-dialog").showModal());
document.querySelector("#import-confirm").addEventListener("click",e=>{const input=document.querySelector("#listing-url");if(!input.checkValidity())return;e.preventDefault();try{store.upsert(propertyFromUrl(input.value));input.value="";document.querySelector("#import-dialog").close();}catch{input.setCustomValidity("Enter a valid listing URL");input.reportValidity();}});
document.querySelector("#listing-url").addEventListener("input",e=>e.target.setCustomValidity(""));
document.querySelector("#route-shortlist").addEventListener("click",()=>{const url=googleMapsMultiStopUrl(store.getAll().filter(p=>p.saved));if(url)window.open(url,"_blank","noopener,noreferrer");});
document.querySelector("#refresh").addEventListener("click",renderList);store.subscribe(renderList);renderList();
