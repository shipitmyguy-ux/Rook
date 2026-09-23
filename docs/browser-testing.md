# Rook browser testing with Steel

Rook uses the deployed Supabase Edge Function `rook-browser-worker` to drive short-lived Steel Chromium sessions.

## Supported actions

- `ping`
- `start`
- `stop`
- `open`
- `snapshot`
- `screenshot`
- `click`
- `type`
- `select`
- `wait`
- `smoke`

Requests are POST JSON and require the header:

`x-rook-client: rook-web-v1`

The Steel API key remains server-side in Supabase as `STEEL_API_KEY`.

## Deterministic smoke test

The `smoke` action creates a temporary Steel session, opens the live Rook GitHub Pages site, verifies the Rook title/header, clicks the Rent filter, types `Timberwood` into search, verifies the filtered DOM state, captures a screenshot, and releases the session in a `finally` block.

Target:

`https://shipitmyguy-ux.github.io/Rook/`

A successful response includes `ok: true`, initial/final DOM state, the temporary Steel session ID/viewer URL, and `screenshotBytes`.

## Chat-driven verification

The current ChatGPT-connected Supabase tooling can invoke the worker through `pg_net`, which means browser smoke tests can be started and inspected directly from normal chat without a Work-mode browser handoff.

The worker is intentionally bounded to the actions above. Add new browser actions only when they are deterministic and reusable.
