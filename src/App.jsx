import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus, Settings, Download, X, Trash2, Gift, Smartphone, Wallet, LogOut,
  Package, Receipt, ChevronLeft, ChevronRight, Search, TrendingUp, Tag,
  Truck, Pencil, ExternalLink, Check, Loader2
} from "lucide-react";
import { supabase } from "./supabaseClient";
import AuthPage from "./auth/AuthPage";
import {
  loadProfile, updateProfile, loadAll,
  insertRow, insertMany, updateRow, deleteRow, deleteWhere,
} from "./lib/db";

/* ============================================================ */
const EXPENSE_TYPES = ["Boost", "Buste / packaging", "Regalo", "Spedizione", "Costi vendita", "Altro"];
const CHANNELS = ["Vinted", "Reseller", "Altro"];
const ACTIVE = ["stock", "caricato"];
const FISICO_LABEL = { ordinato: "ordinato · da spedire", viaggio: "in viaggio", casa: "a casa" };
const FISICO_OPTS = [
  ["ordinato", "Ordinato · il fornitore deve spedire"],
  ["viaggio", "In viaggio verso di me"],
  ["casa", "A casa"],
];
const STATO_LABEL = { stock: "in stock", caricato: "caricato", venduto: "venduto", regalato: "regalato" };

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const thisYM = () => todayISO().slice(0, 7);
const eur = (n) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const codeOf = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "X");
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="rk-root rk-loading"><div className="rk-loader">
        <span className="rk-chip rk-chip-logo">RACK</span><p>Carico…</p>
      </div></div>
    );
  }
  if (!session) return <AuthPage />;
  return <Workspace session={session} />;
}

/* ============================================================
   Workspace: l'app vera, dopo il login
   ============================================================ */
function Workspace({ session }) {
  const userId = session.user.id;
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

  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    (async () => {
      try {
        const [p, d] = await Promise.all([loadProfile(userId), loadAll(userId)]);
        setProfile(p);
        setData({ ...d, phones: p.phones, pct: p.pct });
      } catch (e) {
        setToast("Errore di caricamento dati");
        console.error(e);
      }
    })();
  }, [userId]);

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
        vinted: !!form.telefono, data: form.data || todayISO(), note: form.note.trim(),
      });
    }
    try {
      const created = await insertMany("items", objs, userId);
      apply((d) => { d.items = [...created, ...d.items]; return d; }, qty > 1 ? `${qty} articoli caricati` : "Articolo caricato");
    } catch (e) { flash("Errore nel salvataggio"); }
  };

  const sellOne = async (item, form) => {
    try {
      const sale = await insertRow("sales", {
        itemId: item.id, sku: item.sku, nome: item.nome, brand: item.brand,
        prezzo: num(form.prezzo), costo: item.costo, costiVendita: num(form.costi),
        canale: form.canale, data: form.data || todayISO(), telefono: item.telefono,
      }, userId);
      await updateRow("items", item.id, { stato: "venduto" });
      let exp = null;
      if (num(form.costi) > 0) {
        exp = await insertRow("expenses", {
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
        const sale = await insertRow("sales", {
          itemId: item.id, sku: item.sku, nome: item.nome, brand: item.brand,
          prezzo: num(form.prezzo), costo: item.costo, costiVendita: num(form.costi),
          canale: form.canale, data: form.data || todayISO(), telefono: item.telefono || "—",
        }, userId);
        await updateRow("items", item.id, { stato: "venduto" });
        let exp = null;
        if (num(form.costi) > 0) {
          exp = await insertRow("expenses", {
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
      await updateRow("items", item.id, { stato: "regalato" });
      const exp = await insertRow("expenses", {
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
    try { await deleteRow("items", item.id);
      apply((d) => { d.items = d.items.filter((i) => i.id !== item.id); return d; }, "Articolo eliminato");
    } catch (e) { flash("Errore"); }
  };

  const removeSale = async (sale) => {
    if (!window.confirm(`Annullare la vendita di ${sale.sku}? L'articolo torna in magazzino.`)) return;
    try {
      await deleteRow("sales", sale.id);
      await deleteWhere("expenses", "sale_id", sale.id);
      const it = data.items.find((i) => i.id === sale.itemId);
      if (it) await updateRow("items", it.id, { stato: it.telefono ? "caricato" : "stock" });
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
    try { await updateRow("items", id, patch);
      apply((d) => { const it = d.items.find((i) => i.id === id); if (it) Object.assign(it, patch); return d; }, "Articolo aggiornato");
    } catch (e) { flash("Errore"); }
    setEditItem(null);
  };

  const toggleVinted = async (item) => {
    const v = !item.vinted;
    try { await updateRow("items", item.id, { vinted: v });
      apply((d) => { const it = d.items.find((i) => i.id === item.id); if (it) it.vinted = v; return d; });
    } catch (e) { flash("Errore"); }
  };

  const bulkNote = async (ids, note) => {
    try { for (const id of ids) await updateRow("items", id, { note });
      apply((d) => { d.items.forEach((i) => { if (ids.includes(i.id)) i.note = note; }); return d; }, `Nota applicata a ${ids.length} articoli`);
    } catch (e) { flash("Errore"); }
    setBulkNoteIds(null);
  };

  const bulkFisico = async (ids, fisico) => {
    try { for (const id of ids) await updateRow("items", id, { fisico });
      apply((d) => { d.items.forEach((i) => { if (ids.includes(i.id)) i.fisico = fisico; }); return d; }, `${ids.length} articoli: ${FISICO_LABEL[fisico]}`);
    } catch (e) { flash("Errore"); }
    setBulkFisicoIds(null);
  };

  const assignPhone = async (ids, phone) => {
    const none = phone === "__none__";
    try {
      for (const id of ids) await updateRow("items", id, none ? { telefono: "", stato: "stock", vinted: false } : { telefono: phone, stato: "caricato" });
      apply((d) => {
        d.items.forEach((i) => {
          if (ids.includes(i.id)) {
            if (none) { i.telefono = ""; i.stato = "stock"; i.vinted = false; }
            else { i.telefono = phone; i.stato = "caricato"; }
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
      const o = await insertRow("orders", {
        tracking: form.tracking.trim(), corriere: form.corriere.trim(), nota: form.nota.trim(),
        data: form.data || todayISO(), stato: "in_viaggio", itemIds,
      }, userId);
      for (const id of itemIds) await updateRow("items", id, { fisico: "viaggio" });
      apply((d) => {
        d.orders = [o, ...d.orders];
        d.items.forEach((i) => { if (itemIds.includes(i.id)) i.fisico = "viaggio"; });
        return d;
      }, "Ordine creato");
    } catch (e) { flash("Errore"); }
  };

  const orderDelivered = async (order) => {
    try {
      await updateRow("orders", order.id, { stato: "consegnato" });
      for (const id of order.itemIds) await updateRow("items", id, { fisico: "casa" });
      apply((d) => {
        const o = d.orders.find((x) => x.id === order.id); if (o) o.stato = "consegnato";
        d.items.forEach((i) => { if (order.itemIds.includes(i.id)) i.fisico = "casa"; });
        return d;
      }, "Consegnato · pezzi a casa");
    } catch (e) { flash("Errore"); }
  };

  const removeOrder = async (order) => {
    if (!window.confirm("Eliminare questo ordine? Gli articoli non vengono toccati.")) return;
    try { await deleteRow("orders", order.id);
      apply((d) => { d.orders = d.orders.filter((o) => o.id !== order.id); return d; }, "Ordine eliminato");
    } catch (e) { flash("Errore"); }
  };

  /* spese */
  const addExpense = async (form) => {
    try {
      const e = await insertRow("expenses", {
        tipo: form.tipo, importo: num(form.importo), data: form.data || todayISO(),
        nota: form.nota.trim(), telefono: form.telefono || "",
      }, userId);
      apply((d) => { d.expenses = [e, ...d.expenses]; return d; }, "Spesa registrata");
    } catch (er) { flash("Errore"); }
  };
  const removeExpense = async (e) => {
    try { await deleteRow("expenses", e.id);
      apply((d) => { d.expenses = d.expenses.filter((x) => x.id !== e.id); return d; }, "Spesa eliminata");
    } catch (er) { flash("Errore"); }
  };

  /* crediti (solo admin) */
  const addCreditIn = async (form) => {
    const ordine = num(form.ordine);
    try {
      const c = await insertRow("credits", {
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
      const c = await insertRow("credits", {
        tipo: "pagamento", ordine: 0, importo,
        usatoCredito: usato, contanti: +(importo - usato).toFixed(2),
        data: form.data || todayISO(), nota: form.nota.trim(),
      }, userId);
      apply((d) => { d.credits = [c, ...d.credits]; return d; }, "Pagamento al fornitore registrato");
    } catch (e) { flash("Errore"); }
  };
  const removeCredit = async (c) => {
    try { await deleteRow("credits", c.id);
      apply((d) => { d.credits = d.credits.filter((x) => x.id !== c.id); return d; }, "Movimento eliminato");
    } catch (e) { flash("Errore"); }
  };

  /* impostazioni */
  const saveSettings = async (phones, pct) => {
    const clean = phones.filter((p) => p.trim());
    try {
      await updateProfile(userId, { phones: clean, pct: num(pct) || 5 });
      apply((d) => { d.phones = clean; d.pct = num(pct) || 5; return d; }, "Impostazioni salvate");
    } catch (e) { flash("Errore"); }
    setShowSettings(false);
  };

  const logout = async () => { await supabase.auth.signOut(); };

  const exportCSV = () => {
    const rows = [["Data", "Tipo", "Riferimento", "Descrizione", "Canale/Telefono", "Entrata", "Uscita"]];
    data.sales.forEach((s) => rows.push([s.data, "Vendita", s.sku, `${s.brand} ${s.nome}`.trim(), s.canale, s.prezzo, 0]));
    data.sales.forEach((s) => rows.push([s.data, "Costo merce", s.sku, `Acquisto ${s.brand} ${s.nome}`.trim(), s.telefono, 0, s.costo]));
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

  const tabs = [
    ["dash", "Dashboard", <TrendingUp size={14} key="i" />],
    ["stock", "Stock", <Package size={14} key="i" />],
    ["ord", "Ordini", <Truck size={14} key="i" />],
    ["sales", "Vendite", <Tag size={14} key="i" />],
    ["exp", "Spese", <Receipt size={14} key="i" />],
    ...(isAdmin ? [["cred", "Saldo fornitore", <Wallet size={14} key="i" />]] : []),
  ];
  const inViaggioOrd = data.orders.filter((o) => o.stato === "in_viaggio").length;

  return (
    <div className="rk-root">
      <header className="rk-header">
        <div className="rk-brandmark">
          <span className="rk-chip rk-chip-logo">RACK</span>
          <span className="rk-sub rk-hide-sm">{profile.email}</span>
        </div>
        <div className="rk-header-actions">
          <button className="rk-btn rk-ghost" onClick={exportCSV} title="Esporta CSV"><Download size={15} /><span className="rk-hide-sm">CSV</span></button>
          <button className="rk-btn rk-ghost" onClick={() => setShowSettings(true)} title="Impostazioni"><Settings size={15} /><span className="rk-hide-sm">Telefoni</span></button>
          <button className="rk-btn rk-ghost" onClick={logout} title="Esci"><LogOut size={15} /></button>
        </div>
      </header>

      <nav className="rk-tabs">
        {tabs.map(([id, label, icon]) => (
          <button key={id} className={`rk-tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
            {icon} {label}
            {id === "cred" && creditBalance > 0 && <span className="rk-tab-pill">{eur(creditBalance)}</span>}
            {id === "ord" && inViaggioOrd > 0 && <span className="rk-tab-pill">{inViaggioOrd} in viaggio</span>}
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
        {tab === "sales" && <SalesTab data={data} onDelete={removeSale} />}
        {tab === "exp" && <ExpensesTab data={data} onAdd={addExpense} onDelete={removeExpense} />}
        {tab === "cred" && isAdmin && <CreditsTab data={data} balance={creditBalance} onIn={addCreditIn} onPay={addPayment} onDelete={removeCredit} />}
      </main>

      {saleItem && <SaleModal item={saleItem} onClose={() => setSaleItem(null)} onConfirm={sellOne} />}
      {bulkSale && <BulkSaleModal items={bulkSale} onClose={() => setBulkSale(null)} onConfirm={sellBulk} />}
      {assignIds && <AssignPhoneModal phones={data.phones} count={assignIds.length} onClose={() => setAssignIds(null)} onConfirm={(p) => assignPhone(assignIds, p)} />}
      {editItem && <EditItemModal item={editItem} onClose={() => setEditItem(null)} onSave={saveEdit} />}
      {bulkNoteIds && <BulkNoteModal count={bulkNoteIds.length} onClose={() => setBulkNoteIds(null)} onConfirm={(n) => bulkNote(bulkNoteIds, n)} />}
      {bulkFisicoIds && <BulkFisicoModal count={bulkFisicoIds.length} onClose={() => setBulkFisicoIds(null)} onConfirm={(f) => bulkFisico(bulkFisicoIds, f)} />}
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
    const expenses = data.expenses.filter((e) => (e.data || "").slice(0, 7) === ym);
    const creditsIn = data.credits.filter((c) => c.tipo === "in" && (c.data || "").slice(0, 7) === ym);
    const ricavi = sales.reduce((a, s) => a + s.prezzo, 0);
    const cogs = sales.reduce((a, s) => a + s.costo, 0);
    const spese = expenses.reduce((a, e) => a + e.importo, 0);
    const maturati = creditsIn.reduce((a, c) => a + c.importo, 0);
    return { nVendite: sales.length, ricavi, cogs, spese, maturati,
      profitto: ricavi - cogs - spese + (isAdmin ? maturati : 0) };
  }, [data, ym, isAdmin]);

  const stock = useMemo(() => {
    const attivi = data.items.filter((i) => ACTIVE.includes(i.stato));
    const caricati = attivi.filter((i) => i.stato === "caricato");
    const perPhone = {};
    data.phones.forEach((p) => (perPhone[p] = 0));
    caricati.forEach((i) => { perPhone[i.telefono] = (perPhone[i.telefono] || 0) + 1; });
    return {
      n: attivi.length, nonCaricati: attivi.length - caricati.length,
      inViaggio: attivi.filter((i) => i.fisico === "viaggio").length,
      ordinati: attivi.filter((i) => i.fisico === "ordinato").length,
      valore: attivi.reduce((a, i) => a + i.costo, 0), perPhone,
    };
  }, [data]);
  const maxPhone = Math.max(1, ...Object.values(stock.perPhone));

  return (
    <div className="rk-stack">
      <div className="rk-monthnav">
        <button className="rk-btn rk-ghost rk-sq" onClick={() => setYm(shiftYM(ym, -1))}><ChevronLeft size={16} /></button>
        <h2>{ymLabel(ym)}</h2>
        <button className="rk-btn rk-ghost rk-sq" onClick={() => setYm(shiftYM(ym, 1))} disabled={ym >= thisYM()}><ChevronRight size={16} /></button>
      </div>
      <div className="rk-kpis">
        <Kpi label="Ricavi vendite" value={eur(m.ricavi)} sub={`${m.nVendite} pezzi venduti`} />
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
function SalesTab({ data, onDelete }) {
  if (data.sales.length === 0) return <p className="rk-empty">Nessuna vendita. Dallo Stock premi «Vendi».</p>;
  return (
    <div className="rk-rows">
      {data.sales.map((s) => {
        const margine = s.prezzo - s.costo - (s.costiVendita || 0);
        return (
          <div key={s.id} className="rk-row">
            <span className="rk-chip">{s.sku}</span>
            <div className="rk-row-main">
              <strong>{s.brand} · {s.nome}</strong>
              <span className="rk-row-meta">{s.data} · {s.canale} · {s.telefono}</span>
            </div>
            <div className="rk-saleNums rk-mono"><span>{eur(s.prezzo)}</span><span className="rk-mutlabel">costo {eur(s.costo)}{s.costiVendita ? ` + ${eur(s.costiVendita)}` : ""}</span></div>
            <span className={`rk-mono rk-margin ${margine >= 0 ? "rk-pos" : "rk-neg"}`}>{margine >= 0 ? "+" : ""}{eur(margine)}</span>
            <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(s)}><Trash2 size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Spese ---------- */
const EMPTY_EXP = { tipo: "Boost", importo: "", data: "", nota: "", telefono: "" };
function ExpensesTab({ data, onAdd, onDelete }) {
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
              <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(e)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
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
  const [form, setForm] = useState({ prezzo: "", canale: "Vinted", costi: "", data: todayISO() });
  const [busy, setBusy] = useState(false);
  const margine = num(form.prezzo) - item.costo - num(form.costi);
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><span className="rk-chip">{item.sku}</span><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <h3 className="rk-modal-title">{item.brand} · {item.nome}</h3>
      <p className="rk-mutlabel">Costo {eur(item.costo)} · {item.telefono || "in stock"}</p>
      <div className="rk-formgrid rk-formgrid-tight">
        <L label="Prezzo vendita €"><input autoFocus className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={form.prezzo} onChange={(e) => setForm({ ...form, prezzo: e.target.value })} /></L>
        <L label="Canale"><select className="rk-input" value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></L>
        <L label="Costi vendita € (opz.)"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={form.costi} onChange={(e) => setForm({ ...form, costi: e.target.value })} /></L>
        <L label="Data"><input className="rk-input" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></L>
      </div>
      <div className="rk-formfoot">
        <span className="rk-mutlabel">Margine: <strong className={`rk-mono ${margine >= 0 ? "rk-pos" : "rk-neg"}`}>{eur(margine)}</strong></span>
        <button className="rk-btn rk-primary" disabled={!num(form.prezzo) || busy} onClick={() => { setBusy(true); onConfirm(item, form); }}>{busy ? <Loader2 size={15} className="rk-spin" /> : null} Registra vendita</button>
      </div>
    </Overlay>
  );
}
function BulkSaleModal({ items, onClose, onConfirm }) {
  const [form, setForm] = useState({ prezzo: "", canale: "Vinted", costi: "", data: todayISO() });
  const [busy, setBusy] = useState(false);
  const costoTot = items.reduce((a, i) => a + i.costo, 0);
  const ricavoTot = items.length * num(form.prezzo);
  const margine = ricavoTot - items.length * num(form.costi) - costoTot;
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Tag size={16} /> Vendi {items.length} pezzi</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <p className="rk-mutlabel rk-mb6">{items.slice(0, 4).map((i) => i.sku).join(", ")}{items.length > 4 ? ` +${items.length - 4}` : ""} · costo {eur(costoTot)}</p>
      <div className="rk-formgrid rk-formgrid-tight">
        <L label="Prezzo per pezzo €"><input autoFocus className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={form.prezzo} onChange={(e) => setForm({ ...form, prezzo: e.target.value })} /></L>
        <L label="Canale"><select className="rk-input" value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></L>
        <L label="Costi per pezzo € (opz.)"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0,00" value={form.costi} onChange={(e) => setForm({ ...form, costi: e.target.value })} /></L>
        <L label="Data"><input className="rk-input" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></L>
      </div>
      <div className="rk-formfoot">
        <span className="rk-mutlabel">Ricavo <strong className="rk-mono">{eur(ricavoTot)}</strong> · Margine <strong className={`rk-mono ${margine >= 0 ? "rk-pos" : "rk-neg"}`}>{eur(margine)}</strong></span>
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
function Overlay({ children, onClose }) {
  return <div className="rk-overlay" onClick={onClose}><div className="rk-modal" onClick={(e) => e.stopPropagation()}>{children}</div></div>;
}
function L({ label, children, wide }) {
  return <label className={`rk-field ${wide ? "rk-field-wide" : ""}`}><span className="rk-field-label">{label}</span>{children}</label>;
}
