import { directListingUrl, LISTING_RESOLVER_VERSION } from '../../../src/core/listing.js';

function tokens(value = '') {
  return String(value).toLowerCase().replace(/&(?:amp|nbsp);/g, ' ')
    .replace(/\b(street|road|drive|avenue|court|lane|boulevard)\b/g, value => ({street:'st',road:'rd',drive:'dr',avenue:'ave',court:'ct',lane:'ln',boulevard:'blvd'})[value])
    .replace(/\b(?:unit|apt|apartment|suite)\s*#?\s*([a-z0-9-]+)/g, ' $1')
    .replace(/[^a-z0-9]/g, '');
}

export function matchesPropertyText(text, property) {
  const address = String(property.address || '').split(',')[0].trim();
  const target = /^\d+\s/.test(address) ? address : property.label;
  const unit = address.match(/(?:\b(?:unit|apt|suite)\s*#?\s*|#\s*)([a-z0-9-]+)/i)?.[1];
  if (unit) {
    const compactUnit = unit.replace(/-/g,'').toLowerCase();
    const words = String(text).toLowerCase().replace(/-/g,'').split(/[^a-z0-9]+/);
    if (!words.includes(compactUnit)) return false;
  }
  return Boolean(target && tokens(target).length >= 8 && tokens(text).includes(tokens(target)));
}

function primaryText(html) {
  const parts = [...html.matchAll(/<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>/gi)].map(m => m[1]);
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/(?:name|property)=["'](?:description|og:title|og:description)["']/i.test(match[0])) continue;
    const content = match[0].match(/content=["']([^"']*)["']/i)?.[1];
    if (content) parts.push(content);
  }
  return parts.join(' ').replace(/<[^>]+>/g, ' ');
}

export function assessListingPage(body, property, { html = false } = {}) {
  const primary = html ? primaryText(body) : '';
  const visible = html ? String(body).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ') : String(body);
  const text = (primary + ' ' + visible).split(/(?:nearby (?:homes|apartments)|similar (?:homes|properties)|you may also like)/i)[0].slice(0, 12000);
  if (/verify you are|captcha|access denied|checking your browser|security verification/i.test(text)) return { state:'unknown', reason:'blocked' };
  // Identity must come from the returned page, never from the request or a snippet.
  if (!matchesPropertyText(html ? primary : text, property)) return { state:'unknown', reason:'property-not-confirmed' };
  const closed = text.match(/\b(off[- ]?market|no longer (?:available|for rent|for sale)|listing (?:has been )?removed|currently unavailable|(?:has been|is now) (?:rented|leased|sold)|not (?:currently )?(?:available|for rent|for sale))\b/i);
  if (closed) return { state:'closed', reason:closed[0] };
  if (html && /"(?:homeStatus|listingStatus|availability)"\s*:\s*"(?:OFF_MARKET|RENTED|SOLD|LEASED|[^"]*SoldOut)"/i.test(body)) return {state:'unknown',reason:'inactive-structured-status'};
  // Historical prices, rent estimates and basic beds/baths are not availability.
  const active = property.listingType === 'buy'
    ? /\bfor sale\b/i.test(text)
    : /\bfor rent\b|\bavailable (?:now|today|units?|apartments?)\b|\bcheck availability\b|\brent(?:al)?\s*(?:from|starting at)\b|\$[\d,]+\s*(?:\/\s*mo|per month|monthly)/i.test(text);
  return active ? { state:'active', reason:'current-offer' } : { state:'unknown', reason:'availability-not-confirmed' };
}

export async function verifyDirectListing(property, { inspect, reader, now = () => new Date().toISOString() }) {
  const checkedAt = now();
  const sourceUrl = directListingUrl(property.sourceUrl);
  const unknown = reason => ({ state:'unknown', listing:null, checkedAt, reason });
  if (!sourceUrl) return unknown('not-a-property-link');
  const response = await inspect(sourceUrl);
  const finalUrl = directListingUrl(response.finalUrl || sourceUrl);
  if (!finalUrl) return unknown('redirected-away-from-property');
  const closed = reason => ({ state:'closed', listing:null, checkedAt,
    evidence:{ confirmed:true, kind:'direct-listing-status', matches:[{url:finalUrl, reason}] } });
  if (response.reason === 'http-404-410') return closed(response.reason);
  let assessment = response.reachable ? assessListingPage(response.html, property, { html:true }) : { state:'unknown' };
  let content = response.html || '';
  let method = 'direct-page';
  if (assessment.state === 'unknown') {
    content = await reader(sourceUrl);
    assessment = assessListingPage(content, property);
    method = 'direct-page-reader';
  }
  if (assessment.state === 'closed') return closed(assessment.reason);
  if (assessment.state !== 'active') return unknown(assessment.reason);
  return { state:'active', checkedAt, content, method, sourceUrl:finalUrl,
    verification:{ confirmed:true, version:LISTING_RESOLVER_VERSION, url:finalUrl, checkedAt, kind:method } };
}
