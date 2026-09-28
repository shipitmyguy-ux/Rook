import { normalizeProperty } from '../src/core/property.js';
import { LISTING_RESOLVER_VERSION } from '../src/core/listing.js';
export function verifiedProperty(input = {}) {
  const url = input.sourceUrl || 'https://listings.example.test/home';
  const checkedAt = input.listingCheckedAt || new Date().toISOString();
  return normalizeProperty({ ...input, sourceUrl:url, listingState:'active', listingCheckedAt:checkedAt,
    metadata:{ ...input.metadata, listingResolverVersion:LISTING_RESOLVER_VERSION,
      listingVerification:{ confirmed:true, version:LISTING_RESOLVER_VERSION, url, checkedAt } } });
}
export function verification(url) { return { confirmed:true, version:LISTING_RESOLVER_VERSION, url }; }
