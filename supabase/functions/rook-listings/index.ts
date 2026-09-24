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

const PROJECT_URL = Deno.env.get("SUPABASE_URL") || "https://umvmilulnqnmeqvfoxxc.supabase.co";
const BROWSER_WORKER_URL = PROJECT_URL + "/functions/v1/rook-browser-worker";

async function browserWorker(body: Record<string, unknown>) {
  const response = await fetch(BROWSER_WORKER_URL, {
    method:"POST",
    headers:{ "content-type":"application/json", "x-rook-client":"rook-web-v1" },
    body:JSON.stringify(body)
  });
  const payload = await response.json().catch(()=>({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || "browser worker failed");
  return payload;
}

async function browserSnapshot(url: string) {
  let sessionId = "";
  try {
    const started = await browserWorker({ action:"start" });
    sessionId = String(started.sessionId || "");
    if (!sessionId) throw new Error("browser session unavailable");
    await browserWorker({ action:"open", sessionId, url });
    await browserWorker({ action:"wait", sessionId, ms:1600 });
    const snap = await browserWorker({ action:"snapshot", sessionId });
    return snap?.snapshot || null;
  } finally {
    if (sessionId) {
      try { await browserWorker({ action:"stop", sessionId }); } catch {}
    }
  }
}

function looksLikeBrowserChallenge(text: string) {
  return /performing security verification|verify you are not a bot|checking your browser|cloudflare|access denied|enable javascript and cookies|captcha|security service to protect against malicious bots/i.test(text);
}

function fallbackListingFromText(text: string, pageUrl: string, known: { address?: string; label?: string; source?: string } = {}) {
  const price = firstMatchNumber(text, [
    /\$([\d,]{3,})(?:\.\d+)?\s*(?:\/\s*mo|per\s*month|monthly)?/i,
    /(?:rent|price)[^\d$]{0,30}\$([\d,]{3,})/i
  ]);
  const beds = firstMatchNumber(text, [
    /([\d.]+)\s*(?:bed|beds|bedroom|bedrooms)\b/i
  ]);
  const baths = firstMatchNumber(text, [
    /([\d.]+)\s*(?:bath|baths|bathroom|bathrooms)\b/i
  ]);
  return {
    id:pageUrl || known.address || known.label,
    label:known.label || known.address || pageUrl,
    address:known.address || "",
    type:"Property",
    listingType:"rent",
    price, beds, baths,
    source:known.source || new URL(pageUrl).hostname,
    sourceUrl:pageUrl,
    metadata:{ enrichedFromBrowser:true }
  };
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

function firstMatchNumber(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = match?.[1] ?? match?.[0];
    if (!value) continue;
    const parsed = num(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function fallbackListingFromHtml(html: string, pageUrl: string, known: { address?: string; label?: string; source?: string } = {}) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim() || "";
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] || "";
  const metaDescription = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)?.[1] || "";

  const price = firstMatchNumber(html, [
    /"(?:price|rent|monthlyRent|listPrice)"\s*:\s*"?\$?([\d,]+(?:\.\d+)?)/i,
    /\$([\d,]{3,})(?:\s*\/\s*mo|\s*per\s*month|\s*monthly)/i,
    /(?:rent|price)[^\d$]{0,30}\$([\d,]{3,})/i
  ]);
  const beds = firstMatchNumber(html, [
    /"(?:beds|bedrooms|numberOfBedrooms)"\s*:\s*"?([\d.]+)/i,
    /([\d.]+)\s*(?:bed|beds|bedroom|bedrooms)\b/i
  ]);
  const baths = firstMatchNumber(html, [
    /"(?:baths|bathrooms|numberOfBathrooms|numberOfBathroomsTotal)"\s*:\s*"?([\d.]+)/i,
    /([\d.]+)\s*(?:bath|baths|bathroom|bathrooms)\b/i
  ]);
  const image = imageUrl(
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1],
    pageUrl
  );

  const address = known.address || "";
  const label = known.label || ogTitle || title || address;
  return {
    id: pageUrl || address || label,
    label,
    address,
    type: "Property",
    listingType: "rent",
    price, beds, baths,
    source: known.source || new URL(pageUrl).hostname,
    sourceUrl: pageUrl,
    image, imageUrl:image, primaryImageUrl:image,
    metadata: { description: metaDescription || null, image, enrichedFromPage:true }
  };
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

function stripHtml(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/\s+/g," ")
    .trim();
}

function searchSnippetContext(html: string, needles: string[]) {
  const lower = html.toLowerCase();
  for (const raw of needles) {
    const needle = String(raw || "").trim().toLowerCase();
    if (!needle || needle.length < 4) continue;
    const index = lower.indexOf(needle);
    if (index < 0) continue;
    return stripHtml(html.slice(Math.max(0,index-1200), Math.min(html.length,index+2600)));
  }
  return "";
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
        ) || rows[0] || fallbackListingFromHtml(inspected.html, direct.toString(), { address, label, source:direct.hostname });
        return {
          state:"active",
          listing:{ ...match, address:match.address || address, label:match.label || label || address, sourceUrl:direct.toString() },
          checkedAt,
          checkedSources:1
        };
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
      if (!inspected.reachable) {
        try {
          const snapshot = await browserSnapshot(direct.toString());
          const text = String(snapshot?.text || "");
          if (text && !looksLikeBrowserChallenge(text)) {
            const browserListing = fallbackListingFromText(text, direct.toString(), { address, label, source:direct.hostname });
            return {
              state:"active",
              listing:browserListing,
              checkedAt,
              checkedSources:1,
              browserFallback:true
            };
          }
        } catch {}
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

  // Search-engine HTML is discovery only. Try more than one engine because any
  // individual search endpoint can block automated requests or omit a live result.
  const query = [address || label, location, "rental listing"].filter(Boolean).join(" ");
  const searchUrls = [
    "https://www.google.com/search?q=" + encodeURIComponent(query),
    "https://www.bing.com/search?q=" + encodeURIComponent(query),
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query)
  ];
  const allowedHosts = /(realtor\.com|rent\.com|apartmentlist\.com|zillow\.com|trulia\.com|apartments\.com|rentcafe\.com)$/i;
  const seenCandidates = new Set<string>();
  for (const searchUrl of searchUrls) {
    try {
      const searchHtml = await fetchText(searchUrl);

      const knownHost = (() => { try { return sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./,"") : ""; } catch { return ""; } })();
      const snippet = searchSnippetContext(searchHtml, [address, label, knownHost]);
      if (snippet) {
        const snippetUrl = sourceUrl || "https://" + (knownHost || "example.com") + "/";
        const snippetListing = fallbackListingFromText(snippet, snippetUrl, { address, label, source:knownHost || "search-result" });
        if (snippetListing.price || snippetListing.beds || snippetListing.baths) {
          return {
            state:"active",
            listing:{ ...snippetListing, sourceUrl:sourceUrl || snippetListing.sourceUrl },
            checkedAt,
            checkedSources:successfulSources,
            searchSnippet:true
          };
        }
      }

      const hrefs = [
        ...[...searchHtml.matchAll(/href="\/url\?q=([^&"]+)/g)].map(match => {
          try { return decodeURIComponent(match[1]); } catch { return ""; }
        }),
        ...[...searchHtml.matchAll(/href=["'](https?:\/\/[^"'<> ]+)["']/g)].map(match => match[1]),
        ...[...searchHtml.matchAll(/uddg=([^&"']+)/g)].map(match => {
          try { return decodeURIComponent(match[1]); } catch { return ""; }
        })
      ];
      for (const href of hrefs) {
        try {
          const candidate = new URL(href);
          const hostname = candidate.hostname.replace(/^www\./,"");
          if (!allowedHosts.test(hostname)) continue;
          const normalizedCandidate = candidate.toString();
          if (seenCandidates.has(normalizedCandidate)) continue;
          seenCandidates.add(normalizedCandidate);

          const inspected = await inspectListingUrl(normalizedCandidate);
          if (!inspected.reachable && !inspected.closed) continue;
          const rows = inspected.html ? jsonLdListings(inspected.html, candidate.hostname, normalizedCandidate) : [];
          const match = rows.find(row => sameAddress(row.address, address) || (!address && canonicalAddress(row.label) === canonicalAddress(label)));
          if (inspected.reachable && !inspected.closed) {
            const resolved = match || fallbackListingFromHtml(inspected.html, normalizedCandidate, { address, label, source:candidate.hostname });
            const candidateAddressMatches = !address || !resolved.address || sameAddress(resolved.address, address);
            const candidateLabelMatches = !label || canonicalAddress(resolved.label).includes(canonicalAddress(label)) || canonicalAddress(label).includes(canonicalAddress(resolved.label));
            if (candidateAddressMatches && candidateLabelMatches) {
              return {
                state:"active",
                listing:{ ...resolved, address:resolved.address || address, label:resolved.label || label || address, sourceUrl:normalizedCandidate },
                checkedAt,
                checkedSources:successfulSources
              };
            }
          }
          if (match && inspected.closed) {
            closedEvidence.push({ source:candidate.hostname, url:normalizedCandidate, reason:inspected.reason || "direct-status" });
          }
        } catch {}
      }
    } catch {}
  }

  // If lightweight search endpoints are blocked or inconclusive, use Rook's real
  // browser worker once before exposing a manual Find listing fallback.
  try {
    const snapshot = await browserSnapshot("https://www.google.com/search?q=" + encodeURIComponent(query));
    const links = Array.isArray(snapshot?.links) ? snapshot.links : [];
    for (const link of links) {
      try {
        const candidate = new URL(String(link?.href || ""));
        const hostname = candidate.hostname.replace(/^www\./,"");
        if (!allowedHosts.test(hostname)) continue;
        const linkTextRaw = String(link?.text || "");
        const linkContext = String(link?.context || "");
        const linkText = linkTextRaw.toLowerCase();
        const addressToken = canonicalAddress(address || label);
        const textToken = canonicalAddress(linkTextRaw + " " + linkContext);
        if (addressToken && textToken && !textToken.includes(addressToken) && !addressToken.includes(textToken)) {
          if (label && !(linkTextRaw + " " + linkContext).toLowerCase().includes(String(label).toLowerCase())) continue;
        }

        const snippetListing = fallbackListingFromText(linkContext, candidate.toString(), { address, label, source:candidate.hostname });
        if (snippetListing.price || snippetListing.beds || snippetListing.baths) {
          return {
            state:"active",
            listing:snippetListing,
            checkedAt,
            checkedSources:successfulSources,
            browserFallback:true,
            searchSnippet:true
          };
        }

        let snapshotListing: Listing | null = null;
        try {
          const listingSnapshot = await browserSnapshot(candidate.toString());
          const listingText = String(listingSnapshot?.text || "");
          if (!listingText || looksLikeBrowserChallenge(listingText)) continue;
          snapshotListing = fallbackListingFromText(listingText, candidate.toString(), { address, label, source:candidate.hostname });
        } catch {}
        if (snapshotListing) {
          return {
            state:"active",
            listing:snapshotListing,
            checkedAt,
            checkedSources:successfulSources,
            browserFallback:true
          };
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
