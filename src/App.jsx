import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus, Settings, Download, X, Trash2, Gift, Smartphone, Wallet, LogOut,
  Package, Receipt, ChevronLeft, ChevronRight, Search, TrendingUp, Tag,
  Truck, Pencil, ExternalLink, Check, Loader2, ListTodo, Flame, Clock, BarChart3
} from "lucide-react";
import { supabase } from "./supabaseClient";
import AuthPage from "./auth/AuthPage";
import {
  loadProfile, updateProfile, loadAll,
  insertRow, insertMany, updateRow, deleteRow, deleteWhere,
} from "./lib/db";

/* ============================================================ */
const EXPENSE_TYPES = ["Boost", "Buste / packaging", "Regalo", "Spedizione", "Costi vendita", "Altro"];
const CHANNELS = ["Vinted", "eBay", "Depop", "Facebook Marketplace", "Altro"];
const ACTIVE = ["stock", "caricato"];
const FISICO_LABEL = { ordinato: "ordinato · da spedire", viaggio: "in viaggio", casa: "a casa" };
const FISICO_OPTS = [
  ["ordinato", "Ordinato · il fornitore deve spedire"],
  ["viaggio", "In viaggio verso di me"],
  ["casa", "A casa"],
];
const STATO_LABEL = { stock: "in stock", caricato: "caricato", venduto: "venduto", regalato: "regalato" };
const SLOW_DAYS = 30; // oltre questi giorni un pezzo caricato è "lento"

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const thisYM = () => todayISO().slice(0, 7);
const eur = (n) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const codeOf = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "X");
// giorni tra due date (stringa ISO o Date). Ritorna intero >= 0
const daysBetween = (from, to) => {
  if (!from) return null;
  const a = new Date(from); const b = to ? new Date(to) : new Date();
  if (isNaN(a)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
};
// semaforo su ROI%: verde >=80, giallo >=30, rosso sotto
const roiTone = (roi) => (roi >= 80 ? "green" : roi >= 30 ? "amber" : "red");
// canale: se "Altro" usa il testo libero scritto dall'utente
const chanValue = (form) => (form.canale === "Altro" ? (form.canaleAltro?.trim() || "Altro") : form.canale);
const ymLabel = (ym) => {
  const [y, m] = ym.split("-");
  const mesi = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  return `${mesi[+m - 1]} ${y}`;
};
const shiftYM = (ym, d) => {
  const [y, m] = ym.split("-").map(Number);
  const x = new Date(y, m - 1 + d, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
};

/* ============================================================
   Root: gestisce sessione → Auth oppure App
   ============================================================ */
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = sto controllando
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (demo) return <Workspace demo onExitDemo={() => setDemo(false)} />;
  if (session === undefined) {
    return (
      <div className="rk-root rk-loading"><div className="rk-loader">
        <span className="rk-chip rk-chip-logo">RACK</span><p>Carico…</p>
      </div></div>
    );
  }
  if (!session) return <AuthPage onDemo={() => setDemo(true)} />;
  return <Workspace session={session} />;
}

/* ============================================================
   Workspace: l'app vera, dopo il login
   ============================================================ */
function Workspace({ session, demo, onExitDemo }) {
  const userId = demo ? "demo" : session.user.id;
  const [profile, setProfile] = useState(null);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dash");
  const [toast, setToast] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [saleItem, setSaleItem] = useState(null);
  const [bulkSale, setBulkSale] = useState(null);
  const [assignIds, setAssignIds] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [bulkNoteIds, setBulkNoteIds] = useState(null);
  const [bulkFisicoIds, setBulkFisicoIds] = useState(null);
  const [editExp, setEditExp] = useState(null);

  const isAdmin = profile?.role === "admin";

  // in demo tutte le scritture restano locali (niente database)
  const localId = () => "demo-" + Math.random().toString(36).slice(2, 9);
  const api = useMemo(() => demo ? {
    insertRow: async (_t, obj) => ({ ...obj, id: localId() }),
    insertMany: async (_t, objs) => objs.map((o) => ({ ...o, id: localId() })),
    updateRow: async () => {},
    deleteRow: async () => {},
    deleteWhere: async () => {},
    updateProfile: async () => {},
  } : { insertRow, insertMany, updateRow, deleteRow, deleteWhere, updateProfile }, [demo]);

  useEffect(() => {
    (async () => {
      try {
        if (demo) {
          const fx = demoFixture();
          setProfile(fx.profile);
          setData({ ...fx.data, phones: fx.profile.phones, pct: fx.profile.pct });
          return;
        }
        const [p, d] = await Promise.all([loadProfile(userId), loadAll(userId)]);
        setProfile(p);
        setData({ ...d, phones: p.phones, pct: p.pct });
      } catch (e) {
        setToast("Errore di caricamento dati");
        console.error(e);
      }
    })();
  }, [userId, demo]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const flash = useCallback((m) => setToast(m), []);
  // applica subito in locale e mostra messaggio
  const apply = useCallback((fn, msg) => {
    setData((prev) => fn(JSON.parse(JSON.stringify(prev))));
    if (msg) setToast(msg);
  }, []);

  if (!data || !profile) {
    return (
      <div className="rk-root rk-loading"><div className="rk-loader">
        <span className="rk-chip rk-chip-logo">RACK</span><p>Apro il magazzino…</p>
      </div></div>
    );
  }

  const creditBalance = data.credits.reduce(
    (a, c) => a + (c.tipo === "in" ? c.importo : c.tipo === "pagamento" ? -(c.usatoCredito || 0) : -(c.importo || 0)), 0
  );

  /* ---------- mutazioni (scrivono su Supabase + stato) ---------- */
  const nextSku = (items, prefix) => {
    let max = 0;
    items.forEach((i) => {
      if (i.sku?.startsWith(prefix)) {
        const n = parseInt(i.sku.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return max;
  };

  const addItems = async (form) => {
    const qty = Math.max(1, parseInt(form.qty, 10) || 1);
    const prefix = `${codeOf(form.brand)}-${codeOf(form.categoria)}-`;
    let n = nextSku(data.items, prefix);
    const objs = [];
    for (let k = 0; k < qty; k++) {
      n += 1;
      objs.push({
        sku: prefix + String(n).padStart(3, "0"),
        brand: form.brand.trim(), nome: form.nome.trim(), categoria: form.categoria.trim(),
        taglia: form.taglia.trim(), costo: num(form.costo), telefono: form.telefono || "",
        stato: form.telefono ? "caricato" : "stock", fisico: form.fisico || "casa",
        vinted: !!form.telefono, caricatoAt: form.telefono ? new Date().toISOString() : null,
        data: form.data || todayISO(), note: form.note.trim(),
      });
    }
    try {
      const created = await api.insertMany("items", objs, userId);
      apply((d) => { d.items = [...created, ...d.items]; return d; }, qty > 1 ? `${qty} articoli caricati` : "Articolo caricato");
    } catch (e) { flash("Errore nel salvataggio"); }
  };

  const sellOne = async (item, form) => {
    try {
      const saleDate = form.data || todayISO();
      const giac = daysBetween(item.caricatoAt || item.data, saleDate);
      const sale = await api.insertRow("sales", {
        itemId: item.id, sku: item.sku, nome: item.nome, brand: item.brand,
        prezzo: num(form.prezzo), costo: item.costo, costiVendita: num(form.costi),
        canale: chanValue(form), data: saleDate, telefono: item.telefono, giacenzaGiorni: giac,
      }, userId);
      await api.updateRow("items", item.id, { stato: "venduto" });
      let exp = null;
      if (num(form.costi) > 0) {
        exp = await api.insertRow("expenses", {
          tipo: "Costi vendita", importo: num(form.costi), data: form.data || todayISO(),
          nota: `Costi vendita ${item.sku}`, telefono: item.telefono || "", saleId: sale.id,
        }, userId);
      }
      apply((d) => {
        d.sales = [sale, ...d.sales];
        const it = d.items.find((i) => i.id === item.id); if (it) it.stato = "venduto";
        if (exp) d.expenses = [exp, ...d.expenses];
        return d;
      }, `Vendita registrata · ${item.sku}`);
    } catch (e) { flash("Errore nel salvataggio"); }
    setSaleItem(null);
  };

  const sellBulk = async (items, form) => {
    try {
      for (const item of items) {
        const saleDate = form.data || todayISO();
        const giac = daysBetween(item.caricatoAt || item.data, saleDate);
        const sale = await api.insertRow("sales", {
          itemId: item.id, sku: item.sku, nome: item.nome, brand: item.brand,
          prezzo: num(form.prezzo), costo: item.costo, costiVendita: num(form.costi),
          canale: chanValue(form), data: saleDate, telefono: item.telefono || "—", giacenzaGiorni: giac,
        }, userId);
        await api.updateRow("items", item.id, { stato: "venduto" });
        let exp = null;
        if (num(form.costi) > 0) {
          exp = await api.insertRow("expenses", {
            tipo: "Costi vendita", importo: num(form.costi), data: form.data || todayISO(),
            nota: `Costi vendita ${item.sku}`, telefono: item.telefono || "", saleId: sale.id,
          }, userId);
        }
        apply((d) => {
          d.sales = [sale, ...d.sales];
          const it = d.items.find((i) => i.id === item.id); if (it) it.stato = "venduto";
          if (exp) d.expenses = [exp, ...d.expenses];
          return d;
        });
      }
      flash(`${items.length} vendite registrate`);
    } catch (e) { flash("Errore nel salvataggio"); }
    setBulkSale(null);
  };

  const giftItem = async (item) => {
    if (!window.confirm(`Segnare ${item.sku} come regalo? Il costo (${eur(item.costo)}) finirà tra le spese.`)) return;
    try {
      await api.updateRow("items", item.id, { stato: "regalato" });
      const exp = await api.insertRow("expenses", {
        tipo: "Regalo", importo: item.costo, data: todayISO(),
        nota: `Regalo articolo ${item.sku} — ${item.nome}`, telefono: item.telefono || "",
      }, userId);
      apply((d) => {
        const it = d.items.find((i) => i.id === item.id); if (it) it.stato = "regalato";
        d.expenses = [exp, ...d.expenses]; return d;
      }, `${item.sku} segnato come regalo`);
    } catch (e) { flash("Errore"); }
  };

  const removeItem = async (item) => {
    if (!window.confirm(`Eliminare ${item.sku}?`)) return;
    try { await api.deleteRow("items", item.id);
      apply((d) => { d.items = d.items.filter((i) => i.id !== item.id); return d; }, "Articolo eliminato");
    } catch (e) { flash("Errore"); }
  };

  const removeSale = async (sale) => {
    if (!window.confirm(`Annullare la vendita di ${sale.sku}? L'articolo torna in magazzino.`)) return;
    try {
      await api.deleteRow("sales", sale.id);
      await api.deleteWhere("expenses", "sale_id", sale.id);
      const it = data.items.find((i) => i.id === sale.itemId);
      if (it) await api.updateRow("items", it.id, { stato: it.telefono ? "caricato" : "stock" });
      apply((d) => {
        d.sales = d.sales.filter((s) => s.id !== sale.id);
        d.expenses = d.expenses.filter((e) => e.saleId !== sale.id);
        const x = d.items.find((i) => i.id === sale.itemId);
        if (x) x.stato = x.telefono ? "caricato" : "stock";
        return d;
      }, "Vendita annullata");
    } catch (e) { flash("Errore"); }
  };

  const saveEdit = async (id, patch) => {
    try { await api.updateRow("items", id, patch);
      apply((d) => { const it = d.items.find((i) => i.id === id); if (it) Object.assign(it, patch); return d; }, "Articolo aggiornato");
    } catch (e) { flash("Errore"); }
    setEditItem(null);
  };

  const toggleVinted = async (item) => {
    const v = !item.vinted;
    try { await api.updateRow("items", item.id, { vinted: v });
      apply((d) => { const it = d.items.find((i) => i.id === item.id); if (it) it.vinted = v; return d; });
    } catch (e) { flash("Errore"); }
  };

  const bulkNote = async (ids, note) => {
    try { for (const id of ids) await api.updateRow("items", id, { note });
      apply((d) => { d.items.forEach((i) => { if (ids.includes(i.id)) i.note = note; }); return d; }, `Nota applicata a ${ids.length} articoli`);
    } catch (e) { flash("Errore"); }
    setBulkNoteIds(null);
  };

  const bulkFisico = async (ids, fisico) => {
    try { for (const id of ids) await api.updateRow("items", id, { fisico });
      apply((d) => { d.items.forEach((i) => { if (ids.includes(i.id)) i.fisico = fisico; }); return d; }, `${ids.length} articoli: ${FISICO_LABEL[fisico]}`);
    } catch (e) { flash("Errore"); }
    setBulkFisicoIds(null);
  };

  const assignPhone = async (ids, phone) => {
    const none = phone === "__none__";
    const nowISO = new Date().toISOString();
    try {
      for (const id of ids) {
        const it = data.items.find((x) => x.id === id);
        if (none) {
          await api.updateRow("items", id, { telefono: "", stato: "stock", vinted: false, caricatoAt: null });
        } else {
          // imposta caricatoAt solo se non già presente (la giacenza parte dal primo carico)
          const patch = { telefono: phone, stato: "caricato" };
          if (!it?.caricatoAt) patch.caricatoAt = nowISO;
          await api.updateRow("items", id, patch);
        }
      }
      apply((d) => {
        d.items.forEach((i) => {
          if (ids.includes(i.id)) {
            if (none) { i.telefono = ""; i.stato = "stock"; i.vinted = false; i.caricatoAt = null; }
            else { i.telefono = phone; i.stato = "caricato"; if (!i.caricatoAt) i.caricatoAt = nowISO; }
          }
        });
        return d;
      }, none ? `${ids.length > 1 ? ids.length + " articoli rimessi" : "Articolo rimesso"} in stock` : `Caricato su ${phone}`);
    } catch (e) { flash("Errore"); }
    setAssignIds(null);
  };

  /* ordini */
  const addOrder = async (form, itemIds) => {
    try {
      const o = await api.insertRow("orders", {
        tracking: form.tracking.trim(), corriere: form.corriere.trim(), nota: form.nota.trim(),
        data: form.data || todayISO(), stato: "in_viaggio", itemIds,
      }, userId);
      for (const id of itemIds) await api.updateRow("items", id, { fisico: "viaggio" });
      apply((d) => {
        d.orders = [o, ...d.orders];
        d.items.forEach((i) => { if (itemIds.includes(i.id)) i.fisico = "viaggio"; });
        return d;
      }, "Ordine creato");
    } catch (e) { flash("Errore"); }
  };

  const orderDelivered = async (order) => {
    try {
      await api.updateRow("orders", order.id, { stato: "consegnato" });
      for (const id of order.itemIds) await api.updateRow("items", id, { fisico: "casa" });
      apply((d) => {
        const o = d.orders.find((x) => x.id === order.id); if (o) o.stato = "consegnato";
        d.items.forEach((i) => { if (order.itemIds.includes(i.id)) i.fisico = "casa"; });
        return d;
      }, "Consegnato · pezzi a casa");
    } catch (e) { flash("Errore"); }
  };

  const removeOrder = async (order) => {
    if (!window.confirm("Eliminare questo ordine? Gli articoli non vengono toccati.")) return;
    try { await api.deleteRow("orders", order.id);
      apply((d) => { d.orders = d.orders.filter((o) => o.id !== order.id); return d; }, "Ordine eliminato");
    } catch (e) { flash("Errore"); }
  };

  /* spese */
  const addExpense = async (form) => {
    try {
      const e = await api.insertRow("expenses", {
        tipo: form.tipo, importo: num(form.importo), data: form.data || todayISO(),
        nota: form.nota.trim(), telefono: form.telefono || "",
      }, userId);
      apply((d) => { d.expenses = [e, ...d.expenses]; return d; }, "Spesa registrata");
    } catch (er) { flash("Errore"); }
  };
  const removeExpense = async (e) => {
    try { await api.deleteRow("expenses", e.id);
      apply((d) => { d.expenses = d.expenses.filter((x) => x.id !== e.id); return d; }, "Spesa eliminata");
    } catch (er) { flash("Errore"); }
  };
  const saveExpenseEdit = async (id, patch) => {
    try { await api.updateRow("expenses", id, patch);
      apply((d) => { const ex = d.expenses.find((x) => x.id === id); if (ex) Object.assign(ex, patch); return d; }, "Spesa aggiornata");
    } catch (er) { flash("Errore"); }
    setEditExp(null);
  };

  const setReso = async (sale, fase) => {
    try {
      await api.updateRow("sales", sale.id, { reso: fase });
      // articolo: torna in stock SOLO quando il reso è "consegnato" a me; altrimenti resta venduto
      const it = data.items.find((i) => i.id === sale.itemId);
      if (it) {
        const nuovoStato = fase === "consegnato" ? (it.telefono ? "caricato" : "stock") : "venduto";
        if (it.stato !== nuovoStato) await api.updateRow("items", it.id, { stato: nuovoStato });
      }
      apply((d) => {
        const s = d.sales.find((x) => x.id === sale.id); if (s) s.reso = fase;
        const x = d.items.find((i) => i.id === sale.itemId);
        if (x) x.stato = fase === "consegnato" ? (x.telefono ? "caricato" : "stock") : "venduto";
        return d;
      }, fase === "no" ? "Reso annullato" : fase === "consegnato" ? "Reso consegnato · articolo in stock" : `Segnato: ${fase.replace("_", " ")}`);
    } catch (e) { flash("Errore"); }
  };

  /* crediti (solo admin) */
  const addCreditIn = async (form) => {
    const ordine = num(form.ordine);
    try {
      const c = await api.insertRow("credits", {
        tipo: "in", ordine, importo: +(ordine * (data.pct / 100)).toFixed(2),
        data: form.data || todayISO(), nota: form.nota.trim(),
      }, userId);
      apply((d) => { d.credits = [c, ...d.credits]; return d; }, "Credito maturato registrato");
    } catch (e) { flash("Errore"); }
  };
  const addPayment = async (form) => {
    const importo = num(form.importo);
    const usato = +Math.min(Math.max(creditBalance, 0), importo).toFixed(2);
    try {
      const c = await api.insertRow("credits", {
        tipo: "pagamento", ordine: 0, importo,
        usatoCredito: usato, contanti: +(importo - usato).toFixed(2),
        data: form.data || todayISO(), nota: form.nota.trim(),
      }, userId);
      apply((d) => { d.credits = [c, ...d.credits]; return d; }, "Pagamento al fornitore registrato");
    } catch (e) { flash("Errore"); }
  };
  const removeCredit = async (c) => {
    try { await api.deleteRow("credits", c.id);
      apply((d) => { d.credits = d.credits.filter((x) => x.id !== c.id); return d; }, "Movimento eliminato");
    } catch (e) { flash("Errore"); }
  };

  /* impostazioni */
  const saveSettings = async (phones, pct) => {
    const clean = phones.filter((p) => p.trim());
    try {
      await api.updateProfile(userId, { phones: clean, pct: num(pct) || 5 });
      apply((d) => { d.phones = clean; d.pct = num(pct) || 5; return d; }, "Impostazioni salvate");
    } catch (e) { flash("Errore"); }
    setShowSettings(false);
  };

  const addTodo = async (testo) => {
    try {
      const t = await api.insertRow("todos", { testo, fatto: false }, userId);
      apply((d) => { d.todos = [t, ...d.todos]; return d; });
    } catch (e) { flash("Errore"); }
  };
  const toggleTodo = async (todo) => {
    try { await api.updateRow("todos", todo.id, { fatto: !todo.fatto });
      apply((d) => { const t = d.todos.find((x) => x.id === todo.id); if (t) t.fatto = !t.fatto; return d; });
    } catch (e) { flash("Errore"); }
  };
  const removeTodo = async (todo) => {
    try { await api.deleteRow("todos", todo.id);
      apply((d) => { d.todos = d.todos.filter((x) => x.id !== todo.id); return d; });
    } catch (e) { flash("Errore"); }
  };

  const logout = async () => {
    if (demo) { onExitDemo && onExitDemo(); return; }
    await supabase.auth.signOut();
  };

  const exportCSV = () => {
    const rows = [["Data", "Tipo", "Riferimento", "Descrizione", "Canale/Telefono", "Entrata", "Uscita"]];
    data.sales.forEach((s) => {
      const reso = s.reso && s.reso !== "no";
      rows.push([s.data, reso ? "Vendita (reso)" : "Vendita", s.sku, `${s.brand} ${s.nome}`.trim(), s.canale, reso ? 0 : s.prezzo, 0]);
      if (!reso) rows.push([s.data, "Costo merce", s.sku, `Acquisto ${s.brand} ${s.nome}`.trim(), s.telefono, 0, s.costo]);
    });
    data.expenses.forEach((e) => rows.push([e.data, `Spesa — ${e.tipo}`, "", e.nota, e.telefono, 0, e.importo]));
    if (isAdmin) data.credits.forEach((c) => rows.push([
      c.data, c.tipo === "in" ? "Credito maturato" : "Pagamento fornitore", "", c.nota, "",
      c.tipo === "in" ? c.importo : 0, c.tipo === "pagamento" ? c.contanti : 0,
    ]));
    rows.sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `rack-contabilita-${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(a.href); flash("CSV esportato");
  };

  const openTodos = data.todos.filter((t) => !t.fatto).length;
  const tabs = [
    ["dash", "Dashboard", <TrendingUp size={14} key="i" />],
    ["stock", "Stock", <Package size={14} key="i" />],
    ["ord", "Ordini", <Truck size={14} key="i" />],
    ["sales", "Vendite", <Tag size={14} key="i" />],
    ["exp", "Spese", <Receipt size={14} key="i" />],
    ["todo", "To-do", <ListTodo size={14} key="i" />],
    ...(isAdmin ? [["cred", "Saldo fornitore", <Wallet size={14} key="i" />]] : []),
  ];
  const inViaggioOrd = data.orders.filter((o) => o.stato === "in_viaggio").length;

  return (
    <div className="rk-root">
      {demo && (
        <div className="rk-demobar">
          <span><Flame size={13} /> Modalità DEMO — dati di esempio, niente viene salvato</span>
          <button className="rk-btn rk-small" onClick={() => onExitDemo && onExitDemo()}>Esci dalla demo</button>
        </div>
      )}
      <header className="rk-header">
        <div className="rk-brandmark">
          <span className="rk-chip rk-chip-logo">RACK</span>
          <span className="rk-sub rk-hide-sm">your reselling HQ</span>
        </div>
        <div className="rk-header-actions">
          <button className="rk-btn rk-ghost" onClick={exportCSV} title="Esporta CSV"><Download size={15} /><span className="rk-hide-sm">CSV</span></button>
          <button className="rk-btn rk-ghost" onClick={() => setShowSettings(true)} title="Impostazioni"><Settings size={15} /><span className="rk-hide-sm">Telefoni</span></button>
          <button className="rk-btn rk-ghost" onClick={logout} title={demo ? "Esci dalla demo" : "Esci"}><LogOut size={15} /></button>
        </div>
      </header>

      <nav className="rk-tabs">
        {tabs.map(([id, label, icon]) => (
          <button key={id} className={`rk-tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
            {icon} {label}
            {id === "cred" && creditBalance > 0 && <span className="rk-tab-pill">{eur(creditBalance)}</span>}
            {id === "ord" && inViaggioOrd > 0 && <span className="rk-tab-pill">{inViaggioOrd} in viaggio</span>}
            {id === "todo" && openTodos > 0 && <span className="rk-tab-pill">{openTodos}</span>}
          </button>
        ))}
      </nav>

      <main className="rk-main">
        {tab === "dash" && <Dashboard data={data} creditBalance={creditBalance} isAdmin={isAdmin} />}
        {tab === "stock" && (
          <StockTab data={data} isAdmin={isAdmin}
            onAdd={addItems} onSell={setSaleItem} onGift={giftItem} onDelete={removeItem}
            onAssign={setAssignIds} onBulkSell={setBulkSale} onEdit={setEditItem}
            onBulkNote={setBulkNoteIds} onBulkFisico={setBulkFisicoIds} onToggleVinted={toggleVinted} />
        )}
        {tab === "ord" && <OrdersTab data={data} onAdd={addOrder} onDelivered={orderDelivered} onDelete={removeOrder} />}
        {tab === "sales" && <SalesTab data={data} onDelete={removeSale} onSetReso={setReso} />}
        {tab === "exp" && <ExpensesTab data={data} onAdd={addExpense} onDelete={removeExpense} onEdit={setEditExp} />}
        {tab === "todo" && <TodoTab data={data} onAdd={addTodo} onToggle={toggleTodo} onDelete={removeTodo} />}
        {tab === "cred" && isAdmin && <CreditsTab data={data} balance={creditBalance} onIn={addCreditIn} onPay={addPayment} onDelete={removeCredit} />}
      </main>

      {saleItem && <SaleModal item={saleItem} onClose={() => setSaleItem(null)} onConfirm={sellOne} />}
      {bulkSale && <BulkSaleModal items={bulkSale} onClose={() => setBulkSale(null)} onConfirm={sellBulk} />}
      {assignIds && <AssignPhoneModal phones={data.phones} count={assignIds.length} onClose={() => setAssignIds(null)} onConfirm={(p) => assignPhone(assignIds, p)} />}
      {editItem && <EditItemModal item={editItem} onClose={() => setEditItem(null)} onSave={saveEdit} />}
      {bulkNoteIds && <BulkNoteModal count={bulkNoteIds.length} onClose={() => setBulkNoteIds(null)} onConfirm={(n) => bulkNote(bulkNoteIds, n)} />}
      {bulkFisicoIds && <BulkFisicoModal count={bulkFisicoIds.length} onClose={() => setBulkFisicoIds(null)} onConfirm={(f) => bulkFisico(bulkFisicoIds, f)} />}
      {editExp && <EditExpenseModal exp={editExp} phones={data.phones} onClose={() => setEditExp(null)} onSave={saveExpenseEdit} />}
      {showSettings && <SettingsModal data={data} role={profile.role} onClose={() => setShowSettings(false)} onSave={saveSettings} />}
      {toast && <div className="rk-toast">{toast}</div>}
    </div>
  );
}

/* ---------- Dashboard ---------- */
function Dashboard({ data, creditBalance, isAdmin }) {
  const [ym, setYm] = useState(thisYM());
  const m = useMemo(() => {
    const sales = data.sales.filter((s) => (s.data || "").slice(0, 7) === ym);
    const validSales = sales.filter((s) => !s.reso || s.reso === "no");
    const expenses = data.expenses.filter((e) => (e.data || "").slice(0, 7) === ym);
    const creditsIn = data.credits.filter((c) => c.tipo === "in" && (c.data || "").slice(0, 7) === ym);
    const ricavi = validSales.reduce((a, s) => a + s.prezzo, 0);
    const cogs = validSales.reduce((a, s) => a + s.costo, 0);
    const spese = expenses.reduce((a, e) => a + e.importo, 0);
    const maturati = creditsIn.reduce((a, c) => a + c.importo, 0);
    return { nVendite: validSales.length, nResi: sales.length - validSales.length, ricavi, cogs, spese, maturati,
      profitto: ricavi - cogs - spese + (isAdmin ? maturati : 0) };
  }, [data, ym, isAdmin]);

  // riepilogo OGGI
  const oggi = useMemo(() => {
    const t = todayISO();
    const sales = data.sales.filter((s) => s.data === t && (!s.reso || s.reso === "no"));
    const profitto = sales.reduce((a, s) => a + (s.prezzo - s.costo - (s.costiVendita || 0)), 0);
    return { n: sales.length, profitto };
  }, [data]);

  // statistiche per brand (profitto, su vendite valide del mese)
  const brandStats = useMemo(() => {
    const map = {};
    data.sales.filter((s) => (s.data || "").slice(0, 7) === ym && (!s.reso || s.reso === "no")).forEach((s) => {
      const k = s.brand || "—";
      map[k] = map[k] || { n: 0, profitto: 0 };
      map[k].n += 1; map[k].profitto += s.prezzo - s.costo - (s.costiVendita || 0);
    });
    return Object.entries(map).map(([brand, v]) => ({ brand, ...v })).sort((a, b) => b.profitto - a.profitto).slice(0, 5);
  }, [data, ym]);
  const maxBrand = Math.max(1, ...brandStats.map((b) => Math.abs(b.profitto)));

  const stock = useMemo(() => {
    const attivi = data.items.filter((i) => ACTIVE.includes(i.stato));
    const caricati = attivi.filter((i) => i.stato === "caricato");
    const perPhone = {};
    data.phones.forEach((p) => (perPhone[p] = 0));
    caricati.forEach((i) => { perPhone[i.telefono] = (perPhone[i.telefono] || 0) + 1; });
    const lenti = caricati.filter((i) => (daysBetween(i.caricatoAt) ?? 0) >= SLOW_DAYS);
    return {
      n: attivi.length, nonCaricati: attivi.length - caricati.length,
      inViaggio: attivi.filter((i) => i.fisico === "viaggio").length,
      ordinati: attivi.filter((i) => i.fisico === "ordinato").length,
      valore: attivi.reduce((a, i) => a + i.costo, 0), perPhone,
      lenti: lenti.length, capitaleLento: lenti.reduce((a, i) => a + i.costo, 0),
    };
  }, [data]);
  const maxPhone = Math.max(1, ...Object.values(stock.perPhone));

  return (
    <div className="rk-stack">
      <div className="rk-todaybar">
        <div className="rk-today-left"><Flame size={16} /> <span>Oggi</span></div>
        <div className="rk-today-stats">
          <span><strong className="rk-mono">{oggi.n}</strong> {oggi.n === 1 ? "vendita" : "vendite"}</span>
          <span className={`rk-mono ${oggi.profitto >= 0 ? "rk-tonetext-green" : "rk-tonetext-red"}`}>{oggi.profitto >= 0 ? "+" : ""}{eur(oggi.profitto)}</span>
        </div>
      </div>

      <div className="rk-monthnav">
        <button className="rk-btn rk-ghost rk-sq" onClick={() => setYm(shiftYM(ym, -1))}><ChevronLeft size={16} /></button>
        <h2>{ymLabel(ym)}</h2>
        <button className="rk-btn rk-ghost rk-sq" onClick={() => setYm(shiftYM(ym, 1))} disabled={ym >= thisYM()}><ChevronRight size={16} /></button>
      </div>
      <div className="rk-kpis">
        <Kpi label="Ricavi vendite" value={eur(m.ricavi)} sub={`${m.nVendite} venduti${m.nResi ? ` · ${m.nResi} resi` : ""}`} />
        <Kpi label="Costo merce venduta" value={"−" + eur(m.cogs)} tone="mut" />
        <Kpi label="Spese operative" value={"−" + eur(m.spese)} sub="boost · buste · regali · costi vendita" tone="mut" />
        {isAdmin && <Kpi label="Crediti maturati" value={"+" + eur(m.maturati)} tone="amber" />}
        <Kpi label="Profitto netto" value={eur(m.profitto)} tone={m.profitto >= 0 ? "green" : "red"} big />
      </div>
      <div className="rk-grid2">
        <div className="rk-card">
          <h3 className="rk-h3"><Package size={15} /> Stock attuale</h3>
          <div className="rk-stockline">
            <div><div className="rk-bignum">{stock.n}</div><div className="rk-mutlabel">pezzi in magazzino</div></div>
            <div><div className="rk-bignum">{eur(stock.valore)}</div><div className="rk-mutlabel">capitale immobilizzato</div></div>
          </div>
          {(stock.inViaggio > 0 || stock.ordinati > 0) && (
            <p className="rk-mutlabel rk-mt12">
              <Truck size={12} /> {stock.ordinati > 0 && `${stock.ordinati} da spedire`}
              {stock.ordinati > 0 && stock.inViaggio > 0 && " · "}
              {stock.inViaggio > 0 && `${stock.inViaggio} in viaggio`}
            </p>
          )}
          {stock.nonCaricati > 0 && <p className="rk-mutlabel rk-mt6">{stock.nonCaricati} non ancora caricati su account</p>}
          {stock.lenti > 0 && (
            <p className="rk-slowline rk-mt12"><Clock size={13} /> {stock.lenti} pezzi fermi da oltre {SLOW_DAYS}gg · {eur(stock.capitaleLento)} bloccati</p>
          )}
        </div>
        <div className="rk-card">
          <h3 className="rk-h3"><Smartphone size={15} /> Pezzi per telefono</h3>
          <div className="rk-bars">
            {Object.entries(stock.perPhone).map(([p, n]) => (
              <div key={p} className="rk-barrow">
                <span className="rk-barlabel">{p}</span>
                <div className="rk-bartrack"><div className="rk-barfill" style={{ width: `${(n / maxPhone) * 100}%` }} /></div>
                <span className="rk-barnum">{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {brandStats.length > 0 && (
        <div className="rk-card">
          <h3 className="rk-h3"><BarChart3 size={15} /> Profitto per brand · {ymLabel(ym)}</h3>
          <div className="rk-bars">
            {brandStats.map((b) => (
              <div key={b.brand} className="rk-barrow">
                <span className="rk-barlabel">{b.brand} <span className="rk-mutlabel">·{b.n}</span></span>
                <div className="rk-bartrack"><div className={`rk-barfill ${b.profitto < 0 ? "rk-barfill-neg" : ""}`} style={{ width: `${(Math.abs(b.profitto) / maxBrand) * 100}%` }} /></div>
                <span className={`rk-barnum rk-mono ${b.profitto >= 0 ? "rk-tonetext-green" : "rk-tonetext-red"}`}>{eur(b.profitto)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="rk-card rk-walletline">
          <Wallet size={16} /><span>Saldo crediti fornitore</span><strong className="rk-mono">{eur(creditBalance)}</strong>
        </div>
      )}
    </div>
  );
}
function Kpi({ label, value, sub, tone, big }) {
  return (
    <div className={`rk-kpi ${big ? "rk-kpi-big" : ""} ${tone ? "rk-tone-" + tone : ""}`}>
      <div className="rk-kpi-label">{label}</div>
      <div className="rk-kpi-value rk-mono">{value}</div>
      {sub && <div className="rk-kpi-sub">{sub}</div>}
    </div>
  );
}

/* ---------- Stock ---------- */
const EMPTY_ITEM = { brand: "", nome: "", categoria: "", taglia: "", costo: "", telefono: "", qty: "1", data: "", note: "", fisico: "casa" };
function StockTab({ data, isAdmin, onAdd, onSell, onGift, onDelete, onAssign, onBulkSell, onEdit, onBulkNote, onBulkFisico, onToggleVinted }) {
  const [form, setForm] = useState({ ...EMPTY_ITEM, data: todayISO() });
  const [open, setOpen] = useState(data.items.length === 0);
  const [q, setQ] = useState("");
  const [fStato, setFStato] = useState("attivi");
  const [fPhone, setFPhone] = useState("");
  const [sel, setSel] = useState([]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const skuPreview = `${codeOf(form.brand)}-${codeOf(form.categoria)}-###`;
  const canAdd = form.brand.trim() && form.nome.trim() && form.categoria.trim();

  const list = data.items.filter((i) => {
    if (fStato === "attivi") { if (!ACTIVE.includes(i.stato)) return false; }
    else if (fStato !== "tutti" && i.stato !== fStato) return false;
    if (fPhone && i.telefono !== fPhone) return false;
    if (q) { const t = `${i.sku} ${i.brand} ${i.nome} ${i.categoria} ${i.taglia}`.toLowerCase(); if (!t.includes(q.toLowerCase())) return false; }
    return true;
  });
  const toggleSel = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selItems = data.items.filter((i) => sel.includes(i.id) && ACTIVE.includes(i.stato));
  const activeInList = list.filter((i) => ACTIVE.includes(i.stato));

  return (
    <div className="rk-stack">
      <div className="rk-card">
        <button className="rk-cardtoggle" onClick={() => setOpen(!open)}>
          <Plus size={15} /> Carica articolo <span className="rk-mono rk-skupreview">{skuPreview}</span>
        </button>
        {open && (
          <div className="rk-form">
            <div className="rk-formgrid">
              <L label="Brand"><input className="rk-input" placeholder="Burberry" value={form.brand} onChange={set("brand")} /></L>
              <L label="Articolo"><input className="rk-input" placeholder="Costume mare check" value={form.nome} onChange={set("nome")} /></L>
              <L label="Categoria"><input className="rk-input" placeholder="Costume / Kit calcio…" value={form.categoria} onChange={set("categoria")} /></L>
              <L label="Taglia"><input className="rk-input" placeholder="M" value={form.taglia} onChange={set("taglia")} /></L>
              <L label="Costo acquisto €"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={form.costo} onChange={set("costo")} /></L>
              <L label="Telefono (opzionale)">
                <select className="rk-input" value={form.telefono} onChange={set("telefono")}>
                  <option value="">— assegno dopo —</option>
                  {data.phones.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </L>
              <L label="Quantità"><input className="rk-input rk-mono" inputMode="numeric" value={form.qty} onChange={set("qty")} /></L>
              <L label="Dove si trova">
                <select className="rk-input" value={form.fisico} onChange={set("fisico")}>
                  {FISICO_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </L>
              <L label="Data carico"><input className="rk-input" type="date" value={form.data} onChange={set("data")} /></L>
              <L label="Note" wide><input className="rk-input" placeholder="Fornitore, lotto…" value={form.note} onChange={set("note")} /></L>
            </div>
            <div className="rk-formfoot">
              <span className="rk-mutlabel">SKU automatici: {skuPreview.replace("###", "001")}, 002, … Senza telefono resta «in stock».</span>
              <button className="rk-btn rk-primary" disabled={!canAdd}
                onClick={() => { onAdd(form); setForm({ ...EMPTY_ITEM, data: todayISO(), telefono: form.telefono, brand: form.brand, categoria: form.categoria, fisico: form.fisico }); }}>
                <Plus size={15} /> Carica {parseInt(form.qty, 10) > 1 ? `${form.qty} pezzi` : ""}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rk-filters">
        <div className="rk-search"><Search size={14} /><input className="rk-input rk-input-bare" placeholder="Cerca SKU, brand…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="rk-input rk-input-auto" value={fStato} onChange={(e) => setFStato(e.target.value)}>
          <option value="attivi">Attivi (stock + caricati)</option>
          <option value="stock">Solo in stock</option>
          <option value="caricato">Caricati</option>
          <option value="venduto">Venduti</option>
          <option value="regalato">Regalati</option>
          <option value="tutti">Tutti</option>
        </select>
        <select className="rk-input rk-input-auto" value={fPhone} onChange={(e) => setFPhone(e.target.value)}>
          <option value="">Tutti i telefoni</option>
          {data.phones.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {activeInList.length > 1 && <button className="rk-btn rk-ghost rk-small" onClick={() => setSel(activeInList.map((i) => i.id))}>Seleziona tutti</button>}
      </div>

      {selItems.length > 0 && (
        <div className="rk-bulkbar">
          <strong>{selItems.length} selez. · costo {eur(selItems.reduce((a, i) => a + i.costo, 0))}</strong>
          <button className="rk-btn rk-primary rk-small" onClick={() => onBulkSell(selItems)}>Vendi insieme</button>
          <button className="rk-btn rk-small" onClick={() => onAssign(selItems.map((i) => i.id))}><Smartphone size={13} /> Account</button>
          <button className="rk-btn rk-small" onClick={() => onBulkFisico(selItems.map((i) => i.id))}><Truck size={13} /> Posizione</button>
          <button className="rk-btn rk-small" onClick={() => onBulkNote(selItems.map((i) => i.id))}><Pencil size={13} /> Nota</button>
          <button className="rk-btn rk-ghost rk-small" onClick={() => setSel([])}>Annulla</button>
        </div>
      )}

      {list.length === 0 ? <p className="rk-empty">Nessun articolo qui.</p> : (
        <div className="rk-rows">
          {list.map((i) => {
            const active = ACTIVE.includes(i.stato);
            return (
              <div key={i.id} className={`rk-row ${!active ? "rk-row-dim" : ""}`}>
                {active && <input type="checkbox" className="rk-check" checked={sel.includes(i.id)} onChange={() => toggleSel(i.id)} />}
                <span className="rk-chip">{i.sku}</span>
                {i.fisico === "viaggio" && <span className="rk-badge rk-badge-travel"><Truck size={11} /> in viaggio</span>}
                {i.fisico === "ordinato" && <span className="rk-badge rk-badge-order">da spedire</span>}
                {i.stato === "caricato" && i.caricatoAt && (() => {
                  const g = daysBetween(i.caricatoAt);
                  return <span className={`rk-badge rk-badge-giac ${g >= SLOW_DAYS ? "rk-badge-slow" : ""}`}><Clock size={11} /> {g}gg</span>;
                })()}
                <div className="rk-row-main">
                  <strong>{i.brand} · {i.nome}</strong>
                  <span className="rk-row-meta">{i.categoria}{i.taglia ? ` · tg ${i.taglia}` : ""} · {i.data}{i.note ? ` · ${i.note}` : ""}</span>
                </div>
                {active && (
                  <button className={`rk-vinted ${i.vinted ? "on" : ""}`} title="Pubblicato su Vinted" onClick={() => onToggleVinted(i)}>
                    {i.vinted ? <Check size={12} /> : null} Vinted
                  </button>
                )}
                {i.stato === "caricato" ? (
                  <button className="rk-badge rk-badge-btn" onClick={() => onAssign([i.id])}><Smartphone size={11} /> {i.telefono}</button>
                ) : i.stato === "stock" ? (
                  <span className="rk-badge rk-badge-stock">in stock</span>
                ) : (
                  <span className={`rk-stato rk-stato-${i.stato}`}>{STATO_LABEL[i.stato]}</span>
                )}
                <span className="rk-mono rk-row-cost">{eur(i.costo)}</span>
                <button className="rk-btn rk-ghost rk-small" title="Modifica" onClick={() => onEdit(i)}><Pencil size={14} /></button>
                {active && (
                  <div className="rk-row-actions">
                    {i.stato === "stock" && <button className="rk-btn rk-small" onClick={() => onAssign([i.id])}><Smartphone size={13} /> Carica</button>}
                    <button className="rk-btn rk-primary rk-small" onClick={() => onSell(i)}>Vendi</button>
                    <button className="rk-btn rk-ghost rk-small" title="Regalo" onClick={() => onGift(i)}><Gift size={14} /></button>
                    <button className="rk-btn rk-ghost rk-small rk-danger" title="Elimina" onClick={() => onDelete(i)}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Ordini ---------- */
const EMPTY_ORDER = { tracking: "", corriere: "", nota: "", data: "" };
function OrdersTab({ data, onAdd, onDelivered, onDelete }) {
  const [form, setForm] = useState({ ...EMPTY_ORDER, data: todayISO() });
  const [sel, setSel] = useState([]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const locked = new Set(data.orders.filter((o) => o.stato === "in_viaggio").flatMap((o) => o.itemIds));
  const eligible = data.items.filter((i) => ACTIVE.includes(i.stato) && !locked.has(i.id))
    .sort((a, b) => (a.fisico === b.fisico ? 0 : a.fisico === "casa" ? 1 : -1));
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const skuOf = (id) => data.items.find((i) => i.id === id);

  return (
    <div className="rk-stack">
      <div className="rk-card">
        <h3 className="rk-h3"><Truck size={15} /> Nuovo ordine dal fornitore</h3>
        <div className="rk-formgrid">
          <L label="Tracking"><input className="rk-input rk-mono" placeholder="LP123456789CN" value={form.tracking} onChange={set("tracking")} /></L>
          <L label="Corriere (opz.)"><input className="rk-input" placeholder="Yanwen, Cainiao…" value={form.corriere} onChange={set("corriere")} /></L>
          <L label="Data ordine"><input className="rk-input" type="date" value={form.data} onChange={set("data")} /></L>
          <L label="Nota (opz.)"><input className="rk-input" placeholder="Ordine 9 costumi" value={form.nota} onChange={set("nota")} /></L>
        </div>
        <p className="rk-mutlabel rk-mt12 rk-mb6">Cosa c'è nel pacco? (carica prima i pezzi in Stock)</p>
        {eligible.length === 0 ? <p className="rk-empty">Nessun articolo collegabile.</p> : (
          <div className="rk-picklist">
            {eligible.map((i) => (
              <label key={i.id} className={`rk-pick ${sel.includes(i.id) ? "on" : ""}`}>
                <input type="checkbox" className="rk-check" checked={sel.includes(i.id)} onChange={() => toggle(i.id)} />
                <span className="rk-chip">{i.sku}</span>
                <span className="rk-pick-name">{i.brand} · {i.nome}{i.taglia ? ` · ${i.taglia}` : ""}</span>
                {i.fisico !== "casa" && <span className="rk-badge rk-badge-travel">{FISICO_LABEL[i.fisico]}</span>}
              </label>
            ))}
          </div>
        )}
        <div className="rk-formfoot">
          <span className="rk-mutlabel">{sel.length} articoli · verranno segnati «in viaggio»</span>
          <button className="rk-btn rk-primary" disabled={!form.tracking.trim() || !sel.length}
            onClick={() => { onAdd(form, sel); setForm({ ...EMPTY_ORDER, data: todayISO() }); setSel([]); }}>
            <Plus size={15} /> Crea ordine
          </button>
        </div>
      </div>

      {data.orders.length === 0 ? <p className="rk-empty">Nessun ordine tracciato.</p> : (
        <div className="rk-rows">
          {data.orders.map((o) => (
            <div key={o.id} className={`rk-row ${o.stato === "consegnato" ? "rk-row-dim" : ""}`}>
              <span className="rk-chip">{o.tracking || "—"}</span>
              <div className="rk-row-main">
                <strong>{o.nota || `Ordine del ${o.data}`}{o.corriere ? ` · ${o.corriere}` : ""}</strong>
                <span className="rk-row-meta">{o.data} · {o.itemIds.length} pezzi: {o.itemIds.map((id) => skuOf(id)?.sku).filter(Boolean).slice(0, 5).join(", ")}{o.itemIds.length > 5 ? ` +${o.itemIds.length - 5}` : ""}</span>
              </div>
              <span className={`rk-badge ${o.stato === "in_viaggio" ? "rk-badge-travel" : "rk-badge-in"}`}>{o.stato === "in_viaggio" ? "in viaggio" : "consegnato"}</span>
              {o.tracking && <a className="rk-btn rk-ghost rk-small" href={`https://t.17track.net/it#nums=${encodeURIComponent(o.tracking)}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> 17track</a>}
              {o.stato === "in_viaggio" && <button className="rk-btn rk-primary rk-small" onClick={() => onDelivered(o)}>Consegnato</button>}
              <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(o)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Vendite ---------- */
const RESO_LABEL = { no: "", in_arrivo: "reso in arrivo", spedito: "reso spedito", consegnato: "reso consegnato" };
function SalesTab({ data, onDelete, onSetReso }) {
  if (data.sales.length === 0) return <p className="rk-empty">Nessuna vendita. Dallo Stock premi «Vendi».</p>;
  return (
    <div className="rk-rows">
      {data.sales.map((s) => {
        const reso = s.reso && s.reso !== "no";
        // con un reso il profitto della vendita va a zero (i costi vendita restano come spesa già sostenuta)
        const margine = reso ? 0 : s.prezzo - s.costo - (s.costiVendita || 0);
        const roi = s.costo > 0 ? (margine / s.costo) * 100 : 0;
        const tone = reso ? "mut" : roiTone(roi);
        const fasi = [["no", "Nessun reso"], ["in_arrivo", "Reso in arrivo"], ["spedito", "Reso spedito"], ["consegnato", "Reso consegnato → in stock"]];
        return (
          <div key={s.id} className={`rk-row ${reso ? "rk-row-reso" : ""}`}>
            <span className="rk-chip">{s.sku}</span>
            {reso && <span className="rk-badge rk-badge-reso">{RESO_LABEL[s.reso]}</span>}
            {s.giacenzaGiorni != null && !reso && <span className={`rk-badge rk-badge-giac ${s.giacenzaGiorni >= SLOW_DAYS ? "rk-badge-slow" : ""}`}><Clock size={11} /> {s.giacenzaGiorni}gg</span>}
            <div className="rk-row-main">
              <strong>{s.brand} · {s.nome}</strong>
              <span className="rk-row-meta">{s.data} · {s.canale} · {s.telefono}</span>
            </div>
            <div className="rk-saleNums rk-mono"><span>{eur(s.prezzo)}</span><span className="rk-mutlabel">costo {eur(s.costo)}{s.costiVendita ? ` + ${eur(s.costiVendita)}` : ""}</span></div>
            <div className="rk-saleMargin">
              <span className={`rk-mono rk-margin rk-tonetext-${tone}`}>{reso ? eur(0) : (margine >= 0 ? "+" : "") + eur(margine)}</span>
              {!reso && <span className={`rk-roi rk-tone-${tone}`}>ROI {roi.toFixed(0)}%</span>}
            </div>
            <select className="rk-input rk-input-auto rk-reso-select" value={s.reso || "no"} onChange={(e) => onSetReso(s, e.target.value)}>
              {fasi.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <button className="rk-btn rk-ghost rk-small rk-danger" title="Annulla vendita" onClick={() => onDelete(s)}><Trash2 size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Spese ---------- */
const EMPTY_EXP = { tipo: "Boost", importo: "", data: "", nota: "", telefono: "" };
function ExpensesTab({ data, onAdd, onDelete, onEdit }) {
  const [form, setForm] = useState({ ...EMPTY_EXP, data: todayISO() });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="rk-stack">
      <div className="rk-card">
        <div className="rk-formgrid">
          <L label="Tipo"><select className="rk-input" value={form.tipo} onChange={set("tipo")}>{EXPENSE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></L>
          <L label="Importo €"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={form.importo} onChange={set("importo")} /></L>
          <L label="Data"><input className="rk-input" type="date" value={form.data} onChange={set("data")} /></L>
          <L label="Telefono (opz.)"><select className="rk-input" value={form.telefono} onChange={set("telefono")}><option value="">—</option>{data.phones.map((p) => <option key={p} value={p}>{p}</option>)}</select></L>
          <L label="Nota" wide><input className="rk-input" placeholder="Boost 3gg / 100 buste…" value={form.nota} onChange={set("nota")} /></L>
        </div>
        <div className="rk-formfoot"><span />
          <button className="rk-btn rk-primary" disabled={!num(form.importo)} onClick={() => { onAdd(form); setForm({ ...EMPTY_EXP, data: todayISO() }); }}><Plus size={15} /> Registra spesa</button>
        </div>
      </div>
      {data.expenses.length === 0 ? <p className="rk-empty">Nessuna spesa.</p> : (
        <div className="rk-rows">
          {data.expenses.map((e) => (
            <div key={e.id} className="rk-row">
              <span className="rk-badge rk-badge-exp">{e.tipo}</span>
              <div className="rk-row-main"><strong>{e.nota || e.tipo}</strong><span className="rk-row-meta">{e.data}{e.telefono ? ` · ${e.telefono}` : ""}</span></div>
              <span className="rk-mono rk-neg">−{eur(e.importo)}</span>
              <button className="rk-btn rk-ghost rk-small" title="Modifica" onClick={() => onEdit(e)}><Pencil size={14} /></button>
              <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(e)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditExpenseModal({ exp, phones, onClose, onSave }) {
  const [form, setForm] = useState({
    tipo: exp.tipo, importo: String(exp.importo).replace(".", ","),
    data: exp.data, nota: exp.nota || "", telefono: exp.telefono || "",
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const tipi = EXPENSE_TYPES.includes(form.tipo) ? EXPENSE_TYPES : [form.tipo, ...EXPENSE_TYPES];
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Pencil size={16} /> Modifica spesa</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <div className="rk-formgrid rk-formgrid-tight">
        <L label="Tipo"><select className="rk-input" value={form.tipo} onChange={set("tipo")}>{tipi.map((t) => <option key={t}>{t}</option>)}</select></L>
        <L label="Importo €"><input className="rk-input rk-mono" inputMode="decimal" value={form.importo} onChange={set("importo")} /></L>
        <L label="Data"><input className="rk-input" type="date" value={form.data} onChange={set("data")} /></L>
        <L label="Telefono (opz.)"><select className="rk-input" value={form.telefono} onChange={set("telefono")}><option value="">—</option>{phones.map((p) => <option key={p} value={p}>{p}</option>)}</select></L>
        <L label="Nota" wide><input className="rk-input" placeholder="Es. 9 buste costumi" value={form.nota} onChange={set("nota")} /></L>
      </div>
      <div className="rk-formfoot"><span /><button className="rk-btn rk-primary" onClick={() => onSave(exp.id, { tipo: form.tipo, importo: num(form.importo), data: form.data, nota: form.nota.trim(), telefono: form.telefono })}>Salva</button></div>
    </Overlay>
  );
}

/* ---------- Saldo fornitore (admin) ---------- */
function CreditsTab({ data, balance, onIn, onPay, onDelete }) {
  const [inF, setInF] = useState({ ordine: "", nota: "", data: todayISO() });
  const [payF, setPayF] = useState({ importo: "", nota: "", data: todayISO() });
  const credito = +(num(inF.ordine) * (data.pct / 100)).toFixed(2);
  const usato = +Math.min(Math.max(balance, 0), num(payF.importo)).toFixed(2);
  const contanti = +(num(payF.importo) - usato).toFixed(2);

  return (
    <div className="rk-stack">
      <div className="rk-card rk-walletline rk-wallet-hero"><Wallet size={18} /><span>Credito disponibile dal fornitore</span><strong className="rk-mono">{eur(balance)}</strong></div>
      <div className="rk-grid2">
        <div className="rk-card">
          <h3 className="rk-h3">Ordine intermediato → credito {data.pct}%</h3>
          <div className="rk-formgrid rk-formgrid-tight">
            <L label="Importo ordine €"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={inF.ordine} onChange={(e) => setInF({ ...inF, ordine: e.target.value })} /></L>
            <L label="Data"><input className="rk-input" type="date" value={inF.data} onChange={(e) => setInF({ ...inF, data: e.target.value })} /></L>
            <L label="Nota" wide><input className="rk-input" placeholder="Ordine di Marco — 3 kit" value={inF.nota} onChange={(e) => setInF({ ...inF, nota: e.target.value })} /></L>
          </div>
          <div className="rk-formfoot">
            <span className="rk-mutlabel">Credito maturato: <strong className="rk-mono">{eur(credito)}</strong></span>
            <button className="rk-btn rk-primary" disabled={!credito} onClick={() => { onIn(inF); setInF({ ordine: "", nota: "", data: todayISO() }); }}><Plus size={15} /> Registra</button>
          </div>
        </div>
        <div className="rk-card">
          <h3 className="rk-h3">Soldi mandati al fornitore</h3>
          <div className="rk-formgrid rk-formgrid-tight">
            <L label="Importo inviato €"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={payF.importo} onChange={(e) => setPayF({ ...payF, importo: e.target.value })} /></L>
            <L label="Data"><input className="rk-input" type="date" value={payF.data} onChange={(e) => setPayF({ ...payF, data: e.target.value })} /></L>
            <L label="Nota" wide><input className="rk-input" placeholder="Pagamento ordine costumi" value={payF.nota} onChange={(e) => setPayF({ ...payF, nota: e.target.value })} /></L>
          </div>
          <div className="rk-formfoot">
            <span className="rk-mutlabel">Da credito <strong className="rk-mono rk-amber">{eur(usato)}</strong> · di tasca <strong className="rk-mono rk-neg">{eur(contanti)}</strong></span>
            <button className="rk-btn rk-primary" disabled={!num(payF.importo)} onClick={() => { onPay(payF); setPayF({ importo: "", nota: "", data: todayISO() }); }}><Plus size={15} /> Registra</button>
          </div>
        </div>
      </div>
      {data.credits.length === 0 ? <p className="rk-empty">Nessun movimento.</p> : (
        <div className="rk-rows">
          {data.credits.map((c) => (
            <div key={c.id} className="rk-row">
              <span className={`rk-badge ${c.tipo === "in" ? "rk-badge-in" : "rk-badge-out"}`}>{c.tipo === "in" ? "maturato" : "pagamento"}</span>
              <div className="rk-row-main">
                <strong>{c.nota || (c.tipo === "in" ? "Ordine intermediato" : "Pagamento fornitore")}</strong>
                <span className="rk-row-meta">{c.data}{c.tipo === "in" ? ` · ordine ${eur(c.ordine)}` : ` · inviati ${eur(c.importo)} (credito ${eur(c.usatoCredito)} + contanti ${eur(c.contanti)})`}</span>
              </div>
              <span className={`rk-mono ${c.tipo === "in" ? "rk-pos" : "rk-neg"}`}>{c.tipo === "in" ? "+" + eur(c.importo) : "−" + eur(c.usatoCredito || 0)}</span>
              <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(c)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Modali ---------- */
function SaleModal({ item, onClose, onConfirm }) {
  const [form, setForm] = useState({ prezzo: "", canale: "Vinted", canaleAltro: "", costi: "", data: todayISO() });
  const [busy, setBusy] = useState(false);
  const margine = num(form.prezzo) - item.costo - num(form.costi);
  const roi = item.costo > 0 ? (margine / item.costo) * 100 : 0;
  const giac = daysBetween(item.caricatoAt || item.data, form.data || todayISO());
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><span className="rk-chip">{item.sku}</span><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <h3 className="rk-modal-title">{item.brand} · {item.nome}</h3>
      <p className="rk-mutlabel">Costo {eur(item.costo)} · {item.telefono || "in stock"}{giac != null ? ` · giacenza ${giac}gg` : ""}</p>
      <div className="rk-formgrid rk-formgrid-tight">
        <L label="Prezzo vendita €"><input autoFocus className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={form.prezzo} onChange={(e) => setForm({ ...form, prezzo: e.target.value })} /></L>
        <L label="Canale"><select className="rk-input" value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></L>
        {form.canale === "Altro" && <L label="Quale canale?" wide><input className="rk-input" placeholder="Es. Subito, Instagram…" value={form.canaleAltro} onChange={(e) => setForm({ ...form, canaleAltro: e.target.value })} /></L>}
        <L label="Costi vendita € (opz.)"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={form.costi} onChange={(e) => setForm({ ...form, costi: e.target.value })} /></L>
        <L label="Data"><input className="rk-input" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></L>
      </div>
      <div className="rk-formfoot">
        <span className="rk-mutlabel">Margine <strong className={`rk-mono rk-tonetext-${roiTone(roi)}`}>{eur(margine)}</strong> · ROI <strong className={`rk-mono rk-tonetext-${roiTone(roi)}`}>{roi.toFixed(0)}%</strong></span>
        <button className="rk-btn rk-primary" disabled={!num(form.prezzo) || busy} onClick={() => { setBusy(true); onConfirm(item, form); }}>{busy ? <Loader2 size={15} className="rk-spin" /> : null} Registra vendita</button>
      </div>
    </Overlay>
  );
}
function BulkSaleModal({ items, onClose, onConfirm }) {
  const [form, setForm] = useState({ prezzo: "", canale: "Vinted", canaleAltro: "", costi: "", data: todayISO() });
  const [busy, setBusy] = useState(false);
  const costoTot = items.reduce((a, i) => a + i.costo, 0);
  const ricavoTot = items.length * num(form.prezzo);
  const margine = ricavoTot - items.length * num(form.costi) - costoTot;
  const roi = costoTot > 0 ? (margine / costoTot) * 100 : 0;
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Tag size={16} /> Vendi {items.length} pezzi</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <p className="rk-mutlabel rk-mb6">{items.slice(0, 4).map((i) => i.sku).join(", ")}{items.length > 4 ? ` +${items.length - 4}` : ""} · costo {eur(costoTot)}</p>
      <div className="rk-formgrid rk-formgrid-tight">
        <L label="Prezzo per pezzo €"><input autoFocus className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={form.prezzo} onChange={(e) => setForm({ ...form, prezzo: e.target.value })} /></L>
        <L label="Canale"><select className="rk-input" value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></L>
        {form.canale === "Altro" && <L label="Quale canale?" wide><input className="rk-input" placeholder="Es. Subito, Instagram…" value={form.canaleAltro} onChange={(e) => setForm({ ...form, canaleAltro: e.target.value })} /></L>}
        <L label="Costi per pezzo € (opz.)"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={form.costi} onChange={(e) => setForm({ ...form, costi: e.target.value })} /></L>
        <L label="Data"><input className="rk-input" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></L>
      </div>
      <div className="rk-formfoot">
        <span className="rk-mutlabel">Ricavo <strong className="rk-mono">{eur(ricavoTot)}</strong> · Margine <strong className={`rk-mono rk-tonetext-${roiTone(roi)}`}>{eur(margine)}</strong> · ROI <strong className={`rk-mono rk-tonetext-${roiTone(roi)}`}>{roi.toFixed(0)}%</strong></span>
        <button className="rk-btn rk-primary" disabled={!num(form.prezzo) || busy} onClick={() => { setBusy(true); onConfirm(items, form); }}>{busy ? <Loader2 size={15} className="rk-spin" /> : null} Registra {items.length}</button>
      </div>
    </Overlay>
  );
}
function AssignPhoneModal({ phones, count, onClose, onConfirm }) {
  const [phone, setPhone] = useState(phones[0] || "");
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Smartphone size={16} /> Carica su account</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <p className="rk-mutlabel rk-mb6">{count > 1 ? `${count} articoli` : "L'articolo"} verrà segnato «caricato».</p>
      <select className="rk-input" value={phone} onChange={(e) => setPhone(e.target.value)}>
        {phones.map((p) => <option key={p} value={p}>{p}</option>)}
        <option value="__none__">↩ Rimetti in stock (scarica)</option>
      </select>
      <div className="rk-formfoot rk-mt12"><span /><button className="rk-btn rk-primary" onClick={() => onConfirm(phone)}>Conferma</button></div>
    </Overlay>
  );
}
function EditItemModal({ item, onClose, onSave }) {
  const [form, setForm] = useState({ nome: item.nome, taglia: item.taglia, costo: String(item.costo).replace(".", ","), note: item.note || "", fisico: item.fisico || "casa", data: item.data });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><span className="rk-chip">{item.sku}</span><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <h3 className="rk-modal-title"><Pencil size={15} /> Modifica articolo</h3>
      <div className="rk-formgrid rk-formgrid-tight">
        <L label="Articolo" wide><input className="rk-input" value={form.nome} onChange={set("nome")} /></L>
        <L label="Taglia"><input className="rk-input" value={form.taglia} onChange={set("taglia")} /></L>
        <L label="Costo €"><input className="rk-input rk-mono" inputMode="decimal" value={form.costo} onChange={set("costo")} /></L>
        <L label="Dove si trova"><select className="rk-input" value={form.fisico} onChange={set("fisico")}>{FISICO_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></L>
        <L label="Data carico"><input className="rk-input" type="date" value={form.data} onChange={set("data")} /></L>
        <L label="Note" wide><textarea className="rk-input rk-textarea" rows={3} value={form.note} onChange={set("note")} /></L>
      </div>
      <div className="rk-formfoot"><span /><button className="rk-btn rk-primary" onClick={() => onSave(item.id, { nome: form.nome.trim(), taglia: form.taglia.trim(), costo: num(form.costo), note: form.note.trim(), fisico: form.fisico, data: form.data })}>Salva</button></div>
    </Overlay>
  );
}
function BulkNoteModal({ count, onClose, onConfirm }) {
  const [note, setNote] = useState("");
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Pencil size={16} /> Nota su {count} articoli</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <textarea autoFocus className="rk-input rk-textarea" rows={3} placeholder="Es. Ordine fornitore 10/06" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="rk-formfoot rk-mt12"><span /><button className="rk-btn rk-primary" disabled={!note.trim()} onClick={() => onConfirm(note.trim())}>Applica</button></div>
    </Overlay>
  );
}
function BulkFisicoModal({ count, onClose, onConfirm }) {
  const [f, setF] = useState("casa");
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Truck size={16} /> Posizione di {count} articoli</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <select className="rk-input" value={f} onChange={(e) => setF(e.target.value)}>{FISICO_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      <div className="rk-formfoot rk-mt12"><span /><button className="rk-btn rk-primary" onClick={() => onConfirm(f)}>Applica</button></div>
    </Overlay>
  );
}
function SettingsModal({ data, role, onClose, onSave }) {
  const [phones, setPhones] = useState([...data.phones]);
  const [pct, setPct] = useState(String(data.pct));
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Settings size={16} /> Impostazioni</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <p className="rk-mutlabel rk-mb6">Telefoni / account</p>
      <div className="rk-stack-tight">
        {phones.map((p, idx) => (
          <div key={idx} className="rk-phone-edit">
            <Smartphone size={14} />
            <input className="rk-input" value={p} onChange={(e) => { const n = [...phones]; n[idx] = e.target.value; setPhones(n); }} />
            <button className="rk-btn rk-ghost rk-sq rk-danger" onClick={() => setPhones(phones.filter((_, i) => i !== idx))}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="rk-btn rk-ghost" onClick={() => setPhones([...phones, `Account ${phones.length + 1}`])}><Plus size={14} /> Aggiungi telefono</button>
      </div>
      {role === "admin" && (
        <>
          <p className="rk-mutlabel rk-mt12 rk-mb6">Percentuale intermediazione fornitore</p>
          <div className="rk-phone-edit"><input className="rk-input rk-mono rk-input-auto" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /><span className="rk-mutlabel">% sull'ordine</span></div>
        </>
      )}
      <div className="rk-formfoot rk-mt12"><span /><button className="rk-btn rk-primary" onClick={() => onSave(phones, pct)}>Salva</button></div>
    </Overlay>
  );
}
/* ---------- To-do ---------- */
function TodoTab({ data, onAdd, onToggle, onDelete }) {
  const [testo, setTesto] = useState("");
  const aperti = data.todos.filter((t) => !t.fatto);
  const fatti = data.todos.filter((t) => t.fatto);
  const add = () => { if (testo.trim()) { onAdd(testo.trim()); setTesto(""); } };
  return (
    <div className="rk-stack">
      <div className="rk-card">
        <div className="rk-todoadd">
          <input className="rk-input" placeholder="Es. Spedire COS-012 · rispondere a offerta…" value={testo}
            onChange={(e) => setTesto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="rk-btn rk-primary" disabled={!testo.trim()} onClick={add}><Plus size={15} /> Aggiungi</button>
        </div>
      </div>
      {data.todos.length === 0 ? <p className="rk-empty">Nessun promemoria. Aggiungi la prima cosa da fare.</p> : (
        <div className="rk-rows">
          {aperti.map((t) => (
            <div key={t.id} className="rk-row rk-todo">
              <button className="rk-todocheck" onClick={() => onToggle(t)} aria-label="Fatto" />
              <span className="rk-row-main"><strong>{t.testo}</strong></span>
              <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(t)}><Trash2 size={14} /></button>
            </div>
          ))}
          {fatti.map((t) => (
            <div key={t.id} className="rk-row rk-todo rk-todo-done">
              <button className="rk-todocheck on" onClick={() => onToggle(t)} aria-label="Riapri"><Check size={12} /></button>
              <span className="rk-row-main"><strong>{t.testo}</strong></span>
              <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(t)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- dati demo ---------- */
function demoFixture() {
  const today = todayISO();
  const dAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const tAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
  const id = (x) => "demo-" + x;
  return {
    profile: { role: "admin", pct: 5, phones: ["iPhone Vinted", "Account 2", "Account 3"], email: "demo@rack.app" },
    data: {
      items: [
        { id: id("i1"), sku: "BUR-COS-001", brand: "Burberry", nome: "Costume check", categoria: "Costume", taglia: "M", costo: 15.41, telefono: "iPhone Vinted", stato: "caricato", fisico: "casa", vinted: true, caricatoAt: tAgo(42), data: dAgo(45), note: "" },
        { id: id("i2"), sku: "BUR-COS-002", brand: "Burberry", nome: "Costume blu", categoria: "Costume", taglia: "L", costo: 15.41, telefono: "Account 2", stato: "caricato", fisico: "casa", vinted: false, caricatoAt: tAgo(5), data: dAgo(7), note: "" },
        { id: id("i3"), sku: "JUV-KIT-001", brand: "Juventus", nome: "Kit home 24/25", categoria: "Kit calcio", taglia: "M", costo: 22.00, telefono: "", stato: "stock", fisico: "viaggio", vinted: false, caricatoAt: null, data: today, note: "Ordine fornitore" },
        { id: id("i4"), sku: "NIK-TUT-001", brand: "Nike", nome: "Tuta tech", categoria: "Tuta", taglia: "S", costo: 28.00, telefono: "", stato: "stock", fisico: "ordinato", vinted: false, caricatoAt: null, data: today, note: "" },
      ],
      sales: [
        { id: id("s1"), itemId: id("x1"), sku: "BUR-COS-010", nome: "Costume nero", brand: "Burberry", prezzo: 39.90, costo: 15.41, costiVendita: 0.24, canale: "Vinted", data: dAgo(1), telefono: "iPhone Vinted", reso: "no", giacenzaGiorni: 6 },
        { id: id("s2"), itemId: id("x2"), sku: "JUV-KIT-010", nome: "Kit away", brand: "Juventus", prezzo: 45.00, costo: 22.00, costiVendita: 0, canale: "eBay", data: today, telefono: "Account 2", reso: "no", giacenzaGiorni: 18 },
        { id: id("s3"), itemId: id("x3"), sku: "NIK-TUT-010", nome: "Tuta grigia", brand: "Nike", prezzo: 49.00, costo: 28.00, costiVendita: 0.50, canale: "Depop", data: dAgo(3), telefono: "Account 3", reso: "in_arrivo", giacenzaGiorni: 40 },
      ],
      expenses: [
        { id: id("e1"), tipo: "Boost", importo: 3.99, data: dAgo(2), nota: "Boost 3gg iPhone Vinted", telefono: "iPhone Vinted", saleId: null },
        { id: id("e2"), tipo: "Buste / packaging", importo: 4.80, data: dAgo(4), nota: "20 buste", telefono: "", saleId: null },
        { id: id("e3"), tipo: "Costi vendita", importo: 0.24, data: dAgo(1), nota: "Costi vendita BUR-COS-010", telefono: "iPhone Vinted", saleId: id("s1") },
      ],
      credits: [
        { id: id("c1"), tipo: "in", ordine: 200, importo: 10, usatoCredito: 0, contanti: 0, data: dAgo(6), nota: "Ordine di Marco" },
        { id: id("c2"), tipo: "pagamento", ordine: 0, importo: 150, usatoCredito: 10, contanti: 140, data: dAgo(3), nota: "Pagamento lotto costumi" },
      ],
      orders: [
        { id: id("o1"), tracking: "LP00123456789CN", corriere: "Yanwen", nota: "10 costumi + 5 kit", data: dAgo(2), stato: "in_viaggio", itemIds: [id("i3")] },
      ],
      todos: [
        { id: id("t1"), testo: "Spedire JUV-KIT-010 a Luca", fatto: false },
        { id: id("t2"), testo: "Rispondere offerta su BUR-COS-002", fatto: false },
        { id: id("t3"), testo: "Ricomprare buste", fatto: true },
      ],
    },
  };
}

function Overlay({ children, onClose }) {
  return <div className="rk-overlay" onClick={onClose}><div className="rk-modal" onClick={(e) => e.stopPropagation()}>{children}</div></div>;
}
function L({ label, children, wide }) {
  return <label className={`rk-field ${wide ? "rk-field-wide" : ""}`}><span className="rk-field-label">{label}</span>{children}</label>;
}
