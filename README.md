# RACK — gestione resell

App web per gestire stock, vendite, spese, ordini e saldo fornitore.
Multi-utente con login: ogni account vede solo i propri dati.
Due ruoli: **admin** (vede tutto, incluso il saldo fornitore) e **reseller** (vista ridotta, non vede la sezione fornitore/percentuale).

---

## Cosa ti serve (tutto gratis)
- Un account **GitHub** (ce l'hai già)
- Un account **Supabase** → https://supabase.com (database + login)
- Un account **Render** → https://render.com (l'hai già, è dove gira fansale-api)

Tempo totale: ~30 minuti la prima volta. Poi ogni modifica va online da sola.

---

## PARTE 1 — Database e login (Supabase)

1. Vai su https://supabase.com → **New project**. Dai un nome (es. `rack`), scegli una password per il database (salvala), regione Europe (Frankfurt). Attendi ~2 minuti che si crei.
2. Nel menu a sinistra apri **SQL Editor** → **New query**.
3. Apri il file `supabase-schema.sql` di questo progetto, **copia tutto**, incollalo nell'editor e premi **RUN**. Deve dire "Success". Questo crea tabelle, ruoli e sicurezza.
4. Vai su **Project Settings** (ingranaggio in basso) → **API**. Ti servono due valori:
   - **Project URL** (es. `https://abcd1234.supabase.co`)
   - **anon public** key (una stringa lunga che inizia con `eyJ...`)
   Tienili da parte: servono nella Parte 3.
5. (Consigliato) **Authentication → Providers → Email**: per partire veloce, **disattiva "Confirm email"** così puoi accedere subito senza dover confermare via mail. Potrai riattivarlo dopo.

---

## PARTE 2 — Codice su GitHub

1. Crea un nuovo repository su GitHub (es. `rack`), privato.
2. Carica dentro **tutta la cartella `rack/`** di questo progetto (tutti i file: `src/`, `package.json`, `index.html`, ecc.). Puoi farlo da web con "Add file → Upload files", oppure da terminale:
   ```bash
   cd rack
   git init
   git add .
   git commit -m "RACK iniziale"
   git branch -M main
   git remote add origin https://github.com/TUO-UTENTE/rack.git
   git push -u origin main
   ```
   ⚠ Il file `.env` NON va caricato (è già escluso da `.gitignore`). Le chiavi le metti su Render nella Parte 3.

---

## PARTE 3 — Pubblicazione (Render)

1. Su https://render.com → **New +** → **Static Site**.
2. Collega il repository GitHub `rack`.
3. Imposta:
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
4. Apri **Advanced → Add Environment Variable** e aggiungi i due valori della Parte 1:
   - `VITE_SUPABASE_URL` = il tuo Project URL
   - `VITE_SUPABASE_ANON_KEY` = la tua anon public key
5. **Create Static Site**. Render compila e pubblica. Dopo qualche minuto avrai un indirizzo tipo `https://rack-xxxx.onrender.com`.
6. **IMPORTANTE per il routing SPA:** in Render, sezione **Redirects/Rewrites**, aggiungi una regola:
   - Source: `/*`  →  Destination: `/index.html`  →  Action: **Rewrite**
   Così l'app funziona anche ricaricando le pagine.

---

## PARTE 4 — Diventa admin e usala sul telefono

1. Apri l'indirizzo `.onrender.com` → **Registrati** con la tua email e una password.
2. Torna su Supabase → **SQL Editor** e lancia (con la TUA email):
   ```sql
   update public.profiles set role = 'admin' where email = 'TUA_EMAIL@esempio.com';
   ```
   Esci e rientra nell'app: ora vedi la scheda **Saldo fornitore**.
3. Sul telefono: apri l'indirizzo in Safari/Chrome → menu **Condividi** → **Aggiungi a Home**. Avrai l'icona RACK come un'app vera, a schermo intero.

### Onboardare un reseller
Gli dai l'indirizzo, lui si registra: nasce automaticamente come **reseller** e NON vede la scheda fornitore né la percentuale. Tu resti l'unico admin. Ogni reseller vede solo i propri dati.

---

## Costi (verificati giugno 2026)
- **Supabase**: gratis fino a 500 MB di database e 50.000 utenti — per te €0 a lungo. Piano Pro $25/mese solo quando crescerai molto.
- **Render Static Site**: gratis per un'app come questa.
- In pratica: **€0/mese** finché non hai numeri grossi.

> Nota sul piano gratuito Supabase: se il progetto resta **inattivo per 7 giorni** va in pausa (si riattiva con un click). Usandolo regolarmente non succede. Sul gratuito non ci sono backup automatici: se i dati diventano importanti, valuta il piano Pro o un backup periodico.

---

## Sviluppo in locale (facoltativo)
```bash
cd rack
cp .env.example .env     # poi incolla URL e anon key dentro .env
npm install
npm run dev              # apri http://localhost:5173
```

---

## Sicurezza — nota onesta
La separazione dei dati tra utenti è garantita a livello di database (Row Level Security di Supabase): nessun utente può leggere i dati di un altro, nemmeno manipolando il codice nel browser. La sezione "fornitore" nascosta ai reseller è una scelta di interfaccia: dato che ogni reseller vede comunque solo i propri dati, per il tuo scopo (non mostrargli il meccanismo della percentuale) è sufficiente.
