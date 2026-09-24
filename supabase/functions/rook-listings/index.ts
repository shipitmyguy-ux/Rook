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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  const url = new URL(req.url);
  const location = url.searchParams.get("location") || "Fort Collins, CO";
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
