# Rook

Rook is a mobile-first house-hunting workspace for discovering, comparing, visiting, and following up on rentals and homes.

## Architecture

Rook uses one normalized property model and shared behavior across every view. Search providers are adapters: source-specific ingestion normalizes into the core model, while filtering, status, maps, contact tracking, and follow-up behavior stay source-agnostic.

The app works offline first in browser storage. When Supabase is configured, a Google-authenticated user’s properties and detected Gmail/Calendar activity are kept in a durable, private store.

## Enable persistent syncing

1. Create a dedicated Supabase project for Rook. Do not reuse an unrelated project.
2. Apply [the Rook migration](supabase/migrations/20260923000000_create_rook_data.sql). It creates private tables with row-level security; only the signed-in user can read or modify their records.
3. In Supabase Auth, enable Google and configure its Google OAuth client. Add the GitHub Pages URL as an allowed redirect URL.
4. Add the project URL and **publishable** key to `src/config.js`. Never put a secret or service-role key in the repository.
5. In the Google Cloud OAuth consent screen, approve the Gmail read-only and Calendar events read-only scopes used by the Connections dialog.

## Current functionality

- Persistent property data when connected, with local-first fallback
- Rent / buy / shortlist filters and shared property-status behavior
- Listing URL ingestion through the provider-neutral property model
- Google Maps directions and multi-stop routing
- Gmail contact/showing and Calendar showing detection for properties whose label or address appears in the email/event
- GitHub Pages deployment workflow

## Boundaries

Rook intentionally does not scrape listing providers from the browser. Source adapters belong in `src/integrations/providers.js` and must use an approved source API or user-provided import data. Google API credentials and privileged sync work stay outside the public browser bundle.
