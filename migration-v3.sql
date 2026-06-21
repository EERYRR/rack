-- ============================================================
--  RACK — update v3: shared workspaces, roles, seller payouts
--  Paste ALL of this in Supabase SQL Editor and press RUN (once).
--  Self-contained: includes the v2 columns too, so running this
--  single file brings any database fully up to date.
--  Existing data is migrated into a personal workspace.
-- ============================================================

-- ---- v2 columns (idempotent) ----
alter table public.sales add column if not exists reso text not null default 'no';
alter table public.items add column if not exists caricato_at timestamptz;
alter table public.sales add column if not exists giacenza_giorni integer;
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  testo text not null,
  fatto boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.todos enable row level security;

-- ============================================================
--  v3
-- ============================================================

-- 1) WORKSPACES (the shared "team")
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'My team',
  join_code   text not null unique,
  pct         numeric not null default 5,          -- supplier intermediation %
  seller_base numeric not null default 8,          -- € per sale
  seller_bonus numeric not null default 10,        -- € per sale if 5+/day
  bonus_threshold integer not null default 5,       -- sales/day to unlock bonus
  phones      jsonb not null default '["Account 1","Account 2","Account 3","Account 4"]'::jsonb,
  created_at  timestamptz not null default now()
);

-- 2) MEMBERSHIPS (who belongs to a workspace, and their role)
--    roles: 'manager' (full control) | 'investor' (view all) | 'seller' (operate & sell)
create table if not exists public.memberships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'seller',
  display_name text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- 3) helper: which workspaces does the current user belong to
create or replace function public.my_workspace_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select workspace_id from public.memberships where user_id = auth.uid()
$$;

-- 4) add workspace_id + seller_id to data tables
alter table public.items    add column if not exists workspace_id uuid references public.workspaces on delete cascade;
alter table public.sales    add column if not exists workspace_id uuid references public.workspaces on delete cascade;
alter table public.sales    add column if not exists seller_id uuid;       -- who made the sale
alter table public.expenses add column if not exists workspace_id uuid references public.workspaces on delete cascade;
alter table public.credits  add column if not exists workspace_id uuid references public.workspaces on delete cascade;
alter table public.orders   add column if not exists workspace_id uuid references public.workspaces on delete cascade;
alter table public.todos    add column if not exists workspace_id uuid references public.workspaces on delete cascade;

-- 5) MIGRATE existing rows: give every existing user a personal workspace
do $$
declare u record; wid uuid; code text;
begin
  for u in (select distinct id, email from auth.users) loop
    -- skip if the user already has a membership
    if exists (select 1 from public.memberships m where m.user_id = u.id) then
      continue;
    end if;
    code := upper(substr(md5(random()::text), 1, 6));
    insert into public.workspaces (name, join_code) values (coalesce(split_part(u.email,'@',1),'team')||'-team', code)
      returning id into wid;
    insert into public.memberships (workspace_id, user_id, role, display_name)
      values (wid, u.id, 'manager', split_part(u.email,'@',1));
    update public.items    set workspace_id = wid where user_id = u.id and workspace_id is null;
    update public.sales    set workspace_id = wid, seller_id = u.id where user_id = u.id and workspace_id is null;
    update public.expenses set workspace_id = wid where user_id = u.id and workspace_id is null;
    update public.credits  set workspace_id = wid where user_id = u.id and workspace_id is null;
    update public.orders   set workspace_id = wid where user_id = u.id and workspace_id is null;
    update public.todos    set workspace_id = wid where user_id = u.id and workspace_id is null;
    -- carry the user's saved pct + phones into the workspace
    update public.workspaces set
      pct = coalesce((select pct from public.profiles where id = u.id), 5),
      phones = coalesce((select phones from public.profiles where id = u.id), phones)
    where id = wid;
  end loop;
end $$;

-- 6) RLS: replace per-user policies with per-workspace policies
alter table public.workspaces  enable row level security;
alter table public.memberships enable row level security;

-- workspaces: a member can read its workspace; managers can update it
drop policy if exists "ws read" on public.workspaces;
create policy "ws read" on public.workspaces for select using (id in (select public.my_workspace_ids()));
drop policy if exists "ws insert" on public.workspaces;
create policy "ws insert" on public.workspaces for insert with check (true);
drop policy if exists "ws update" on public.workspaces;
create policy "ws update" on public.workspaces for update
  using (id in (select workspace_id from public.memberships where user_id = auth.uid() and role = 'manager'));

-- memberships: you can read memberships of your workspaces; you can insert your own membership (join)
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

-- data tables: members of the workspace can read/write
do $$
declare t text;
begin
  foreach t in array array['items','sales','expenses','credits','orders','todos']
  loop
    execute format('drop policy if exists "owner all" on public.%I;', t);
    execute format('drop policy if exists "ws all" on public.%I;', t);
    execute format(
      'create policy "ws all" on public.%I for all using (workspace_id in (select public.my_workspace_ids())) with check (workspace_id in (select public.my_workspace_ids()));', t);
  end loop;
end $$;

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
