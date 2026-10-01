create table if not exists public.rook_discovery_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.rook_discovery_cache enable row level security;
revoke all on public.rook_discovery_cache from anon, authenticated;
grant select, insert, update, delete on public.rook_discovery_cache to service_role;
create index if not exists rook_discovery_cache_expiry on public.rook_discovery_cache(expires_at);
