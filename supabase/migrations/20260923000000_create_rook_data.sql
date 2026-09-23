create table if not exists public.rook_properties (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (char_length(id) <= 200),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.rook_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.rook_external_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('gmail', 'calendar')),
  external_id text not null,
  property_id text,
  kind text not null,
  occurred_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, source, external_id)
);

alter table public.rook_properties enable row level security;
alter table public.rook_preferences enable row level security;
alter table public.rook_external_events enable row level security;

create policy "Users manage their Rook properties" on public.rook_properties
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their Rook preferences" on public.rook_preferences
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their Rook external events" on public.rook_external_events
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.rook_properties, public.rook_preferences, public.rook_external_events to authenticated;
