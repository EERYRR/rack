-- ============================================================
--  RACK — fix: error when changing a member's role.
--  Removes the self-referencing policies that cause a recursion
--  error and routes role changes through a secure function.
--  Paste ALL of this in Supabase SQL Editor and press RUN.
-- ============================================================

-- helper: is the current user a manager of this workspace? (bypasses RLS, no recursion)
create or replace function public.is_workspace_manager(p_ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where workspace_id = p_ws and user_id = auth.uid() and role = 'manager'
  );
$$;

-- rewrite the policies that referenced memberships directly (the cause of the error)
drop policy if exists "mb manage" on public.memberships;
create policy "mb manage" on public.memberships for update
  using (public.is_workspace_manager(workspace_id))
  with check (public.is_workspace_manager(workspace_id));

drop policy if exists "mb delete" on public.memberships;
create policy "mb delete" on public.memberships for delete
  using (user_id = auth.uid() or public.is_workspace_manager(workspace_id));

drop policy if exists "ws update" on public.workspaces;
create policy "ws update" on public.workspaces for update
  using (public.is_workspace_manager(id))
  with check (public.is_workspace_manager(id));

-- secure function the app calls to change a member's role (manager only)
create or replace function public.set_member_role(p_membership_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if p_role not in ('manager', 'investor', 'seller') then raise exception 'invalid role'; end if;
  select workspace_id into ws from public.memberships where id = p_membership_id;
  if ws is null then raise exception 'membership not found'; end if;
  if not public.is_workspace_manager(ws) then raise exception 'only a manager can change roles'; end if;
  update public.memberships set role = p_role where id = p_membership_id;
end $$;
grant execute on function public.set_member_role(uuid, text) to authenticated;
