-- ============================================================
--  RACK — full database schema for Supabase (fresh install)
--  Paste ALL of this in the SQL Editor and press RUN.
--  Creates shared workspaces, roles and per-workspace security.
--  (If you already created the DB with an older schema, run
--   migration-v3.sql instead.)
-- ============================================================

-- ---------- PROFILES (one per registered user) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

-- ---------- WORKSPACES (the shared team) ----------
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'My team',
  join_code   text not null unique,
  pct         numeric not null default 5,
  seller_base numeric not null default 8,
  seller_bonus numeric not null default 10,
  bonus_threshold integer not null default 5,
  phones      jsonb not null default '["Account 1","Account 2","Account 3","Account 4"]'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- MEMBERSHIPS (who belongs, and their role) ----------
-- roles: 'manager' | 'investor' | 'seller'
create table if not exists public.memberships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'seller',
  display_name text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create or replace function public.my_workspace_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select workspace_id from public.memberships where user_id = auth.uid()
$$;

-- ---------- DATA TABLES ----------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid references public.workspaces on delete cascade,
  sku text, brand text, nome text, categoria text, taglia text,
  costo numeric not null default 0, telefono text default '',
  stato text not null default 'stock', fisico text not null default 'casa',
  vinted boolean not null default false, caricato_at timestamptz,
  data date, note text default '', created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid references public.workspaces on delete cascade,
  seller_id uuid,
  item_id uuid, sku text, nome text, brand text,
  prezzo numeric not null default 0, costo numeric not null default 0,
  costi_vendita numeric not null default 0, canale text default 'Vinted',
  data date, telefono text default '', reso text not null default 'no',
  giacenza_giorni integer, created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid references public.workspaces on delete cascade,
  tipo text, importo numeric not null default 0, data date,
  nota text default '', telefono text default '', sale_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid references public.workspaces on delete cascade,
  tipo text not null, ordine numeric not null default 0,
  importo numeric not null default 0, usato_credito numeric not null default 0,
  contanti numeric not null default 0, data date, nota text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid references public.workspaces on delete cascade,
  tracking text default '', corriere text default '', nota text default '',
  data date, stato text not null default 'in_viaggio',
  item_ids jsonb not null default '[]'::jsonb, created_at timestamptz not null default now()
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  workspace_id uuid references public.workspaces on delete cascade,
  testo text not null, fatto boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
--  SECURITY (Row Level Security)
-- ============================================================
alter table public.profiles    enable row level security;
alter table public.workspaces  enable row level security;
alter table public.memberships enable row level security;
alter table public.items    enable row level security;
alter table public.sales    enable row level security;
alter table public.expenses enable row level security;
alter table public.credits  enable row level security;
alter table public.orders   enable row level security;
alter table public.todos    enable row level security;

-- profiles: each user reads/writes only their own
drop policy if exists "profiles self" on public.profiles;
create policy "profiles self" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

-- workspaces
drop policy if exists "ws read" on public.workspaces;
create policy "ws read" on public.workspaces for select using (id in (select public.my_workspace_ids()));
drop policy if exists "ws insert" on public.workspaces;
create policy "ws insert" on public.workspaces for insert with check (true);
drop policy if exists "ws update" on public.workspaces;
create policy "ws update" on public.workspaces for update
  using (id in (select workspace_id from public.memberships where user_id = auth.uid() and role = 'manager'));

-- memberships
drop policy if exists "mb read" on public.memberships;
create policy "mb read" on public.memberships for select using (workspace_id in (select public.my_workspace_ids()));
drop policy if exists "mb join" on public.memberships;
create policy "mb join" on public.memberships for insert with check (user_id = auth.uid());
drop policy if exists "mb manage" on public.memberships;
create policy "mb manage" on public.memberships for update
  using (workspace_id in (select workspace_id from public.memberships where user_id = auth.uid() and role = 'manager'));
drop policy if exists "mb delete" on public.memberships;
create policy "mb delete" on public.memberships for delete
  using (user_id = auth.uid() or workspace_id in (select workspace_id from public.memberships where user_id = auth.uid() and role = 'manager'));

-- data tables: any workspace member can read/write
do $$
declare t text;
begin
  foreach t in array array['items','sales','expenses','credits','orders','todos']
  loop
    execute format('drop policy if exists "ws all" on public.%I;', t);
    execute format(
      'create policy "ws all" on public.%I for all using (workspace_id in (select public.my_workspace_ids())) with check (workspace_id in (select public.my_workspace_ids()));', t);
  end loop;
end $$;

-- create the profile row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---- secure team create/join helpers ----
-- Secure helper that creates a team AND your manager membership
-- atomically, bypassing the chicken-and-egg RLS problem.
create or replace function public.create_team(p_name text, p_display text)
returns uuid language plpgsql security definer set search_path = public as $$
declare wid uuid; code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.workspaces (name, join_code)
    values (coalesce(nullif(trim(p_name), ''), 'My team'), code)
    returning id into wid;
  insert into public.memberships (workspace_id, user_id, role, display_name)
    values (wid, auth.uid(), 'manager', nullif(trim(p_display), ''));
  return wid;
end $$;
grant execute on function public.create_team(text, text) to authenticated;

-- Secure helper to join an existing team by its code (you become 'seller').
create or replace function public.join_team(p_code text, p_display text)
returns uuid language plpgsql security definer set search_path = public as $$
declare wid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into wid from public.workspaces where join_code = upper(trim(p_code));
  if wid is null then raise exception 'Invalid team code'; end if;
  insert into public.memberships (workspace_id, user_id, role, display_name)
    values (wid, auth.uid(), 'seller', nullif(trim(p_display), ''))
    on conflict (workspace_id, user_id) do nothing;
  return wid;
end $$;
grant execute on function public.join_team(text, text) to authenticated;
-- flag: was this workspace created as a team?
alter table public.workspaces add column if not exists is_team boolean not null default false;

-- create_team now takes a flag (solo = personal space, team = multi-person)
create or replace function public.create_team(p_name text, p_display text, p_is_team boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare wid uuid; code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.workspaces (name, join_code, is_team)
    values (coalesce(nullif(trim(p_name), ''), 'My space'), code, coalesce(p_is_team, true))
    returning id into wid;
  insert into public.memberships (workspace_id, user_id, role, display_name)
    values (wid, auth.uid(), 'manager', nullif(trim(p_display), ''));
  return wid;
end $$;
grant execute on function public.create_team(text, text, boolean) to authenticated;

-- when someone joins by code, the workspace becomes a team automatically
create or replace function public.join_team(p_code text, p_display text)
returns uuid language plpgsql security definer set search_path = public as $$
declare wid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into wid from public.workspaces where join_code = upper(trim(p_code));
  if wid is null then raise exception 'Invalid team code'; end if;
  insert into public.memberships (workspace_id, user_id, role, display_name)
    values (wid, auth.uid(), 'seller', nullif(trim(p_display), ''))
    on conflict (workspace_id, user_id) do nothing;
  update public.workspaces set is_team = true where id = wid;   -- joining makes it a team
  return wid;
end $$;
grant execute on function public.join_team(text, text) to authenticated;
