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

async function readerText(url: string, timeoutMs = 14000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://r.jina.ai/" + url, {
      signal: controller.signal,
      headers: { "accept":"text/plain", "user-agent":"Rook/1.0 listing-enrichment" }
    });
    if (!response.ok) return "";
    const text = await response.text();
    return text.slice(0, 60000);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function browserWorker(body: Record<string, unknown>, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(BROWSER_WORKER_URL, {
      method:"POST",
      signal:controller.signal,
      headers:{ "content-type":"application/json", "x-rook-client":"rook-web-v1" },
      body:JSON.stringify(body)
    });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || "browser worker failed");
    return payload;
  } finally {
    clearTimeout(timer);
  }
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

function usablePhotoUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return "";
  if (/\.(?:svg|gif)(?:\?|$)/i.test(raw)) return "";
  if (/(?:logo|icon|avatar|sprite|badge|marker|map|floorplan|floor-plan|siteplan|site-plan)/i.test(raw)) return "";
  return raw;
}

function imageFromBrowserSnapshot(snapshot: any, address = "", label = "") {
  const images = Array.isArray(snapshot?.images) ? snapshot.images : [];
  const pageText = String(snapshot?.text || "");
  if ((address || label) && !contextMatchesAddress(pageText, address, label) && !pageMatchesProperty(pageText,address,label)) return null;
  const rows = images.map((image:any) => {
    const src = usablePhotoUrl(image?.src);
    if (!src) return null;
    const width = Number(image?.naturalWidth || image?.width || 0);
    const height = Number(image?.naturalHeight || image?.height || 0);
    if (width && height && (width < 260 || height < 150)) return null;
    const text = [image?.alt, image?.context, src].filter(Boolean).join(" ");
    if (/(logo|icon|avatar|map|floor\s*plan|site\s*plan)/i.test(text)) return null;
    const contextMatch = Boolean((address || label) && contextMatchesAddress(text,address,label));
    let score = Math.min(20, Math.floor((width * height) / 120000));
    if (width >= 800) score += 4;
    if (height >= 500) score += 3;
    if (/photo|home|house|apartment|townhome|property|exterior|interior|living|kitchen|bedroom/i.test(text)) score += 3;
    if (contextMatch) score += 20;
    return { src, score, width, height, contextMatch };
  }).filter(Boolean);
  const contextual = rows.filter((row:any)=>row.contextMatch);
  const ranked = (contextual.length ? contextual : rows).sort((a:any,b:any)=>b.score-a.score);
  return ranked[0] || null;
}

async function imageFromProviderIndex(pageUrl:string,address="",label="") {
  try {
    const snapshot = await browserSnapshot(pageUrl);
    const images = Array.isArray(snapshot?.images) ? snapshot.images : [];
    const matches = images.map((image:any) => {
      const src = usablePhotoUrl(image?.src);
      if (!src) return null;
      const text = [image?.alt,image?.context].filter(Boolean).join(" ");
      if (!contextMatchesAddress(text,address,label)) return null;
      if (/(logo|icon|avatar|map|floor\s*plan|site\s*plan)/i.test(text)) return null;
      const width = Number(image?.naturalWidth || image?.width || 0);
      const height = Number(image?.naturalHeight || image?.height || 0);
      if (width && height && (width < 180 || height < 120)) return null;
      return { src, width, height, score:(width*height)||1 };
    }).filter(Boolean).sort((a:any,b:any)=>b.score-a.score);
    return matches[0] || null;
  } catch {
    return null;
  }
}

function pageMatchesProperty(text: string, address = "", label = "") {
  if (!text) return false;
  if (address && contextMatchesAddress(text, address, label)) return true;
  const normalizedText = canonicalAddress(text);
  const cleanLabel = String(label || "").trim();
  if (cleanLabel.length >= 5 && normalizedText.includes(canonicalAddress(cleanLabel))) return true;
  // For multi-unit properties, a building/community page is acceptable for an
  // exterior/community photo even when it omits the exact apartment/unit suffix.
  const buildingAddress = String(address || "")
    .replace(/\s+(?:unit|apt|apartment|suite|#)\s*[A-Za-z0-9-]+(?=,|$)/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const buildingCore = addressCore(buildingAddress);
  if (buildingCore.length >= 8 && normalizedText.includes(buildingCore)) return true;
  return false;
}

function imageFromReaderText(text: string, address = "", label = "") {
  if (!pageMatchesProperty(text, address, label)) return null;
  const candidates = [
    ...[...String(text).matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)].map(m => m[1]),
    ...[...String(text).matchAll(/https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>)]*)?/gi)].map(m => m[0])
  ];
  for (const candidate of candidates) {
    const src = usablePhotoUrl(candidate);
    if (src) return src;
  }
  return null;
}

function isBlockedCommunityHost(hostname: string) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./,"");
  return [
    "google.com","bing.com","duckduckgo.com","facebook.com","instagram.com","x.com","twitter.com",
    "youtube.com","yelp.com","mapquest.com","wikipedia.org","apartments.com","zillow.com","trulia.com",
    "realtor.com","rent.com","apartmentlist.com","redfin.com","homes.com","hotpads.com","zumper.com","forrent.com"
  ].some(domain => host === domain || host.endsWith("." + domain));
}

function searchCommunityUrlsFromText(text: string, address = "", label = "") {
  const urls:string[] = [];
  const seen = new Set<string>();
  const cleanLabel = String(label || "").trim();
  const labelToken = canonicalAddress(cleanLabel);
  const buildingCore = addressCore(String(address || "").replace(/\s+(?:unit|apt|apartment|suite|#)\s*[A-Za-z0-9-]+(?=,|$)/i,""));
  const lines = String(text || "").split(/\n+/);
  for (let i=0; i<lines.length; i++) {
    const context = lines.slice(Math.max(0,i-2),Math.min(lines.length,i+4)).join(" ");
    const normalizedContext = canonicalAddress(context);
    const labelMatch = labelToken.length >= 5 && normalizedContext.includes(labelToken);
    const addressMatch = buildingCore.length >= 8 && normalizedContext.includes(buildingCore);
    if (!labelMatch && !addressMatch) continue;
    const hrefs = [
      ...[...context.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m=>m[1]),
      ...[...context.matchAll(/(https?:\/\/[^\s<>"')]+)/g)].map(m=>m[1])
    ];
    for (const href of hrefs) {
      const normalized = normalizeSearchResultUrl(href);
      if (!normalized || seen.has(normalized)) continue;
      try {
        const url = new URL(normalized);
        if (isBlockedCommunityHost(url.hostname)) continue;
        seen.add(normalized);
        urls.push(normalized);
        if (urls.length >= 5) return urls;
      } catch {}
    }
  }
  return urls;
}

function searchStreetClusterUrlsFromText(text: string, address = "", label = "") {
  const urls:string[] = [];
  const seen = new Set<string>();
  const lines = String(text || "").split(/\n+/);
  for (let i=0; i<lines.length; i++) {
    const context = lines.slice(Math.max(0,i-3),Math.min(lines.length,i+5)).join(" ");
    if (!comparableContextMatches(context,address || label,0)) continue;
    const hrefs = [
      ...[...context.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m=>m[1]),
      ...[...context.matchAll(/(https?:\/\/[^\s<>"')]+)/g)].map(m=>m[1])
    ];
    for (const href of hrefs) {
      const normalized = normalizeSearchResultUrl(href);
      if (!normalized || seen.has(normalized)) continue;
      try {
        const url = new URL(normalized);
        if (!isAllowedListingHost(url.hostname)) continue;
        seen.add(normalized);
        urls.push(normalized);
        if (urls.length >= 5) return urls;
      } catch {}
    }
  }
  return urls;
}

function streetClusterQuery(address = "", label = "") {
  const raw = String(address || label || "");
  const first = raw.split(",")[0] || "";
  const withoutUnit = first.replace(/\s+(?:unit|apt|apartment|suite|#)\s*[A-Za-z0-9-]+\s*$/i,"").trim();
  const streetOnly = withoutUnit.replace(/^\s*\d+[A-Za-z]?\s+/,"").trim();
  return { withoutUnit, streetOnly };
}

function searchCandidateUrlsFromText(text: string, address = "", label = "") {
  const urls:string[] = [];
  const seen = new Set<string>();
  const lines = String(text || "").split(/\n+/);
  for (let i = 0; i < lines.length; i += 1) {
    const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(" ");
    if (!contextMatchesAddress(context, address, label)) continue;
    const hrefs = [
      ...[...context.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]),
      ...[...context.matchAll(/(https?:\/\/[^\s<>"')]+)/g)].map(m => m[1])
    ];
    for (const href of hrefs) {
      const normalized = normalizeSearchResultUrl(href);
      if (!normalized || seen.has(normalized)) continue;
      try {
        const url = new URL(normalized);
        if (!isAllowedListingHost(url.hostname)) continue;
        seen.add(normalized);
        urls.push(normalized);
        if (urls.length >= 6) return urls;
      } catch {}
    }
  }
  return urls;
}

async function imageFromListingPage(pageUrl: string, address = "", label = "") {
  try {
    const html = await fetchText(pageUrl);
    const text = stripHtml(html).slice(0, 70000);
    const rows = jsonLdListings(html, new URL(pageUrl).hostname, pageUrl);
    const match = rows.find(row => sameAddress(row.address, address) || (!address && canonicalAddress(row.label) === canonicalAddress(label)));
    const pageMatches = Boolean(match) || pageMatchesProperty(text, address, label);
    if (pageMatches) {
      const structuredImage = usablePhotoUrl(match?.primaryImageUrl || match?.imageUrl || match?.image || match?.metadata?.image);
      if (structuredImage) return { imageUrl:structuredImage, method:"alternate-structured" };
      const fallback = fallbackListingFromHtml(html, pageUrl, { address, label, source:new URL(pageUrl).hostname });
      const metaImage = usablePhotoUrl(fallback?.primaryImageUrl || fallback?.imageUrl || fallback?.image || fallback?.metadata?.image);
      if (metaImage) return { imageUrl:metaImage, method:"alternate-meta" };
    }
  } catch {}

  try {
    const reader = await readerText(pageUrl, 5000);
    const readerImage = imageFromReaderText(reader, address, label);
    if (readerImage) return { imageUrl:readerImage, method:"alternate-reader" };
  } catch {}

  try {
    const snapshot = await browserSnapshot(pageUrl);
    const browserImage = imageFromBrowserSnapshot(snapshot, address, label);
    if (browserImage?.src) return { imageUrl:browserImage.src, method:"alternate-browser", dimensions:{ width:browserImage.width, height:browserImage.height } };
  } catch {}

  return null;
}

async function discoverExactProviderUrls(address:string,label:string,location:string) {
  const subject = address || label;
  if (!subject) return [];
  const providers = ["forrent.com","trulia.com","hotpads.com","zillow.com","apartments.com","realtor.com","rent.com","redfin.com","homes.com","zumper.com"];
  const urls:string[] = [];
  const seen = new Set<string>();
  for (const domain of providers) {
    const query = ['site:' + domain, '"' + subject + '"', location].filter(Boolean).join(" ");
    const searchUrl = "https://www.bing.com/search?format=rss&q=" + encodeURIComponent(query);
    try {
      const html = await fetchText(searchUrl);
      const hrefs = [
        ...[...html.matchAll(/<link>\s*(https?:\/\/[^<\s]+)\s*<\/link>/gi)].map(m=>m[1].replace(/&amp;/g,"&")),
        ...[...html.matchAll(/<guid[^>]*>\s*(https?:\/\/[^<\s]+)\s*<\/guid>/gi)].map(m=>m[1].replace(/&amp;/g,"&"))
      ];
      for (const href of hrefs) {
        const normalized = normalizeSearchResultUrl(href);
        if (!normalized || seen.has(normalized)) continue;
        try {
          const u = new URL(normalized);
          if (!isAllowedListingHost(u.hostname)) continue;
          seen.add(normalized);
          urls.push(normalized);
          if (urls.length >= 8) return urls;
        } catch {}
      }
    } catch {}
  }
  return urls;
}

async function discoverOfficialGalleryUrls(sourceUrl:string,address="",label="") {
  if (!sourceUrl) return [];
  try {
    const u = new URL(sourceUrl);
    if (isAllowedListingHost(u.hostname) || isBlockedCommunityHost(u.hostname)) return [];
    const root = u.origin + "/";
    const urls:string[] = [];
    const seen = new Set<string>();
    const add = (value:string) => {
      try {
        const parsed = new URL(value,root);
        if (parsed.origin !== u.origin) return;
        const href = parsed.toString();
        if (seen.has(href)) return;
        seen.add(href);
        urls.push(href);
      } catch {}
    };
    add(root);
    try {
      const html = await fetchText(root);
      const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]);
      for (const href of links) {
        if (!/(photo|gallery|media|amenit)/i.test(href)) continue;
        add(href);
        if (urls.length >= 6) break;
      }
    } catch {}
    try {
      const reader = await readerText(root,5000);
      const links = [...String(reader||"").matchAll(/\[[^\]]*(?:photo|gallery|amenit)[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)].map(m=>m[1]);
      for (const href of links) {
        add(href);
        if (urls.length >= 6) break;
      }
    } catch {}
    return urls;
  } catch {
    return [];
  }
}

function decodeImageSearchHref(raw: unknown) {
  const href = String(raw || "").trim();
  if (!href) return { sourceUrl:"", mediaUrl:"" };
  try {
    const u = new URL(href);
    const sourceUrl = u.searchParams.get("purl") || u.searchParams.get("url") || "";
    const mediaUrl = u.searchParams.get("mediaurl") || u.searchParams.get("imgurl") || "";
    return {
      sourceUrl: sourceUrl ? decodeURIComponent(sourceUrl) : "",
      mediaUrl: mediaUrl ? decodeURIComponent(mediaUrl) : ""
    };
  } catch {
    return { sourceUrl:"", mediaUrl:"" };
  }
}

async function exactAddressImageSearch(address:string,label:string,location:string) {
  const subject = address || label;
  if (!subject) return null;
  const query = ['"' + subject + '"', location, "rental"].filter(Boolean).join(" ");
  const targets = [
    "https://www.bing.com/images/search?q=" + encodeURIComponent(query),
    "https://www.google.com/search?tbm=isch&q=" + encodeURIComponent(query)
  ];
  for (const target of targets) {
    try {
      const snapshot = await browserSnapshot(target);
      const images = Array.isArray(snapshot?.images) ? snapshot.images : [];
      for (const image of images) {
        const text = [image?.alt,image?.context].filter(Boolean).join(" ");
        if (!contextMatchesAddress(text,address,label)) continue;
        const decoded = decodeImageSearchHref(image?.href);
        const sourceUrl = normalizeSearchResultUrl(decoded.sourceUrl || image?.href || "");
        let imageUrl = usablePhotoUrl(decoded.mediaUrl || image?.dataSrc || image?.src);
        if (!imageUrl) imageUrl = usablePhotoUrl(image?.src);
        if (!imageUrl) continue;
        if (sourceUrl) {
          try {
            const host = new URL(sourceUrl).hostname;
            if (isBlockedCommunityHost(host) && !isAllowedListingHost(host)) continue;
          } catch {}
        }
        return {
          imageUrl,
          sourceUrl:sourceUrl || target,
          width:Number(image?.naturalWidth || image?.width || 0),
          height:Number(image?.naturalHeight || image?.height || 0),
          method:"exact-image-search"
        };
      }
    } catch {}
  }
  return null;
}

async function listingFromImageSearchSource(address:string,label:string,location:string) {
  const hit = await exactAddressImageSearch(address,label,location);
  if (!hit?.sourceUrl) return null;
  try {
    const url = new URL(hit.sourceUrl);
    if (!isAllowedListingHost(url.hostname)) return null;
    const inspected = await inspectListingUrl(url.toString());
    if (inspected.reachable && !inspected.closed) {
      const rows = jsonLdListings(inspected.html,url.hostname,url.toString());
      const match = rows.find(row=>sameAddress(row.address,address));
      const listing = match || fallbackListingFromHtml(inspected.html,url.toString(),{address,label,source:url.hostname});
      if (Number(listing?.price)>0 || listing?.beds != null || listing?.baths != null) return listing;
    }
    const reader = await readerText(url.toString(),5000);
    if (reader && !looksLikeBrowserChallenge(reader)) {
      const listing = fallbackListingFromText(reader,url.toString(),{address,label,source:url.hostname});
      if (Number(listing?.price)>0 || listing?.beds != null || listing?.baths != null) return listing;
    }
  } catch {}
  return null;
}

function providerCityIndexUrls(location:string) {
  const city = String(location || "Fort Collins, CO").split(",")[0].trim();
  const slug = city.toLowerCase().replace(/[^a-z0-9]+/g,"-");
  const title = city.replace(/\s+/g,"_");
  return [
    "https://hotpads.com/" + slug + "-co/apartments-for-rent",
    "https://www.trulia.com/for_rent/" + title + ",CO/",
    "https://www.apartments.com/" + slug + "-co/",
    "https://www.zillow.com/" + slug + "-co/rentals/"
  ];
}

function listingFromIndexSnapshot(snapshot:any,address="",label="") {
  const links = Array.isArray(snapshot?.links) ? snapshot.links : [];
  for (const link of links) {
    const context = [link?.text,link?.context].filter(Boolean).join(" ");
    if (!contextMatchesAddress(context,address,label)) continue;
    const listing = fallbackListingFromText(context,String(link?.href||"https://example.com/"),{
      address,label,source:(()=>{try{return new URL(String(link?.href||"")).hostname}catch{return "provider-index"}})()
    });
    if (Number(listing.price)>0 || listing.beds != null || listing.baths != null) return listing;
  }
  const images = Array.isArray(snapshot?.images) ? snapshot.images : [];
  for (const image of images) {
    const context = [image?.alt,image?.context].filter(Boolean).join(" ");
    if (!contextMatchesAddress(context,address,label)) continue;
    const sourceUrl = String(image?.href || "");
    const listing = fallbackListingFromText(context,sourceUrl || "https://example.com/",{
      address,label,source:(()=>{try{return new URL(sourceUrl).hostname}catch{return "provider-index"}})()
    });
    if (Number(listing.price)>0 || listing.beds != null || listing.baths != null) return listing;
  }
  return null;
}

async function providerCityIndexRecovery(address:string,label:string,location:string) {
  const urls = providerCityIndexUrls(location);
  const inspect = async (indexUrl:string) => {
    try {
      const snapshot = await browserSnapshot(indexUrl);
      const image = imageFromProviderIndexSnapshot(snapshot,address,label);
      const listing = listingFromIndexSnapshot(snapshot,address,label);
      return image?.src || listing ? { indexUrl,image,listing } : null;
    } catch {
      return null;
    }
  };
  for (const tier of [urls.slice(0,2), urls.slice(2,4)]) {
    const results = await Promise.all(tier.map(inspect));
    const hit = results.find(Boolean);
    if (hit) return hit;
  }
  return null;
}

function imageFromProviderIndexSnapshot(snapshot:any,address="",label="") {
  const images = Array.isArray(snapshot?.images) ? snapshot.images : [];
  const matches = images.map((image:any) => {
    const src = usablePhotoUrl(image?.dataSrc || image?.src);
    if (!src) return null;
    const text = [image?.alt,image?.context].filter(Boolean).join(" ");
    if (!contextMatchesAddress(text,address,label)) return null;
    if (/(logo|icon|avatar|map|floor\s*plan|site\s*plan)/i.test(text)) return null;
    const width = Number(image?.naturalWidth || image?.width || 0);
    const height = Number(image?.naturalHeight || image?.height || 0);
    if (width && height && (width < 180 || height < 120)) return null;
    const decoded = decodeImageSearchHref(image?.href);
    const sourceUrl = normalizeSearchResultUrl(decoded.sourceUrl || image?.href || "");
    return {src,width,height,sourceUrl,score:(width*height)||1};
  }).filter(Boolean).sort((a:any,b:any)=>b.score-a.score);
  return matches[0] || null;
}

async function resolveListingImage(address: string, label: string, location: string, sourceUrl = "") {
  const checkedAt = new Date().toISOString();
  const seen = new Set<string>();
  const candidateUrls:string[] = [];
  const pushUrl = (value:string) => {
    const normalized = normalizeSearchResultUrl(value);
    if (!normalized || seen.has(normalized)) return;
    try {
      const url = new URL(normalized);
      if (!isAllowedListingHost(url.hostname)) return;
      seen.add(normalized);
      candidateUrls.push(normalized);
    } catch {}
  };

  if (sourceUrl) pushUrl(sourceUrl);

  // First inspect any known listing page directly; image enrichment should not wait
  // for the full availability resolver to prove the listing active.
  if (sourceUrl) {
    const direct = await imageFromListingPage(sourceUrl, address, label);
    if (direct?.imageUrl) {
      return {
        state:"found",
        imageUrl:direct.imageUrl,
        sourceUrl,
        checkedAt,
        method:direct.method || "direct-page",
        ...(direct.dimensions ? { dimensions:direct.dimensions } : {})
      };
    }
  }

  // If the source is an official/community site, inspect its homepage and
  // photo/gallery links before falling back to third-party portals.
  for (const galleryUrl of await discoverOfficialGalleryUrls(sourceUrl,address,label)) {
    const result = await imageFromListingPage(galleryUrl,address,label);
    if (result?.imageUrl) {
      return {
        state:"found",
        imageUrl:result.imageUrl,
        sourceUrl:galleryUrl,
        checkedAt,
        method:"official-gallery-" + (result.method || "page"),
        ...(result.dimensions ? { dimensions:result.dimensions } : {})
      };
    }
  }

  // City-wide provider indexes are a reliable fallback when an exact property
  // page is absent. Only an image whose own card context matches the address is accepted.
  const cityIndexHit = await providerCityIndexRecovery(address,label,location);
  if (cityIndexHit?.image?.src) {
    return {
      state:"found",
      imageUrl:cityIndexHit.image.src,
      sourceUrl:cityIndexHit.image.sourceUrl || cityIndexHit.indexUrl,
      checkedAt,
      method:"provider-city-index-card",
      dimensions:{width:cityIndexHit.image.width,height:cityIndexHit.image.height}
    };
  }

  // Reuse the listing resolver once because it can discover a fresher exact-address
  // source that is not the stale sourceUrl saved on the property.
  try {
    const resolved = await resolveListing(address, label, location, sourceUrl);
    const listing = resolved?.listing || null;
    const directImage = usablePhotoUrl(
      listing?.primaryImageUrl || listing?.imageUrl || listing?.image ||
      listing?.metadata?.image || listing?.metadata?.imageUrl
    );
    const resolvedUrl = String(listing?.sourceUrl || "");
    if (resolved?.state === "active" && directImage) {
      return {
        state:"found",
        imageUrl:directImage,
        sourceUrl:resolvedUrl || sourceUrl || null,
        checkedAt,
        method:"listing-metadata"
      };
    }
    if (resolvedUrl) pushUrl(resolvedUrl);
  } catch {}

  // Search the exact address/community name for alternate listing sources and inspect
  // those pages. Search result images themselves are never used.
  const exact = ['"' + (address || label) + '"', location, "rental listing"].filter(Boolean).join(" ");
  const searchUrls = [
    "https://www.bing.com/search?format=rss&q=" + encodeURIComponent(exact),
    "https://www.google.com/search?q=" + encodeURIComponent(exact)
  ];
  for (const searchUrl of searchUrls) {
    try {
      const reader = await readerText(searchUrl, 5000);
      for (const url of searchCandidateUrlsFromText(reader, address, label)) pushUrl(url);
    } catch {}
    if (candidateUrls.length >= 6) break;
  }

  // Browser-backed discovery is the final discovery tier and only runs if cheap
  // exact-address search did not surface additional listing pages.
  if (candidateUrls.length <= (sourceUrl ? 1 : 0)) {
    try {
      const snapshot = await browserSnapshot("https://www.google.com/search?q=" + encodeURIComponent(exact));
      for (const link of Array.isArray(snapshot?.links) ? snapshot.links : []) {
        const context = [link?.text, link?.context].filter(Boolean).join(" ");
        if (!contextMatchesAddress(context, address, label)) continue;
        pushUrl(String(link?.href || ""));
        if (candidateUrls.length >= 6) break;
      }
    } catch {}
  }

  for (const candidateUrl of candidateUrls.slice(0, 4)) {
    if (sourceUrl && normalizeSearchResultUrl(candidateUrl) === normalizeSearchResultUrl(sourceUrl)) continue;
    const result = await imageFromListingPage(candidateUrl, address, label);
    if (result?.imageUrl) {
      return {
        state:"found",
        imageUrl:result.imageUrl,
        sourceUrl:candidateUrl,
        checkedAt,
        method:result.method || "alternate-page",
        ...(result.dimensions ? { dimensions:result.dimensions } : {})
      };
    }
  }

  // Provider-specific exact-address discovery is deliberately redundant with
  // general web search. It makes recovery resilient when one search path omits a result.
  for (const exactUrl of await discoverExactProviderUrls(address,label,location)) {
    if (seen.has(exactUrl)) continue;
    seen.add(exactUrl);
    const result = await imageFromListingPage(exactUrl,address,label);
    if (result?.imageUrl) {
      return {
        state:"found",
        imageUrl:result.imageUrl,
        sourceUrl:exactUrl,
        checkedAt,
        method:"provider-exact-" + (result.method || "page"),
        ...(result.dimensions ? { dimensions:result.dimensions } : {})
      };
    }
  }

  // Provider-index fallback: comparable discovery often finds neighborhood/category
  // pages rather than a dedicated property URL. Use an image only when that image's
  // own card context matches the target address.
  try {
    const comparable = await resolveComparablePrice(address,label,location,0,0);
    for (const evidence of comparable?.evidence || []) {
      const evidenceUrl = String(evidence?.sourceUrl || "");
      if (!evidenceUrl) continue;
      const hit = await imageFromProviderIndex(evidenceUrl,address,label);
      if (hit?.src) {
        return {
          state:"found",
          imageUrl:hit.src,
          sourceUrl:evidenceUrl,
          checkedAt,
          method:"provider-index-card",
          dimensions:{width:hit.width,height:hit.height}
        };
      }
    }
  } catch {}

  // Community-name fallback: search for an official/community website and accept it
  // only after the destination page itself matches the property name or building address.
  const cleanLabel = String(label || "").trim();
  if (cleanLabel && !/^\d+\s/.test(cleanLabel)) {
    const communityQuery = ['"' + cleanLabel + '"', location, "apartments"].filter(Boolean).join(" ");
    const communitySearches = [
      "https://www.google.com/search?q=" + encodeURIComponent(communityQuery),
      "https://www.bing.com/search?q=" + encodeURIComponent(communityQuery)
    ];
    const communityUrls:string[] = [];
    for (const searchUrl of communitySearches) {
      try {
        const reader = await readerText(searchUrl,5000);
        for (const url of searchCommunityUrlsFromText(reader,address,label)) {
          if (!communityUrls.includes(url)) communityUrls.push(url);
          if (communityUrls.length >= 4) break;
        }
      } catch {}
      if (communityUrls.length >= 4) break;
    }
    for (const communityUrl of communityUrls) {
      const result = await imageFromListingPage(communityUrl,address,label);
      if (result?.imageUrl) {
        return {
          state:"found",
          imageUrl:result.imageUrl,
          sourceUrl:communityUrl,
          checkedAt,
          method:"community-" + (result.method || "page"),
          ...(result.dimensions ? { dimensions:result.dimensions } : {})
        };
      }
    }
  }

  // Address-only fallback: search the same street/building cluster. The page still
  // has to match the building street core before any image can be accepted.
  const cluster = streetClusterQuery(address,label);
  if (cluster.streetOnly) {
    const clusterQuery = ['"' + cluster.streetOnly + '"', location, "apartments", "rental"].join(" ");
    const clusterSearches = [
      "https://www.google.com/search?q=" + encodeURIComponent(clusterQuery),
      "https://www.bing.com/search?q=" + encodeURIComponent(clusterQuery)
    ];
    const clusterUrls:string[] = [];
    for (const searchUrl of clusterSearches) {
      try {
        const reader = await readerText(searchUrl,5000);
        for (const url of searchStreetClusterUrlsFromText(reader,cluster.withoutUnit,label)) {
          if (!clusterUrls.includes(url)) clusterUrls.push(url);
          if (clusterUrls.length >= 4) break;
        }
      } catch {}
      if (clusterUrls.length >= 4) break;
    }
    for (const clusterUrl of clusterUrls) {
      const result = await imageFromListingPage(clusterUrl,cluster.streetOnly,label);
      if (result?.imageUrl) {
        return {
          state:"found",
          imageUrl:result.imageUrl,
          sourceUrl:clusterUrl,
          checkedAt,
          method:"cluster-" + (result.method || "page"),
          ...(result.dimensions ? { dimensions:result.dimensions } : {})
        };
      }
    }
  }

  const imageSearchHit = await exactAddressImageSearch(address,label,location);
  if (imageSearchHit?.imageUrl) {
    return {
      state:"found",
      imageUrl:imageSearchHit.imageUrl,
      sourceUrl:imageSearchHit.sourceUrl || null,
      checkedAt,
      method:imageSearchHit.method,
      dimensions:{width:imageSearchHit.width,height:imageSearchHit.height}
    };
  }

  return {
    state:"missing",
    imageUrl:null,
    sourceUrl:candidateUrls[0] || sourceUrl || null,
    checkedAt,
    method:"none",
    checkedCandidates:candidateUrls.length
  };
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

function incomeRestrictionText(listing: Listing) {
  const parts: unknown[] = [listing.label, listing.address, listing.type, listing.metadata?.description];
  try { parts.push(JSON.stringify(listing.metadata || {})); } catch {}
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function isIncomeRestrictedListing(listing: Listing) {
  const text = incomeRestrictionText(listing);
  if (/(income[-\s]restricted|income\s+(?:limit|limits|limited|qualified|qualification|qualifications)|income-qualified|affordable\s+housing(?:\s+programs?)?|section\s*8|\blihtc\b|low[-\s]income\s+housing\s+tax\s+credit)/i.test(text)) return true;
  const label = String(listing.label || "");
  const address = String(listing.address || "");
  if (/\bbuffalo\s+run(?:\s+apartments)?\b/i.test(label)) return true;
  return /\b1245\s+e\s+lincoln\s+ave\b/i.test(address) && /buffalo\s+run/i.test(label + " " + text);
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
    .replace(/\b(boulevard)\b/g,"blvd")
    .replace(/\b(?:apartment|apt|unit|suite|ste)\s*#?\s*([a-z0-9-]+)\b/g,"unit$1")
    .replace(/#\s*([a-z0-9-]+)\b/g,"unit$1")
    .replace(/[^a-z0-9]/g,"");
}

function addressCore(value: unknown) {
  const firstLine = String(value || "").split(/[,\n|]/)[0] || "";
  return canonicalAddress(firstLine);
}

function streetNumber(value: unknown) {
  return String(value || "").trim().match(/^(\d+[a-z]?)(?:\s|$)/i)?.[1]?.toLowerCase() || "";
}

function sameAddress(a: unknown, b: unknown) {
  const left = canonicalAddress(a), right = canonicalAddress(b);
  if (!left || !right) return false;
  const leftNumber = streetNumber(a), rightNumber = streetNumber(b);
  if (leftNumber && rightNumber && leftNumber !== rightNumber) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function contextMatchesAddress(context: unknown, address = "", label = "") {
  const text = canonicalAddress(context);
  if (!text) return false;
  for (const target of [address, label]) {
    if (!target) continue;
    if (sameAddress(context, target)) return true;
    const core = addressCore(target);
    if (core.length >= 8 && text.includes(core)) return true;
  }
  return false;
}

const ALLOWED_LISTING_HOSTS = [
  "realtor.com", "rent.com", "apartmentlist.com", "zillow.com", "trulia.com",
  "apartments.com", "rentcafe.com", "redfin.com", "homes.com", "hotpads.com",
  "zumper.com", "forrent.com"
];

function isAllowedListingHost(hostname: string) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  return ALLOWED_LISTING_HOSTS.some(domain => host === domain || host.endsWith("." + domain));
}

function normalizeSearchResultUrl(raw: unknown) {
  let value = String(raw || "").trim().replace(/&amp;/gi, "&");
  if (!value) return "";
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const parsed = new URL(value, "https://www.google.com/");
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const redirectTarget =
        ((host === "google.com" || host.endsWith(".google.com")) && parsed.pathname === "/url")
          ? (parsed.searchParams.get("q") || parsed.searchParams.get("url"))
          : (host === "duckduckgo.com" || host.endsWith(".duckduckgo.com"))
            ? parsed.searchParams.get("uddg")
            : null;
      if (!redirectTarget) return parsed.toString();
      const decoded = decodeURIComponent(redirectTarget);
      if (!decoded || decoded === value) return "";
      value = decoded;
    } catch {
      try {
        const decoded = decodeURIComponent(value);
        if (!decoded || decoded === value) return "";
        value = decoded;
      } catch {
        return "";
      }
    }
  }
  try { return new URL(value).toString(); } catch { return ""; }
}

function listingFromBrowserIndex(snapshot: any, address: string, label: string, source: string) {
  const links = Array.isArray(snapshot?.links) ? snapshot.links : [];
  for (const link of links) {
    const context = [link?.text, link?.context].filter(Boolean).join(" ");
    if (!contextMatchesAddress(context, address, label)) continue;

    const candidateUrl = normalizeSearchResultUrl(link?.href);
    if (!candidateUrl) continue;
    try {
      const candidate = new URL(candidateUrl);
      if (!isAllowedListingHost(candidate.hostname)) continue;
      return fallbackListingFromText(context, candidate.toString(), {
        address,
        label,
        source: source || candidate.hostname
      });
    } catch {}
  }
  return null;
}

function listingFromReaderIndex(text: string, address: string, label: string, source: string, pageUrl: string) {
  const lines = String(text || "").split(/\n+/);
  const wanted = canonicalAddress(address || label);
  for (let i = 0; i < lines.length; i += 1) {
    const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(" ");
    if (!wanted || !contextMatchesAddress(context, address, label)) continue;
    const hrefs = [
      ...[...context.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]),
      ...[...context.matchAll(/(https?:\/\/[^\s<>"')]+)/g)].map(m => m[1])
    ];
    for (const href of hrefs) {
      const candidateUrl = normalizeSearchResultUrl(href);
      if (!candidateUrl) continue;
      try {
        const candidate = new URL(candidateUrl, pageUrl);
        if (!isAllowedListingHost(candidate.hostname)) continue;
        return fallbackListingFromText(context, candidate.toString(), { address, label, source:source || candidate.hostname });
      } catch {}
    }
  }
  return null;
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

function streetComparableKey(value: unknown) {
  const first = String(value || "").split(",")[0] || "";
  return canonicalAddress(
    first
      .replace(/^\s*\d+[A-Za-z]?\s+/, "")
      .replace(/\s+(?:unit|apt|apartment|suite|#)\s*[A-Za-z0-9-]+\s*$/i, "")
  );
}

function streetNumberValue(value: unknown) {
  const raw = String(value || "").trim().match(/^(\d+)/)?.[1];
  return raw ? Number(raw) : null;
}

function comparableContextMatches(context: string, address: string, targetBeds = 0) {
  const key = streetComparableKey(address);
  if (!key || !canonicalAddress(context).includes(key)) return false;
  if (targetBeds > 0) {
    const beds = firstMatchNumber(context, [/([\d.]+)\s*(?:bed|beds|bedroom|bedrooms)\b/i]);
    if (beds != null && Math.round(beds) !== Math.round(targetBeds)) return false;
  }
  const targetNumber = streetNumberValue(address);
  const numbers = [...String(context).matchAll(/\b(\d{2,5})\s+[A-Za-z]/g)]
    .map(match => Number(match[1]))
    .filter(Number.isFinite);
  if (targetNumber && numbers.length) {
    const close = numbers.some(value => Math.abs(value - targetNumber) <= 50);
    if (!close) return false;
  }
  return true;
}

async function resolveComparablePrice(address: string, label: string, location: string, targetBeds = 0, targetBaths = 0) {
  if (!address && !label) return null;
  const checkedAt = new Date().toISOString();
  const subject = address || label;
  const bedText = targetBeds > 0 ? targetBeds + " bedroom" : "";
  const query = ['"' + subject + '"', bedText, location, "rent"].filter(Boolean).join(" ");
  try {
    const cityIndex = await providerCityIndexRecovery(address,label,location);
    if (cityIndex?.listing && Number(cityIndex.listing.price)>0) {
      const price = Number(cityIndex.listing.price);
      candidates.push({
        price,
        beds:Number(cityIndex.listing.beds||0)||null,
        baths:Number(cityIndex.listing.baths||0)||null,
        source:cityIndex.listing.source || "provider-city-index",
        sourceUrl:cityIndex.listing.sourceUrl || cityIndex.indexUrl,
        context:[cityIndex.listing.label,cityIndex.listing.address].filter(Boolean).join(" ")
      });
    }
  } catch {}

  const searchUrls = [
    "https://www.bing.com/search?format=rss&q=" + encodeURIComponent(query),
    "https://www.google.com/search?q=" + encodeURIComponent(query),
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query)
  ];
  const candidates:any[] = [];
  const seen = new Set<string>();

  const consider = (context:string, sourceUrl:string, source:string) => {
    if (!comparableContextMatches(context, address || label, targetBeds)) return;
    const parsed = fallbackListingFromText(context, sourceUrl, { address, label, source });
    const price = Number(parsed.price || 0);
    if (!(price >= 500 && price <= 10000)) return;
    const beds = Number(parsed.beds || targetBeds || 0);
    if (targetBeds > 0 && beds > 0 && Math.round(beds) !== Math.round(targetBeds)) return;
    const key = sourceUrl + "|" + price;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      price,
      beds:beds || null,
      baths:Number(parsed.baths || 0) || null,
      source,
      sourceUrl,
      context:String(context).slice(0,1200)
    });
  };

  for (const searchUrl of searchUrls) {
    try {
      const text = await readerText(searchUrl, 5000);
      const lines = String(text || "").split(/\n+/);
      for (let i=0; i<lines.length; i++) {
        const context = lines.slice(Math.max(0,i-3), Math.min(lines.length,i+5)).join(" ");
        if (!comparableContextMatches(context, address || label, targetBeds)) continue;
        const hrefs = [
          ...[...context.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m=>m[1]),
          ...[...context.matchAll(/(https?:\/\/[^\s<>"')]+)/g)].map(m=>m[1])
        ];
        let acceptedUrl = "";
        for (const href of hrefs) {
          const normalized = normalizeSearchResultUrl(href);
          if (!normalized) continue;
          try {
            const u = new URL(normalized);
            if (!isAllowedListingHost(u.hostname)) continue;
            acceptedUrl = normalized;
            break;
          } catch {}
        }
        if (!acceptedUrl) continue;
        consider(context, acceptedUrl, new URL(acceptedUrl).hostname);
      }
    } catch {}
    if (candidates.length >= 4) break;
  }

  if (!candidates.length) {
    try {
      const snapshot = await browserSnapshot("https://www.google.com/search?q=" + encodeURIComponent(query));
      for (const link of Array.isArray(snapshot?.links) ? snapshot.links : []) {
        const context = [link?.text, link?.context].filter(Boolean).join(" ");
        if (!comparableContextMatches(context, address || label, targetBeds)) continue;
        const normalized = normalizeSearchResultUrl(link?.href);
        if (!normalized) continue;
        try {
          const u = new URL(normalized);
          if (!isAllowedListingHost(u.hostname)) continue;
          consider(context, normalized, u.hostname);
        } catch {}
      }
    } catch {}
  }

  if (!candidates.length) {
    try {
      const listing = await listingFromImageSearchSource(address,label,location);
      if (listing && Number(listing.price)>0) {
        candidates.push({
          price:Number(listing.price),
          beds:Number(listing.beds||0)||null,
          baths:Number(listing.baths||0)||null,
          source:listing.source || "image-search-source",
          sourceUrl:listing.sourceUrl || "",
          context:[listing.label,listing.address].filter(Boolean).join(" ")
        });
      }
    } catch {}
  }

  if (!candidates.length) return null;
  candidates.sort((a,b) => a.price - b.price);
  const prices = [...new Set(candidates.map(item=>item.price))];
  const price = prices[Math.floor((prices.length - 1) / 2)];
  const evidence = candidates.filter(item=>item.price===price).slice(0,3);
  const labelText = targetBeds > 0
    ? "$" + price.toLocaleString("en-US") + "/mo (building " + targetBeds + "BR)"
    : "$" + price.toLocaleString("en-US") + "/mo (building comparable)";
  return {
    price,
    priceLabel:labelText,
    checkedAt,
    targetBeds:targetBeds || null,
    targetBaths:targetBaths || null,
    method:"same-street-building-comparable",
    evidence:evidence.map(item=>({ source:item.source, sourceUrl:item.sourceUrl, price:item.price, beds:item.beds, baths:item.baths }))
  };
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
        let match = rows.find(row =>
          (address && sameAddress(row.address, address)) ||
          (!address && canonicalAddress(row.label) === canonicalAddress(label))
        ) || fallbackListingFromHtml(inspected.html, direct.toString(), { address, label, source:direct.hostname });

        if (!match.price || match.beds == null || match.baths == null) {
          const reader = await readerText(direct.toString(), 5000);
          if (reader && !looksLikeBrowserChallenge(reader)) {
            const enriched = fallbackListingFromText(reader, direct.toString(), { address, label, source:direct.hostname });
            match = {
              ...match,
              price: match.price || enriched.price,
              beds: match.beds ?? enriched.beds,
              baths: match.baths ?? enriched.baths,
              metadata:{ ...(match.metadata || {}), directReaderEnriched:true }
            };
          }
        }

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
        const reader = await readerText(direct.toString());
        if (reader && !looksLikeBrowserChallenge(reader)) {
          const readerListing = fallbackListingFromText(reader, direct.toString(), { address, label, source:direct.hostname });
          return {
            state:"active",
            listing:readerListing,
            checkedAt,
            checkedSources:1,
            readerFallback:true
          };
        }
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
  const exactProviderQuery = ['"' + (address || label) + '"', "rent"].filter(Boolean).join(" ");
  const searchUrls = [
    "https://www.bing.com/search?format=rss&q=" + encodeURIComponent(exactProviderQuery),
    "https://www.google.com/search?q=" + encodeURIComponent(query),
    "https://www.bing.com/search?q=" + encodeURIComponent(query),
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query)
  ];
  const seenCandidates = new Set<string>();
  for (const searchUrl of searchUrls) {
    try {
      const searchHtml = await fetchText(searchUrl);

      const knownHost = (() => { try { return sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./,"") : ""; } catch { return ""; } })();
      const snippet = searchSnippetContext(searchHtml, [address, label, knownHost]);
      if (snippet) {
        const snippetUrl = sourceUrl || "https://" + (knownHost || "example.com") + "/";
        const snippetListing = fallbackListingFromText(snippet, snippetUrl, { address, label, source:knownHost || "search-result" });
        if (sourceUrl && (snippetListing.price || snippetListing.beds || snippetListing.baths)) {
          return {
            state:"active",
            listing:{ ...snippetListing, sourceUrl },
            checkedAt,
            checkedSources:successfulSources,
            searchSnippet:true
          };
        }
      }

      const hrefs = [
        ...[...searchHtml.matchAll(/<link>\s*(https?:\/\/[^<\s]+)\s*<\/link>/gi)].map(match => match[1].replace(/&amp;/g, "&")),
        ...[...searchHtml.matchAll(/<guid[^>]*>\s*(https?:\/\/[^<\s]+)\s*<\/guid>/gi)].map(match => match[1].replace(/&amp;/g, "&")),
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
          const candidateUrl = normalizeSearchResultUrl(href);
          if (!candidateUrl) continue;
          const candidate = new URL(candidateUrl);
          const hostname = candidate.hostname.replace(/^www\./,"");
          if (!isAllowedListingHost(hostname)) continue;
          const normalizedCandidate = candidate.toString();
          if (seenCandidates.has(normalizedCandidate)) continue;
          seenCandidates.add(normalizedCandidate);

          const inspected = await inspectListingUrl(normalizedCandidate);
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
          if (!inspected.reachable && !inspected.closed) {
            const reader = await readerText(normalizedCandidate);
            if (reader && !looksLikeBrowserChallenge(reader)) {
              const resolved = fallbackListingFromText(reader, normalizedCandidate, { address, label, source:candidate.hostname });
              if (resolved.price || resolved.beds || resolved.baths) {
                return {
                  state:"active",
                  listing:resolved,
                  checkedAt,
                  checkedSources:successfulSources,
                  readerFallback:true
                };
              }
            }
          }
          if (match && inspected.closed) {
            closedEvidence.push({ source:candidate.hostname, url:normalizedCandidate, reason:inspected.reason || "direct-status" });
          }
        } catch {}
      }
    } catch {}
  }

  // Reader-backed exact-address search is the last cheap discovery tier before
  // opening a real browser. It is bounded so a missing listing cannot stall Rook.
  const exactQuery = ['"' + (address || label) + '"', location, "rental"].filter(Boolean).join(" ");
  const readerSearchUrls = [
    "https://www.google.com/search?q=" + encodeURIComponent(exactQuery),
    "https://www.bing.com/search?q=" + encodeURIComponent(exactQuery)
  ];
  for (const searchUrl of readerSearchUrls) {
    try {
      const reader = await readerText(searchUrl, 5000);
      const match = listingFromReaderIndex(reader, address, label, "search-result", searchUrl);
      if (match?.sourceUrl) {
        return {
          state:"active",
          listing:match,
          checkedAt,
          checkedSources:successfulSources,
          readerSearch:true
        };
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
        const candidateUrl = normalizeSearchResultUrl(link?.href);
        if (!candidateUrl) continue;
        const candidate = new URL(candidateUrl);
        const hostname = candidate.hostname.replace(/^www\./,"");
        if (!isAllowedListingHost(hostname)) continue;
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

  // One targeted ZIP index is a bounded provider fallback. Exact street/unit
  // matching is still required, and it runs only after exact-address search.
  const postalCode = String(address || "").match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || "";
  if (postalCode) {
    const zipIndexUrl = `https://www.zillow.com/${citySlug}-co-${postalCode}/rentals/`;
    try {
      const reader = await readerText(zipIndexUrl, 5000);
      const match = listingFromReaderIndex(reader, address, label, "Zillow", zipIndexUrl);
      if (match?.sourceUrl) {
        return {
          state:"active",
          listing:match,
          checkedAt,
          checkedSources:successfulSources,
          readerIndex:true
        };
      }

      // Some provider indexes expose the full active listing facts but hide the
      // property-page href from reader/search output. An exact street+unit match
      // on the live rental index is still positive availability evidence. Use the
      // index itself as the source instead of incorrectly falling through to the
      // manual "Find listing" state.
      const lines = String(reader || "").split(/\n+/);
      for (let i = 0; i < lines.length; i += 1) {
        const context = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 8)).join(" ");
        if (!contextMatchesAddress(context, address, label)) continue;
        const indexed = fallbackListingFromText(context, zipIndexUrl, { address, label, source:"Zillow" });
        return {
          state:"active",
          listing:{
            ...indexed,
            sourceUrl:zipIndexUrl,
            metadata:{ ...(indexed.metadata || {}), exactIndexMatch:true }
          },
          checkedAt,
          checkedSources:successfulSources,
          readerIndex:true,
          exactIndexMatch:true
        };
      }
    } catch {}
  }

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

function poiQueryVariants(query: string, location: string) {
  const raw = String(query || "").trim().replace(/\s+/g," ");
  if (!raw) return [];
  const hasSuffix = /\b(?:st|street|rd|road|dr|drive|ln|lane|way|ct|court|ave|avenue|blvd|boulevard|pkwy|parkway|pl|place|cir|circle|trl|trail)\.?$/i.test(raw);
  const values:string[] = [];
  const add = (value:string) => {
    const scoped = /,|\b(?:co|colorado)\b|\b\d{5}\b/i.test(value) ? value : [value, location].filter(Boolean).join(", ");
    if (scoped && !values.includes(scoped)) values.push(scoped);
  };
  add(raw);
  if (!hasSuffix) {
    for (const suffix of ["Drive","Road","Street","Way","Lane","Court","Avenue","Place","Trail","Park"]) add(raw + " " + suffix);
  }
  return values;
}

function normalizePoiCandidate(row:any, originalQuery:string) {
  const lat = Number(row?.lat), lng = Number(row?.lon ?? row?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const displayName = String(row?.display_name || row?.name || originalQuery || "").trim();
  const named = String(row?.namedetails?.name || row?.name || "").trim();
  const first = displayName.split(",")[0]?.trim() || "";
  return {
    label:named || first || originalQuery,
    address:displayName || named || originalQuery,
    query:originalQuery,
    lat,
    lng,
    placeType:row?.type || row?.addresstype || row?.class || null,
    source:"OpenStreetMap"
  };
}

async function fetchJsonTimeout(url:string|URL, timeoutMs=5000, headers:Record<string,string>={}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal:controller.signal, headers:{ "accept":"application/json", ...headers } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function searchPoiSuggestions(query:string, location:string, limit=5) {
  const safeLimit = Math.max(1, Math.min(5, Number(limit) || 5));
  const variants = poiQueryVariants(query, location);
  const found:any[] = [];
  const seen = new Set<string>();

  const addPhoton = (payload:any, matchedQuery:string) => {
    for (const feature of Array.isArray(payload?.features) ? payload.features : []) {
      const coords = feature?.geometry?.coordinates || [];
      const props = feature?.properties || {};
      const lat = Number(coords[1]), lng = Number(coords[0]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const parts = [props.name, props.street, props.city, props.county, props.state, props.postcode, props.country].filter(Boolean);
      const address = [...new Set(parts.map(String))].join(", ");
      const candidate = {
        label:String(props.name || props.street || query),
        address:address || String(props.name || query),
        query,
        lat,
        lng,
        placeType:props.type || props.osm_value || props.layer || null,
        source:"OpenStreetMap/Photon",
        matchedQuery
      };
      const key = String(candidate.address || "").toLowerCase() + "|" + candidate.lat.toFixed(5) + "|" + candidate.lng.toFixed(5);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(candidate);
      if (found.length >= safeLimit) break;
    }
  };

  // Photon is deliberately first: it is fuzzy, fast, and supports location bias.
  for (const variant of variants.slice(0, 4)) {
    if (found.length >= safeLimit) break;
    const photon = new URL("https://photon.komoot.io/api");
    photon.searchParams.set("q", variant.replace(/,\s*Fort Collins,?\s*CO$/i,""));
    photon.searchParams.set("limit", String(safeLimit));
    photon.searchParams.set("lang", "en");
    if (/fort\s+collins/i.test(location)) {
      photon.searchParams.set("lat", "40.5853");
      photon.searchParams.set("lon", "-105.0844");
      photon.searchParams.set("zoom", "12");
      photon.searchParams.set("location_bias_scale", "0.05");
    }
    const payload = await fetchJsonTimeout(photon, 5000, { "user-agent":"Rook/1.0 (property map POI search)" });
    addPhoton(payload, variant);
    if (found.length) break;
  }

  // One bounded Nominatim fallback is enough once fuzzy search has run.
  if (!found.length) {
    const q = variants.find(value => /\bdrive\b/i.test(value)) || variants[0];
    if (q) {
      const endpoint = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&dedupe=1&countrycodes=us&limit=" + safeLimit + "&q=" + encodeURIComponent(q);
      const rows = await fetchJsonTimeout(endpoint, 5000, {
        "accept-language":"en-US,en;q=0.9",
        "user-agent":"Rook/1.0 (property map POI search)"
      });
      for (const row of Array.isArray(rows) ? rows : []) {
        const candidate = normalizePoiCandidate(row, query);
        if (!candidate) continue;
        const key = String(candidate.address || "").toLowerCase() + "|" + candidate.lat.toFixed(5) + "|" + candidate.lng.toFixed(5);
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ ...candidate, matchedQuery:q });
        if (found.length >= safeLimit) break;
      }
    }
  }

  const locationTokens = String(location || "").toLowerCase().split(/[,\s]+/).filter(token => token.length > 2);
  const needle = String(query || "").trim().toLowerCase();
  return found.sort((a,b) => {
    const aText = String(a.address || "").toLowerCase(), bText = String(b.address || "").toLowerCase();
    const aLocal = locationTokens.reduce((score, token) => score + (aText.includes(token) ? 1 : 0), 0);
    const bLocal = locationTokens.reduce((score, token) => score + (bText.includes(token) ? 1 : 0), 0);
    const aMatch = needle && String(a.label || a.address || "").toLowerCase().includes(needle) ? 1 : 0;
    const bMatch = needle && String(b.label || b.address || "").toLowerCase().includes(needle) ? 1 : 0;
    return (bLocal - aLocal) || (bMatch - aMatch);
  }).slice(0, safeLimit);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  const url = new URL(req.url);
  const location = url.searchParams.get("location") || "Fort Collins, CO";
  if (url.searchParams.get("poi") === "1") {
    const query = (url.searchParams.get("query") || "").trim();
    const limit = Number(url.searchParams.get("limit") || "5");
    if (!query) return new Response(JSON.stringify({ candidates:[], error:"query required" }), { status:400, headers:corsHeaders });
    const candidates = await searchPoiSuggestions(query, location, limit);
    return new Response(JSON.stringify({ candidates, query, location }), { headers:corsHeaders });
  }
  if (url.searchParams.get("image") === "1") {
    const address = (url.searchParams.get("address") || "").trim();
    const label = (url.searchParams.get("label") || "").trim();
    const sourceUrl = (url.searchParams.get("sourceUrl") || "").trim();
    if (!address && !label && !sourceUrl) return new Response(JSON.stringify({ state:"missing", imageUrl:null, checkedAt:new Date().toISOString(), error:"address, label, or sourceUrl required" }), { status:400, headers:corsHeaders });
    const result = await resolveListingImage(address, label, location, sourceUrl);
    return new Response(JSON.stringify(result), { headers:corsHeaders });
  }
  if (url.searchParams.get("resolve") === "1") {
    const address = (url.searchParams.get("address") || "").trim();
    const label = (url.searchParams.get("label") || "").trim();
    const sourceUrl = (url.searchParams.get("sourceUrl") || "").trim();
    const targetBeds = Number(url.searchParams.get("beds") || "0");
    const targetBaths = Number(url.searchParams.get("baths") || "0");
    if (!address && !label && !sourceUrl) return new Response(JSON.stringify({ state:"unknown", listing:null, checkedAt:new Date().toISOString(), error:"address, label, or sourceUrl required" }), { status:400, headers:corsHeaders });
    const result = await resolveListing(address, label, location, sourceUrl);
    let priceFallback = null;
    if (!(Number(result?.listing?.price) > 0)) {
      priceFallback = await resolveComparablePrice(address, label, location, targetBeds, targetBaths);
      if (!priceFallback && targetBeds > 0) {
        const relaxed = await resolveComparablePrice(address, label, location, 0, targetBaths);
        if (relaxed) {
          const evidenceBeds = [...new Set((relaxed.evidence || []).map((item:any)=>Number(item?.beds || 0)).filter((value:number)=>value>0))];
          const inferredBeds = evidenceBeds.length === 1 ? evidenceBeds[0] : null;
          priceFallback = {
            ...relaxed,
            targetBeds:inferredBeds || targetBeds,
            priceLabel: inferredBeds
              ? "$" + Number(relaxed.price).toLocaleString("en-US") + "/mo (building " + inferredBeds + "BR)"
              : "$" + Number(relaxed.price).toLocaleString("en-US") + "/mo (building comparable)",
            relaxedBedroomMatch:true
          };
        }
      }
    }
    return new Response(JSON.stringify({ ...result, priceFallback }), { headers:corsHeaders });
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
    if (isIncomeRestrictedListing(listing)) return false;
    if (/(mobile home|manufactured home|trailer park)/i.test(text)) return false;
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
