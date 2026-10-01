# Discovery depth and speed

Rook now collects candidates throughout a bounded browser scan instead of retaining only the final viewport. Each scan uses one browser connection, up to four pagination/load-more batches, sixteen collection steps, 1,600 links, and an eighteen-second discovery budget. Sessions are released in a finally block. Numbered pagination follows observed links for HotPads, Zillow, Apartments.com, Realtor and query-based page controls. Same-origin JSON responses and rendered schema data are captured without replaying hidden APIs.

Structured discovery follows up to three additional observed page links concurrently. This returns 160 HotPads records across four pages in the live check. Source discovery and structured reads run concurrently; duplicate candidates are normalized before validation, including postal-code and street-suffix variants, while explicit units remain distinct.

A service-only, RLS-enabled cache stores source snapshots for five minutes, or one minute for degraded sources. Scan continuations persist across requests; every fourth continuation returns to the first page. Candidate retention is capped at 24 hours and 500 records per source. Shared verification caches retain only positively verified results for fifteen minutes without advancing the original verification timestamp. Local daily verification and unknown-result cooldowns remain in place.

The frontend consumes progressive NDJSON batches, shows per-source counts and degradation, and begins direct validation as sources finish. A five-worker validation pool drains due candidates and renders each completion. Search discovery uses separate house/townhome/duplex, condo/apartment, and owner queries across ten domains, with at most ten concurrent searches. Ignored identities are persisted separately and skipped during discovery merge and image enrichment. Missing property kinds enter enrichment without relaxing the visible feed's type filter.

Candidates are never availability evidence. Existing direct-page/reader validation still requires the matching property, positive rental availability, the correct unit, a direct URL, and current verification. Unknown responses remain unknown. Price, bedroom, restricted-housing, mobile-home and selected-type filters remain active.

## Validation on October 1, 2026

- Baseline: 30 discovery candidates with `minBeds=2` and no price filter.
- Expanded structured/browser run: 183 candidates before the final address-format dedupe; 163 positive direct verifications, representing 135 distinct properties after dedupe. Twenty checks remained unknown.
- Applying 2+ bedrooms, a $3,000 cap, and the default apartment/townhome/house types to verified facts: 84 properties with known price and bedroom facts; two additional records had incomplete facts.
- Cold discovery: approximately 20 seconds. Warm progressive run: first candidate batch in 0.8 seconds; five source cache hits. Blocked sources can still determine final completion time, while successful cached sources render immediately.
- 76 regression and discovery tests passed locally. CI also runs backend parsing, desktop/mobile rendered QA and a live discovery/verification smoke check.

Portal challenges and variable inventory make exact counts fluctuate. A degraded adapter is shown as limited rather than complete. Absence from an index never closes a listing.

## Next coverage and speed work

1. Integrate licensed/direct search feeds for Realtor and Apartments.com, which intermittently return rate limits or challenges. More scrolling cannot recover a blocked feed.
2. Add source-specific adapters for JSON schemas that currently lack direct URLs, and normalize bedroom/rent ranges to individual available units. Range-level prices should not be treated as a verified price for a specific unit.
3. Move very long enrichment runs to persisted jobs with resumable progress. The current browser and discovery requests remain bounded, while frontend verification already progresses independently.
4. Add reliable geographic coverage checks against the configured radius and source totals. Current adapters target city search pages; a radius preference should eventually be enforced from trustworthy coordinates rather than inferred street text.

The GitHub Pages workflow deploys the frontend. Backend functions are deployed separately through Supabase; changing their source in GitHub alone does not update production.
