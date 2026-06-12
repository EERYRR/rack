-- ============================================================
--  RACK — schema database per Supabase
--  Incolla TUTTO questo file nel SQL Editor di Supabase e premi RUN.
--  Crea le tabelle, i ruoli utente e la sicurezza (ogni utente
--  vede SOLO i propri dati).
-- ============================================================

-- ---------- PROFILI (uno per utente registrato) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  role        text not null default 'reseller',  -- 'admin' = vede tutto | 'reseller' = niente sezione fornitore
  pct         numeric not null default 5,
  phones      jsonb not null default '["Account 1","Account 2","Account 3","Account 4"]'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- ARTICOLI (stock) ----------
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  sku         text,
  brand       text,
  nome        text,
  categoria   text,
  taglia      text,
  costo       numeric not null default 0,
  telefono    text default '',
  stato       text not null default 'stock',   -- stock | caricato | venduto | regalato
  fisico      text not null default 'casa',     -- ordinato | viaggio | casa
  vinted      boolean not null default false,   -- pubblicato su Vinted sì/no
  data        date,
  note        text default '',
  created_at  timestamptz not null default now()
);

-- ---------- VENDITE ----------
create table if not exists public.sales (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  item_id       uuid,
  sku           text,
  nome          text,
  brand         text,
  prezzo        numeric not null default 0,
  costo         numeric not null default 0,
  costi_vendita numeric not null default 0,
  canale        text default 'Vinted',
  data          date,
  telefono      text default '',
  created_at    timestamptz not null default now()
);

-- ---------- SPESE ----------
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  tipo        text,
  importo     numeric not null default 0,
  data        date,
  nota        text default '',
  telefono    text default '',
  sale_id     uuid,                              -- collega la spesa alla vendita che l'ha generata
  created_at  timestamptz not null default now()
);

-- ---------- CREDITI / SALDO FORNITORE (solo admin) ----------
create table if not exists public.credits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  tipo           text not null,                  -- 'in' = credito maturato | 'pagamento' = soldi mandati al fornitore
  ordine         numeric not null default 0,
  importo        numeric not null default 0,
  usato_credito  numeric not null default 0,
  contanti       numeric not null default 0,
  data           date,
  nota           text default '',
  created_at     timestamptz not null default now()
);

-- ---------- ORDINI / TRACKING ----------
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  tracking    text default '',
  corriere    text default '',
  nota        text default '',
  data        date,
  stato       text not null default 'in_viaggio', -- in_viaggio | consegnato
  item_ids    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- ============================================================
--  SICUREZZA: Row Level Security
--  Ogni utente legge/scrive SOLO le righe con il proprio user_id.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.items    enable row level security;
alter table public.sales    enable row level security;
alter table public.expenses enable row level security;
alter table public.credits  enable row level security;
alter table public.orders   enable row level security;

-- profili: ognuno vede e modifica solo il proprio
drop policy if exists "profiles self" on public.profiles;
create policy "profiles self" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- helper macro: stessa policy per le tabelle dati
do $$
declare t text;
begin
  foreach t in array array['items','sales','expenses','credits','orders']
  loop
    execute format('drop policy if exists "owner all" on public.%I;', t);
    execute format(
      'create policy "owner all" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid());', t);
  end loop;
end $$;

-- ============================================================
--  Crea automaticamente il profilo quando un utente si registra.
--  Default: 'reseller' (vista ridotta). Vedi sotto per promuoverti admin.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
--  DOPO esserti registrato la prima volta nell'app, torna qui e
--  lancia questa riga (con la TUA email) per diventare admin e
--  sbloccare la sezione fornitore/percentuale:
--
--  update public.profiles set role = 'admin' where email = 'TUA_EMAIL@esempio.com';
-- ============================================================
