import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Messaggio chiaro se le variabili non sono configurate
  console.error("Mancano VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Configura il file .env (o le Environment Variables su Render).");
}

export const supabase = createClient(url || "", key || "", {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const hasConfig = Boolean(url && key);
