-- ============================================================
--  RACK — aggiornamento v2 (resi + giacenza + to-do)
--  Incolla TUTTO nel SQL Editor di Supabase e premi RUN (una volta).
--  Aggiorna un database creato con la PRIMA versione dello schema.
-- ============================================================

-- resi sulle vendite
alter table public.sales add column if not exists reso text not null default 'no';
-- valori: no | in_arrivo | spedito | consegnato

-- giacenza: quando un pezzo viene "caricato" salviamo il momento
alter table public.items add column if not exists caricato_at timestamptz;

-- giorni di giacenza calcolati al momento della vendita
alter table public.sales add column if not exists giacenza_giorni integer;

-- to-do / note rapide
create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  testo       text not null,
  fatto       boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.todos enable row level security;
drop policy if exists "owner all" on public.todos;
create policy "owner all" on public.todos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
