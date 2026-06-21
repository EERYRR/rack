-- ============================================================
--  RACK — fix: "new row violates row-level security policy
--  for table workspaces" on Create team / Join team.
--  Paste ALL of this in Supabase SQL Editor and press RUN.
--  Safe to run multiple times.
-- ============================================================

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
