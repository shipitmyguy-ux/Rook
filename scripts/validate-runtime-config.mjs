import { readFile } from "node:fs/promises";

async function json(name) {
  return JSON.parse(await readFile(new URL("../config/" + name, import.meta.url), "utf8"));
}
function ok(condition, message) {
  if (!condition) throw new Error(message);
}
function unique(rows, key, label) {
  const values=rows.map(row=>String(row?.[key]||"")).filter(Boolean);
  ok(values.length===new Set(values).size, "Duplicate "+label+" "+key);
}
function httpsUrl(value, label) {
  ok(typeof value==="string" && value.startsWith("https://"), label+" must be an https URL");
}
function compile(pattern, label) {
  if (!pattern) return;
  try { new RegExp(pattern,"i"); } catch { throw new Error("Invalid regex in "+label); }
}

const providers=await json("providers.json");
ok(Array.isArray(providers.providers)&&providers.providers.length>0,"providers.json requires providers");
unique(providers.providers,"id","provider");
for(const provider of providers.providers){
  ok(provider.id&&provider.label,"Provider needs id and label");
  httpsUrl(provider.cityFeed,"Provider "+provider.id+" cityFeed");
  for(const feed of provider.primaryCategoryFeeds||[]) httpsUrl(feed.url,"Provider "+provider.id+" category feed");
  if(provider.recoveryCityFeed) httpsUrl(provider.recoveryCityFeed,"Provider "+provider.id+" recoveryCityFeed");
  if(provider.verificationFeed) httpsUrl(provider.verificationFeed,"Provider "+provider.id+" verificationFeed");
  if(provider.zipFeed) httpsUrl(provider.zipFeed.replace("{zip}","80524"),"Provider "+provider.id+" zipFeed");
}

const areas=await json("search-areas.json");
ok(areas.defaultLocation,"search-areas.json requires defaultLocation");
ok(Array.isArray(areas.areas)&&areas.areas.length>0,"search-areas.json requires areas");
unique(areas.areas,"id","search area");
for(const area of areas.areas){
  ok(Array.isArray(area.aliases)&&area.aliases.length,"Search area "+area.id+" needs aliases");
  ok(Number.isFinite(Number(area.center?.lat))&&Number.isFinite(Number(area.center?.lng)),"Search area "+area.id+" needs center");
  for(const place of area.discoveryPlaces||[]){
    ok(place.city&&place.state,"Discovery place needs city/state");
    ok(Number.isFinite(Number(place.lat))&&Number.isFinite(Number(place.lng)),"Discovery place "+place.city+" needs coordinates");
  }
  for(const feed of area.extraIndexFeeds||[]) httpsUrl(feed.url,"Extra index "+feed.id);
}

const communities=await json("community-sources.json");
unique(communities.sources||[],"id","community source");
for(const source of communities.sources||[]){
  ok(source.baseAddressTemplate?.includes("{unit}"),"Community "+source.id+" needs {unit} address template");
  compile(source.parser?.splitRegex,source.id+" splitRegex");
  compile(source.parser?.unitRegex,source.id+" unitRegex");
  compile(source.parser?.priceRegex,source.id+" priceRegex");
  compile(source.parser?.availableRegex,source.id+" availableRegex");
  for(const plan of source.plans||[]) httpsUrl(plan.url,"Community "+source.id+" plan");
}

const exclusions=await json("exclusions.json");
unique(exclusions.listingRules||[],"id","exclusion");
for(const rule of exclusions.listingRules||[]){
  compile(rule.labelRegex,rule.id+" labelRegex");
  compile(rule.addressRegex,rule.id+" addressRegex");
}

const ui=await json("ui-defaults.json");
unique(ui.pointsOfInterest||[],"id","POI");
const properties=await json("properties.json");
unique(properties.properties||[],"id","property");
const evidence=await json("evidence.json");
unique(evidence.housingEvidence||[],"id","evidence");

console.log(JSON.stringify({
  providers:providers.providers.length,
  areas:areas.areas.length,
  communities:(communities.sources||[]).length,
  exclusions:(exclusions.listingRules||[]).length,
  properties:(properties.properties||[]).length,
  evidence:(evidence.housingEvidence||[]).length
}));
