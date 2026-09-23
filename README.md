# Rook

Rook is a mobile-first house-hunting workspace for discovering, comparing, visiting, and following up on rentals and homes.

## Architecture

Rook uses one normalized property model and shared behavior across every view. Search providers are adapters: source-specific ingestion normalizes into the core model, while filtering, status, maps, contact tracking, and follow-up behavior stay source-agnostic.

### Current scaffold
- Mobile-first property browser
- Persistent shortlist/status store
- Rent / buy / shortlist filters
- Google Maps directions handoff
- Contact, showing, visit, and follow-up domain model
- Provider adapter boundary for future listing sources
- Connector-neutral email event model for Gmail synchronization
- GitHub Pages deployment workflow

### Search defaults
The initial configuration targets 2+ bedroom housing and supports excluding income-restricted listings and mobile-home communities.

## Next integration boundaries

Google Maps visualization should be added behind `src/integrations/maps.js`. Listing sources should register adapters through `src/integrations/providers.js`. Gmail synchronization should translate matching threads into the event schema in `src/integrations/email.js`.

No source-specific behavior should be added directly to property cards or tabs.


### Live listing backend
Rook's browser refresh calls the `rook-listings` Supabase Edge Function. Source-specific discovery/extraction remains server-side. The first live adapters use structured listing data from rental search pages and fail independently; the client continues to consume the stable normalized JSON contract. Cross-source deduplication happens both at the backend boundary and in the client provider layer.

The source boundary is intentionally replaceable: maintained open-source discovery/extraction projects or hosted providers can be added without changing property cards, filters, ranking, shortlist state, or follow-up behavior.


### Search and lifecycle completion

Rook persists location, radius, bedroom and rent limits, property-type selections, housing exclusions, and family-priority preferences. Existing shortlist/visit/rejection history is migrated into local state without overwriting newer browser changes. Production CI checks the live listing backend, regression suite, required mobile viewport, and search controls before Pages deployment.
