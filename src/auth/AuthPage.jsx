import { useState } from "react";
import { supabase, hasConfig } from "../supabaseClient";
import { LogIn, UserPlus, Loader2 } from "lucide-react";

export default function AuthPage() {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null); setMsg(null);
    if (!email.trim() || pw.length < 6) {
      setErr("Inserisci email valida e password di almeno 6 caratteri.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password: pw });
        if (error) throw error;
        setMsg("Registrazione completata. Se richiesta, conferma l'email, poi accedi.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
        // il cambio sessione viene gestito da App
      }
    } catch (e) {
      setErr(traduci(e.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rk-auth">
      <div className="rk-auth-card">
        <div className="rk-auth-brand">
          <span className="rk-chip rk-chip-logo">RACK</span>
          <span className="rk-sub">gestione resell</span>
        </div>

        <h1 className="rk-auth-title">{mode === "login" ? "Accedi" : "Crea account"}</h1>

        {!hasConfig && (
          <p className="rk-auth-err">
            ⚠ Connessione al database non configurata. Imposta le variabili Supabase (vedi README).
          </p>
        )}

        <label className="rk-field">
          <span className="rk-field-label">Email</span>
          <input
            className="rk-input" type="email" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>
        <label className="rk-field rk-mt12">
          <span className="rk-field-label">Password</span>
          <input
            className="rk-input" type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={pw} onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>

        {err && <p className="rk-auth-err">{err}</p>}
        {msg && <p className="rk-auth-msg">{msg}</p>}

        <button className="rk-btn rk-primary rk-auth-submit" disabled={busy || !hasConfig} onClick={submit}>
          {busy ? <Loader2 size={16} className="rk-spin" /> : mode === "login" ? <LogIn size={16} /> : <UserPlus size={16} />}
          {mode === "login" ? "Accedi" : "Registrati"}
        </button>

        <button
          className="rk-auth-switch"
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(null); setMsg(null); }}
        >
          {mode === "login" ? "Non hai un account? Registrati" : "Hai già un account? Accedi"}
        </button>
      </div>
    </div>
  );
}

function traduci(m = "") {
  if (m.includes("Invalid login")) return "Email o password errati.";
  if (m.includes("already registered")) return "Questa email è già registrata. Accedi.";
  if (m.includes("Email not confirmed")) return "Devi prima confermare l'email.";
  if (m.toLowerCase().includes("rate")) return "Troppi tentativi, riprova tra poco.";
  return m || "Errore imprevisto.";
}
