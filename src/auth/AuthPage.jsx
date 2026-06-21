import { useState } from "react";
import { supabase, hasConfig } from "../supabaseClient";
import { LogIn, UserPlus, Loader2 } from "lucide-react";

export default function AuthPage({ onDemo }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null); setMsg(null);
    if (!email.trim() || pw.length < 6) { setErr("Enter a valid email and a password of at least 6 characters."); return; }
    setBusy(true);
    try {
      if (mode === "register") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password: pw });
        if (error) throw error;
        setMsg("Account created. Confirm your email if required, then sign in.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
      }
    } catch (e) { setErr(translate(e.message)); } finally { setBusy(false); }
  };

  return (
    <div className="rk-auth">
      <div className="rk-auth-card">
        <div className="rk-auth-brand"><span className="rk-chip rk-chip-logo">RACK</span><span className="rk-sub">your reselling HQ</span></div>
        <h1 className="rk-auth-title">{mode === "login" ? "Sign in" : "Create account"}</h1>
        {!hasConfig && <p className="rk-auth-err">⚠ Database not configured. Set the Supabase variables (see README).</p>}
        <label className="rk-field"><span className="rk-field-label">Email</span><input className="rk-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
        <label className="rk-field rk-mt12"><span className="rk-field-label">Password</span><input className="rk-input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
        {err && <p className="rk-auth-err">{err}</p>}
        {msg && <p className="rk-auth-msg">{msg}</p>}
        <button className="rk-btn rk-primary rk-auth-submit" disabled={busy || !hasConfig} onClick={submit}>{busy ? <Loader2 size={16} className="rk-spin" /> : mode === "login" ? <LogIn size={16} /> : <UserPlus size={16} />}{mode === "login" ? "Sign in" : "Register"}</button>
        <button className="rk-auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(null); setMsg(null); }}>{mode === "login" ? "No account? Register" : "Have an account? Sign in"}</button>
        {onDemo && <button className="rk-btn rk-ghost rk-auth-demo" onClick={onDemo}>👀 Try the demo (sample data)</button>}
      </div>
    </div>
  );
}

function translate(m = "") {
  if (m.includes("Invalid login")) return "Wrong email or password.";
  if (m.includes("already registered")) return "This email is already registered. Sign in.";
  if (m.includes("Email not confirmed")) return "Confirm your email first.";
  if (m.toLowerCase().includes("rate")) return "Too many attempts, try again shortly.";
  return m || "Unexpected error.";
}
