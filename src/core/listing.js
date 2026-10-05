// A stored URL is a candidate, never proof that a listing is still available.
export const LISTING_RESOLVER_VERSION = 5;
export const LISTING_MAX_AGE = 24 * 60 * 60 * 1000;

export function directListingUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname;
    if (/(^|\.)(google\.com|bing\.com|duckduckgo\.com|example\.com)$/.test(host)) return null;
    if (/\/(search|rentals|apartments-for-rent|homes-for-rent)\/?$/i.test(path) || url.searchParams.has('q')) return null;
    const portalPaths = {
      'zillow.com': /^\/(homedetails|apartments|b)\/.+/,
      'trulia.com': /^\/(home|p|building)\/.+/,
      'realtor.com': /^\/(rentals\/details|realestateandhomes-detail)\/.+/,
      'rent.com': /(?:^\/apartment\/.+|\/[^/]+-4-\d+)/,
      'apartments.com': /^\/[^/]+\/[a-z0-9]{6,}\/?$/i,
      'apartmentlist.com': /^\/[^/]+\/[^/]+\/[^/]+/,
      'redfin.com': /\/home\/\d+/,
      'forrent.com': /^\/[^/]+\/[^/]+\/[^/]+\/[^/]+/,
      'hotpads.com': /\/[^/]+\/pad(?:\/|$)/,
    };
    const rule = Object.entries(portalPaths).find(([domain]) => host === domain || host.endsWith('.' + domain))?.[1];
    if (rule && !rule.test(path)) return null;
    return url.href;
  } catch { return null; }
}

export function confirmedClosed(property) {
  return property?.listingState === 'closed' && property?.metadata?.listingClosedEvidence?.confirmed === true;
}

// Keep closed records for history and future rechecks, but never render them on a map.
export function mapListings(properties = []) {
  return properties.filter(property => !confirmedClosed(property));
}

export function hasVerifiedListing(property, now = Date.now()) {
  const url = directListingUrl(property?.sourceUrl);
  const evidence = property?.metadata?.listingVerification;
  const checked = Date.parse(property?.listingCheckedAt || '');
  return Boolean(url && property.listingState === 'active' && !confirmedClosed(property)
    && evidence?.confirmed === true && evidence.version >= LISTING_RESOLVER_VERSION
    && directListingUrl(evidence.url) === url && Number.isFinite(checked)
    && checked <= now && now - checked < LISTING_MAX_AGE);
}

export function needsListingCheck(property, now = Date.now()) {
  if (['rejected', 'archived'].includes(property.status) || property.type === 'Rental area') return false;
  if (!property.address && !property.label && !directListingUrl(property.sourceUrl)) return false;
  if (Number(property.metadata?.listingResolverVersion || 0) < LISTING_RESOLVER_VERSION) return true;
  const alternatives = property.metadata?.sourceUrls || [];
  const checkedSources = property.metadata?.listingCheckedSourceUrls || [];
  if (property.listingState === "unknown" && alternatives.length > 1 && alternatives.some(url => !checkedSources.includes(url))) return true;
  const checked = Date.parse(property.listingCheckedAt || '');
  const cooldown = property.listingState === 'unknown' ? 30 * 60 * 1000 : LISTING_MAX_AGE;
  return !Number.isFinite(checked) || checked > now || now - checked >= cooldown;
}

export function listingAction(property, now = Date.now()) {
  if (confirmedClosed(property)) return { url:null, closed:true, resolving:false };
  if (hasVerifiedListing(property, now)) return { url:directListingUrl(property.sourceUrl), closed:false, resolving:false };
  const url = directListingUrl(property?.sourceUrl);
  return { url, closed:false, resolving:needsListingCheck(property, now), candidate:Boolean(url) };
}
