const corsHeaders = {
  "Access-Control-Allow-Origin": "https://shipitmyguy-ux.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

type Listing = Record<string, any>;
type AdapterResult = { id: string; listings: Listing[]; error?: string };

const num = (value: unknown) => {
  const match = String(value ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const absolute = (href: string | null | undefined, base: string) => {
  if (!href) return null;
  try { return new URL(href, base).toString(); } catch { return null; }
};


function imageUrl(value: any, base: string): string | null {
  const queue = Array.isArray(value) ? [...value] : [value];
  while (queue.length) {
    const item = queue.shift();
    if (!item) continue;
    if (Array.isArray(item)) { queue.push(...item); continue; }
    if (typeof item === "object") {
      queue.push(item.url, item.src, item.contentUrl, item["@id"], item.thumbnailUrl, item.image);
      continue;
    }
    if (typeof item !== "string") continue;
    const candidate = absolute(item, base);
    if (candidate) return candidate;
  }
  return null;
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; Rook/1.0; property-search)"
      }
    });
    if (!response.ok) throw new Error(String(response.status));
    return await response.text();
  } finally { clearTimeout(timeout); }
}

function jsonLdListings(html: string, source: string, pageUrl: string): Listing[] {
  const rows: Listing[] = [];
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1].trim());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
        if (Array.isArray(item.itemListElement)) {
          for (const entry of item.itemListElement) queue.push(entry.item || entry);
        }
        const addressObj = item.address || item.location?.address;
        const address = typeof addressObj === "string" ? addressObj :
          [addressObj?.streetAddress, addressObj?.addressLocality, addressObj?.addressRegion, addressObj?.postalCode].filter(Boolean).join(", ");
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        const price = num(offer?.price ?? item.price);
        const beds = num(item.numberOfBedrooms ?? item.numberOfRooms);
        const baths = num(item.numberOfBathroomsTotal ?? item.numberOfBathrooms);
        const url = absolute(item.url || offer?.url, pageUrl);
        const image = imageUrl(item.image || item.photo || item.thumbnailUrl || item.primaryImageOfPage || item.subjectOf?.image, url || pageUrl);
        if (address && (price || beds || url)) rows.push({
          id: item["@id"] || url || address,
          label: item.name || address,
          address,
          type: item["@type"] || "Property",
          listingType: "rent",
          price, beds, baths,
          lat: num(item.geo?.latitude),
          lng: num(item.geo?.longitude),
          source,
          sourceUrl: url,
          image,
          imageUrl: image,
          primaryImageUrl: image,
          metadata: { description: item.description || null, image }
        });
      }
    } catch { /* malformed structured data from source */ }
  }
  return rows;
}

async function sourceAdapter(id: string, source: string, url: string): Promise<AdapterResult> {
  try {
    const html = await fetchText(url);
    return { id, listings: jsonLdListings(html, source, url) };
  } catch (error) {
    return { id, listings: [], error: error instanceof Error ? error.message : "source failed" };
  }
}

function keyOf(row: Listing) {
  const address = String(row.address || "").toLowerCase().replace(/\b(street)\b/g,"st").replace(/\b(avenue)\b/g,"ave")
    .replace(/\b(road)\b/g,"rd").replace(/\b(drive)\b/g,"dr").replace(/[^a-z0-9]/g,"");
  return address || row.sourceUrl || row.id;
}


function canonicalAddress(value: unknown) {
  return String(value || "").toLowerCase()
    .replace(/\b(street)\b/g,"st").replace(/\b(avenue)\b/g,"ave").replace(/\b(road)\b/g,"rd")
    .replace(/\b(drive)\b/g,"dr").replace(/\b(lane)\b/g,"ln").replace(/\b(court)\b/g,"ct")
    .replace(/\b(boulevard)\b/g,"blvd").replace(/[^a-z0-9]/g,"");
}

function sameAddress(a: unknown, b: unknown) {
  const left = canonicalAddress(a), right = canonicalAddress(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function primaryStatusText(html: string) {
  const parts:string[] = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const description = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description|og:title)["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description|og:title)["'][^>]*>/i)?.[1];
  for (const value of [title,h1,description]) if (value) parts.push(value.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());

  const statusFields = [...html.matchAll(/"(?:homeStatus|listingStatus|availability|status)"\s*:\s*"([^"]+)"/gi)]
    .map(match => match[1]).slice(0,20);
  parts.push(...statusFields);
  return parts.join(" | ");
}

function closedStatusReason(html: string) {
  const primary = primaryStatusText(html);
  const strong = primary.match(/\b(off[- ]?market|no longer available|listing removed|listing is no longer available|currently unavailable|rented|leased|sold|out of stock|discontinued)\b/i);
  return strong ? strong[1].toLowerCase() : null;
}

async function inspectListingUrl(url: string) {
  try {
    const html = await fetchText(url);
    const reason = closedStatusReason(html);
    return { reachable: true, closed: Boolean(reason), reason, html };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const closed = /^(404|410)$/.test(message);
    return { reachable: false, closed, reason: closed ? "http-404-410" : null, html: "" };
  }
}

async function resolveListing(address: string, label: string, location: string, sourceUrl = "") {
  const checkedAt = new Date().toISOString();
  const citySlug = location.toLowerCase().replace(/,.*$/, "").trim().replace(/[^a-z0-9]+/g, "-");
  const sourcePages = [
    { id:"realtor", source:"Realtor.com", url:`https://www.realtor.com/apartments/${citySlug}_CO` },
    { id:"rent", source:"Rent.com", url:`https://www.rent.com/colorado/${citySlug}-apartments` },
    { id:"apartmentlist", source:"Apartment List", url:`https://www.apartmentlist.com/co/${citySlug}` }
  ];

  if (sourceUrl) {
    try {
      const direct = new URL(sourceUrl);
      const inspected = await inspectListingUrl(direct.toString());
      if (inspected.reachable && !inspected.closed) {
        const rows = jsonLdListings(inspected.html, direct.hostname, direct.toString());
        const match = rows.find(row =>
          (address && sameAddress(row.address, address)) ||
          (!address && canonicalAddress(row.label) === canonicalAddress(label))
        ) || rows[0];
        if (match) {
          return {
            state:"active",
            listing:{ ...match, sourceUrl:direct.toString() },
            checkedAt,
            checkedSources:1
          };
        }
      }
      if (inspected.closed) {
        return {
          state:"closed",
          listing:null,
          checkedAt,
          checkedSources:1,
          evidence:{ confirmed:true, kind:"direct-listing-status", matches:[{ source:direct.hostname, url:direct.toString(), reason:inspected.reason || "direct-status" }] }
        };
      }
    } catch {}
  }

  let successfulSources = 0;
  const closedEvidence:any[] = [];
  for (const sourcePage of sourcePages) {
    try {
      const html = await fetchText(sourcePage.url);
      successfulSources += 1;
      const rows = jsonLdListings(html, sourcePage.source, sourcePage.url);
      const match = rows.find(row => sameAddress(row.address, address) || (!address && canonicalAddress(row.label) === canonicalAddress(label)));
      if (match?.sourceUrl) {
        const inspected = await inspectListingUrl(match.sourceUrl);
        if (inspected.reachable && !inspected.closed) {
          return { state:"active", listing:match, checkedAt, checkedSources:successfulSources };
        }
        if (inspected.closed) {
          closedEvidence.push({ source:sourcePage.source, url:match.sourceUrl, reason:inspected.reason || "direct-status" });
        }
      }
    } catch {}
  }

  // Search-engine HTML is discovery only. A result must resolve to a supported
  // portal, match the exact address, and then be inspected directly.
  try {
    const query = [address || label, location, "rental listing"].filter(Boolean).join(" ");
    const searchHtml = await fetchText("https://www.google.com/search?q=" + encodeURIComponent(query));
    const hrefs = [...searchHtml.matchAll(/href="\/url\?q=([^&"]+)/g)].map(match => {
      try { return decodeURIComponent(match[1]); } catch { return ""; }
    });
    const allowedHosts = /(realtor\.com|rent\.com|apartmentlist\.com|zillow\.com|trulia\.com|apartments\.com)$/i;
    for (const href of hrefs) {
      try {
        const candidate = new URL(href);
        if (!allowedHosts.test(candidate.hostname.replace(/^www\./,""))) continue;
        const inspected = await inspectListingUrl(candidate.toString());
        if (!inspected.reachable && !inspected.closed) continue;
        const rows = inspected.html ? jsonLdListings(inspected.html, candidate.hostname, candidate.toString()) : [];
        const match = rows.find(row => sameAddress(row.address, address) || (!address && canonicalAddress(row.label) === canonicalAddress(label)));
        if (match && inspected.reachable && !inspected.closed) {
          return { state:"active", listing:{ ...match, sourceUrl:candidate.toString() }, checkedAt, checkedSources:successfulSources };
        }
        if (match && inspected.closed) {
          closedEvidence.push({ source:candidate.hostname, url:candidate.toString(), reason:inspected.reason || "direct-status" });
        }
      } catch {}
    }
  } catch {}

  // Absence from search/index pages is never closure evidence. Only an exact
  // property page with a direct unavailable/off-market signal may mark closed.
  if (closedEvidence.length) {
    return {
      state:"closed",
      listing:null,
      checkedAt,
      checkedSources:successfulSources,
      evidence:{ confirmed:true, kind:"direct-listing-status", matches:closedEvidence }
    };
  }
  return { state:"unknown", listing:null, checkedAt, checkedSources:successfulSources, evidence:null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  const url = new URL(req.url);
  const location = url.searchParams.get("location") || "Fort Collins, CO";
  if (url.searchParams.get("resolve") === "1") {
    const address = (url.searchParams.get("address") || "").trim();
    const label = (url.searchParams.get("label") || "").trim();
    const sourceUrl = (url.searchParams.get("sourceUrl") || "").trim();
    if (!address && !label && !sourceUrl) return new Response(JSON.stringify({ state:"unknown", listing:null, checkedAt:new Date().toISOString(), error:"address, label, or sourceUrl required" }), { status:400, headers:corsHeaders });
    const result = await resolveListing(address, label, location, sourceUrl);
    return new Response(JSON.stringify(result), { headers:corsHeaders });
  }
  const minBeds = Number(url.searchParams.get("minBeds") || "2");
  const maxPrice = Number(url.searchParams.get("maxPrice") || "0");
  const query = (url.searchParams.get("query") || "").trim().toLowerCase();
  const slug = location.toLowerCase().replace(/,.*$/, "").trim().replace(/[^a-z0-9]+/g, "-");

  // Reuse public structured listing data exposed by source search pages. Each source
  // is isolated so a portal change cannot break the complete Rook refresh.
  const adapters = await Promise.all([
    sourceAdapter("realtor", "Realtor.com", `https://www.realtor.com/apartments/${slug}_CO`),
    sourceAdapter("rent", "Rent.com", `https://www.rent.com/colorado/${slug}-apartments`),
    sourceAdapter("apartmentlist", "Apartment List", `https://www.apartmentlist.com/co/${slug}`)
  ]);

  const merged = new Map<string, Listing>();
  for (const adapter of adapters) for (const listing of adapter.listings) {
    const key = keyOf(listing);
    if (!key) continue;
    const prior = merged.get(key);
    merged.set(key, prior ? {
      ...prior, ...Object.fromEntries(Object.entries(listing).filter(([,v]) => v !== null && v !== "")),
      sourceUrl: prior.sourceUrl || listing.sourceUrl,
      metadata: { ...prior.metadata, ...listing.metadata, sources: [...new Set([...(prior.metadata?.sources || [prior.source]), listing.source].filter(Boolean))] }
    } : { ...listing, metadata: { ...listing.metadata, sources: [listing.source] } });
  }

  const listings = [...merged.values()].filter((listing) => {
    const beds = Number(listing.beds ?? 0);
    const price = Number(listing.price ?? 0);
    const text = [listing.label, listing.address, listing.type, listing.metadata?.description].filter(Boolean).join(" ").toLowerCase();
    if (minBeds && beds && beds < minBeds) return false;
    if (maxPrice && price && price > maxPrice) return false;
    if (/(income[- ]restricted|income limits?|affordable housing|section 8|mobile home|manufactured home|trailer park)/i.test(text)) return false;
    if (query && !text.includes(query)) return false;
    return true;
  });

  return new Response(JSON.stringify({
    listings,
    meta: {
      location, count: listings.length, generatedAt: new Date().toISOString(),
      adapters: adapters.map(a => ({ id: a.id, count: a.listings.length, ok: !a.error, error: a.error || null }))
    }
  }), { headers: corsHeaders });
});
