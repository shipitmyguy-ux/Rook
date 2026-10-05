# Laurel Rentals

Open https://shipitmyguy-ux.github.io/Rook/?workspace=laurel-rentals.

This persistent temporary workspace uses the same discovery, rendering and
coordinate resolver as Main. Its boundary lives in
`config/workspace-filters/laurel-rentals.geojson`. The polygon was extracted from
the georeferenced map currently linked by PSD for 2026–27. It is a conservative
raster-derived attendance outline, with approximately 10–30 m uncertainty at
edges. Verify edge addresses and bus eligibility at
https://schoolbus.psdschools.org/Eligibility. Attendance does not guarantee bus
service (walk zones and PSD eligibility rules also apply).

On first opening, this map copies Main's saved price and bedroom preferences.
If those have not been saved, defaults are $2,800/month and 2+ bedrooms. Unknown
prices, unknown bedrooms, outside-zone locations and sales are not displayed
when the corresponding constraints apply. Pins cannot bypass those constraints.

## Rook prompt box

- `under $2400, 3+ bedrooms`
- `only houses`
- `hide 301 Peterson Street` or `remove [full address or listing URL]`
- `restore 301 Peterson Street`
- `add [full address or listing URL]` — existing resolver verifies an active
  rental, then the shared geocoder checks the boundary before adding it.
- `undo` restores the previous session filter/hide state.

These are supported map commands, not an embedded ChatGPT model. Changes persist
in this browser's workspace storage. Hide keeps a listing available for restore.

## ChatGPT beside Rook

A ChatGPT/Codex session with the user's connected Supabase tools can drive this
map through the existing `rook_workspace_property_state` sync. This repository
does not install a new ChatGPT app or grant a new connection. Use workspace ID
`laurel-rentals` only. Other workspaces and Main must be preserved.

- Add: verify the live rental and exact address, qualify its coordinates against
  the GeoJSON, then upsert its property row in this workspace. Include its real
  price, beds, source URL and coordinates; unverified facts cannot meet filters.
- Hide: update that workspace row to `status='rejected'` with a fresh
  `updated_at`; restore with `status='new'`. Do not delete the row to hide it.
- Price/bedrooms: upsert a control row with
  `property_key='__workspace_settings__'`, no address/label, and metadata
  `{"workspacePreferences":{"maxPrice":2400,"minBeds":3}}`. Refresh
  `updated_at` on each change. This control row is never a listing.
- Preserve existing fields and identify an unambiguous property before changes.

The visible filtered map checks shared state every 30 seconds and when it gains
focus. Synced settings are applied once per updated_at version, so subsequent
local edits are retained until another explicit ChatGPT change arrives.

## Shared location fallback

When the existing OSM/publisher resolver cannot locate a numbered address, it
now tries the U.S. Census current address-range geocoder. Exact normalized street
and city matches are required; city centroids are rejected. The existing shared
cache and concurrency controls remain in use. Census points are interpolated
address positions, so boundary-edge addresses still require PSD confirmation.
