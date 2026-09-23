# Listing source strategy

Rook should reuse maintained discovery/extraction projects before adding portal-specific parsers.

## Pipeline

1. **Discovery** — obtain candidate listing URLs/results from reusable discovery implementations.
2. **Extraction** — normalize listing pages/results using an existing extractor when practical.
3. **Rook backend adapter** — translate external fields into the Rook listing contract.
4. **Rook core** — filtering, deduplication, ranking, lifecycle state, follow-up and UI remain source-independent.

## Preferred reusable components

### PropertyWebScraper
Repository: https://github.com/RealEstateWebTools/property_web_scraper

Use as the preferred extraction/normalization layer for supported property portals. Keep it behind the backend boundary so Rook can replace or upgrade it without client changes.

### Spider web-scraping examples
Repository: https://github.com/spider-rs/web-scraping-examples

Evaluate its existing real-estate examples for discovery/source implementations before writing custom Zillow, Redfin, Realtor, Trulia, HotPads, Rent.com or Homes.com logic.

## Rules

- Do not add portal selectors/parsers to the Rook browser client.
- Do not write a custom scraper until an existing maintained implementation has been tested and rejected for a documented reason.
- Preserve the original listing URL and source name.
- Normalize only at adapter boundaries.
- A failure in one source must not prevent other sources from returning results.
- Prefer free/open-source implementations first. Hosted scraping services are fallback adapters when reliability or anti-bot behavior makes self-hosted extraction impractical.
- Keep source-specific tests separate from Rook core tests.

## Backend contract

The public Rook listing endpoint returns:

```json
{
  "listings": [],
  "meta": {
    "location": "Fort Collins, CO",
    "count": 0,
    "generatedAt": "ISO-8601",
    "adapters": []
  }
}
```

Each adapter should emit enough information to populate the normalized Rook property model: source ID/URL, address/label, listing type, price, beds, baths, coordinates when available, property type, description/metadata, and source attribution.


## Current production adapters

The Supabase `rook-listings` boundary currently probes Realtor.com, Rent.com, and Apartment List independently. CI requires the backend to return at least one real Fort Collins listing before a Pages deployment is allowed. Adapter health is returned in `meta.adapters`; rate limiting or failure from one portal does not suppress healthy sources.
