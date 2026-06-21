-- ============================================================
--  RACK — add "solo vs team" mode.
--  Paste ALL of this in Supabase SQL Editor and press RUN.
--  Safe to run multiple times.
-- ============================================================

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
