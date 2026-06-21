import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus, Settings, Download, X, Trash2, Gift, Smartphone, Wallet, LogOut,
  Package, Receipt, ChevronLeft, ChevronRight, Search, TrendingUp, Tag,
  Truck, Pencil, ExternalLink, Check, Loader2, ListTodo, Flame, Clock, BarChart3,
  Users, Coins, Copy, UserPlus, Crown, Eye
} from "lucide-react";
import { supabase } from "./supabaseClient";
import AuthPage from "./auth/AuthPage";
import {
  loadWorkspaceContext, createWorkspace, joinWorkspace, updateWorkspace, setMemberRole,
  loadAll, insertRow, insertMany, updateRow, deleteRow, deleteWhere,
} from "./lib/db";

/* ============================================================ */
const EXPENSE_TYPES = ["Boost", "Packaging", "Gift", "Shipping", "Selling fees", "Other"];
const CHANNELS = ["Vinted", "eBay", "Depop", "Facebook Marketplace", "Other"];
const ACTIVE = ["stock", "caricato"];
const FISICO_LABEL = { ordinato: "ordered · to ship", viaggio: "in transit", casa: "at home" };
const FISICO_OPTS = [
  ["ordinato", "Ordered · supplier must ship"],
  ["viaggio", "In transit to me"],
  ["casa", "At home"],
];
const STATO_LABEL = { stock: "in stock", caricato: "listed", venduto: "sold", regalato: "gifted" };
const RESO_LABEL = { no: "", in_arrivo: "return incoming", spedito: "return shipped", consegnato: "return received" };
const ROLE_LABEL = { manager: "Manager", investor: "Investor", seller: "Seller" };
const SLOW_DAYS = 30;

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const thisYM = () => todayISO().slice(0, 7);
const eur = (n) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const codeOf = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "X");
const daysBetween = (from, to) => {
  if (!from) return null;
  const a = new Date(from); const b = to ? new Date(to) : new Date();
  if (isNaN(a)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
};
const roiTone = (roi) => (roi >= 80 ? "green" : roi >= 30 ? "amber" : "red");
const chanValue = (form) => (form.canale === "Other" ? (form.canaleAltro?.trim() || "Other") : form.canale);
const ymLabel = (ym) => {
  const [y, m] = ym.split("-");
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[+m - 1]} ${y}`;
};
const shiftYM = (ym, d) => {
  const [y, m] = ym.split("-").map(Number);
  const x = new Date(y, m - 1 + d, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
};

/* ============================================================
   Root: session -> Auth / Onboarding / Workspace
   ============================================================ */
export default function App() {
  const [session, setSession] = useState(undefined);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (demo) return <Workspace demo onExitDemo={() => setDemo(false)} />;
  if (session === undefined) {
    return <div className="rk-root rk-loading"><div className="rk-loader"><span className="rk-chip rk-chip-logo">RACK</span><p>Loading…</p></div></div>;
  }
  if (!session) return <AuthPage onDemo={() => setDemo(true)} />;
  return <Workspace session={session} />;
}

/* ============================================================
   Workspace
   ============================================================ */
function Workspace({ session, demo, onExitDemo }) {
  const userId = demo ? "demo-user" : session.user.id;
  const [ctxState, setCtxState] = useState(null); // {workspace, membership, members} | null
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
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

  const role = ctxState?.membership?.role || "seller";
  const canEdit = role !== "investor";       // managers + sellers can operate
  const canManage = role === "manager";      // settings, roles, payout config
  const wsId = ctxState?.workspace?.id || "demo-ws";
  // a workspace is a "team" if flagged, or if more than one person is in it
  const isTeam = !!(ctxState?.workspace?.is_team) || (ctxState?.members?.length || 0) > 1;

  const ctx = useMemo(() => ({ userId, wsId }), [userId, wsId]);

  const localId = () => "demo-" + Math.random().toString(36).slice(2, 9);
  const api = useMemo(() => demo ? {
    insertRow: async (_t, obj) => ({ ...obj, id: localId() }),
    insertMany: async (_t, objs) => objs.map((o) => ({ ...o, id: localId() })),
    updateRow: async () => {}, deleteRow: async () => {}, deleteWhere: async () => {},
  } : { insertRow, insertMany, updateRow, deleteRow, deleteWhere }, [demo]);

  const loadEverything = useCallback(async (context) => {
    const d = await loadAll(context.workspace.id);
    setData({ ...d, phones: context.workspace.phones || [], ws: context.workspace });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (demo) {
          const fx = demoFixture();
          setCtxState(fx.ctx); setProfile({ email: "demo@rack.app" });
          setData({ ...fx.data, phones: fx.ctx.workspace.phones, ws: fx.ctx.workspace });
          return;
        }
        const context = await loadWorkspaceContext(userId);
        setProfile({ email: session.user.email });
        if (!context) { setNeedsOnboarding(true); return; }
        setCtxState(context);
        await loadEverything(context);
      } catch (e) { console.error(e); setToast("Loading error"); }
    })();
  }, [userId, demo]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const flash = useCallback((m) => setToast(m), []);
  const apply = useCallback((fn, msg) => { setData((prev) => fn(JSON.parse(JSON.stringify(prev)))); if (msg) setToast(msg); }, []);

  const onboarded = async () => {
    const context = await loadWorkspaceContext(userId);
    setNeedsOnboarding(false); setCtxState(context); await loadEverything(context);
  };

  if (!demo && needsOnboarding) return <Onboarding userId={userId} email={session.user.email} onDone={onboarded} onLogout={() => supabase.auth.signOut()} />;
  if (!data || !ctxState) {
    return <div className="rk-root rk-loading"><div className="rk-loader"><span className="rk-chip rk-chip-logo">RACK</span><p>Opening your HQ…</p></div></div>;
  }

  const creditBalance = data.credits.reduce((a, c) => a + (c.tipo === "in" ? c.importo : c.tipo === "pagamento" ? -(c.usatoCredito || 0) : -(c.importo || 0)), 0);
  const nameOf = (uid) => ctxState.members.find((m) => m.user_id === uid)?.display_name || "Seller";

  /* ---------- mutations ---------- */
  const guard = () => { if (!canEdit) { flash("Investors have read-only access"); return false; } return true; };

  const nextSku = (items, prefix) => {
    let max = 0;
    items.forEach((i) => { if (i.sku?.startsWith(prefix)) { const n = parseInt(i.sku.slice(prefix.length), 10); if (!isNaN(n) && n > max) max = n; } });
    return max;
  };

  const addItems = async (form) => {
    if (!guard()) return;
    const qty = Math.max(1, parseInt(form.qty, 10) || 1);
    const prefix = `${codeOf(form.brand)}-${codeOf(form.categoria)}-`;
    let n = nextSku(data.items, prefix);
    const objs = [];
    for (let k = 0; k < qty; k++) {
      n += 1;
      objs.push({
        sku: prefix + String(n).padStart(3, "0"), brand: form.brand.trim(), nome: form.nome.trim(),
        categoria: form.categoria.trim(), taglia: form.taglia.trim(), costo: num(form.costo),
        telefono: form.telefono || "", stato: form.telefono ? "caricato" : "stock", fisico: form.fisico || "casa",
        vinted: !!form.telefono, caricatoAt: form.telefono ? new Date().toISOString() : null,
        data: form.data || todayISO(), note: form.note.trim(),
      });
    }
    try { const created = await api.insertMany("items", objs, ctx);
      apply((d) => { d.items = [...created, ...d.items]; return d; }, qty > 1 ? `${qty} items added` : "Item added");
    } catch (e) { flash("Save error"); }
  };

  const sellOne = async (item, form) => {
    if (!guard()) return;
    try {
      const saleDate = form.data || todayISO();
      const giac = daysBetween(item.caricatoAt || item.data, saleDate);
      const sale = await api.insertRow("sales", {
        itemId: item.id, sku: item.sku, nome: item.nome, brand: item.brand, prezzo: num(form.prezzo),
        costo: item.costo, costiVendita: num(form.costi), canale: chanValue(form), data: saleDate,
        telefono: item.telefono, giacenzaGiorni: giac, sellerId: userId,
      }, ctx);
      await api.updateRow("items", item.id, { stato: "venduto" });
      let exp = null;
      if (num(form.costi) > 0) exp = await api.insertRow("expenses", { tipo: "Selling fees", importo: num(form.costi), data: saleDate, nota: `Selling fees ${item.sku}`, telefono: item.telefono || "", saleId: sale.id }, ctx);
      apply((d) => { d.sales = [sale, ...d.sales]; const it = d.items.find((i) => i.id === item.id); if (it) it.stato = "venduto"; if (exp) d.expenses = [exp, ...d.expenses]; return d; }, `Sale recorded · ${item.sku}`);
    } catch (e) { flash("Save error"); }
    setSaleItem(null);
  };

  const sellBulk = async (items, form) => {
    if (!guard()) return;
    try {
      for (const item of items) {
        const saleDate = form.data || todayISO();
        const giac = daysBetween(item.caricatoAt || item.data, saleDate);
        const sale = await api.insertRow("sales", { itemId: item.id, sku: item.sku, nome: item.nome, brand: item.brand, prezzo: num(form.prezzo), costo: item.costo, costiVendita: num(form.costi), canale: chanValue(form), data: saleDate, telefono: item.telefono || "—", giacenzaGiorni: giac, sellerId: userId }, ctx);
        await api.updateRow("items", item.id, { stato: "venduto" });
        let exp = null;
        if (num(form.costi) > 0) exp = await api.insertRow("expenses", { tipo: "Selling fees", importo: num(form.costi), data: saleDate, nota: `Selling fees ${item.sku}`, telefono: item.telefono || "", saleId: sale.id }, ctx);
        apply((d) => { d.sales = [sale, ...d.sales]; const it = d.items.find((i) => i.id === item.id); if (it) it.stato = "venduto"; if (exp) d.expenses = [exp, ...d.expenses]; return d; });
      }
      flash(`${items.length} sales recorded`);
    } catch (e) { flash("Save error"); }
    setBulkSale(null);
  };

  const giftItem = async (item) => {
    if (!guard()) return;
    if (!window.confirm(`Mark ${item.sku} as a gift? Its cost (${eur(item.costo)}) goes to expenses.`)) return;
    try {
      await api.updateRow("items", item.id, { stato: "regalato" });
      const exp = await api.insertRow("expenses", { tipo: "Gift", importo: item.costo, data: todayISO(), nota: `Gift ${item.sku} — ${item.nome}`, telefono: item.telefono || "" }, ctx);
      apply((d) => { const it = d.items.find((i) => i.id === item.id); if (it) it.stato = "regalato"; d.expenses = [exp, ...d.expenses]; return d; }, `${item.sku} marked as gift`);
    } catch (e) { flash("Error"); }
  };

  const removeItem = async (item) => {
    if (!guard()) return;
    if (!window.confirm(`Delete ${item.sku}?`)) return;
    try { await api.deleteRow("items", item.id); apply((d) => { d.items = d.items.filter((i) => i.id !== item.id); return d; }, "Item deleted"); } catch (e) { flash("Error"); }
  };

  const removeSale = async (sale) => {
    if (!guard()) return;
    if (!window.confirm(`Undo the sale of ${sale.sku}? The item returns to stock.`)) return;
    try {
      await api.deleteRow("sales", sale.id); await api.deleteWhere("expenses", "sale_id", sale.id);
      const it = data.items.find((i) => i.id === sale.itemId);
      if (it) await api.updateRow("items", it.id, { stato: it.telefono ? "caricato" : "stock" });
      apply((d) => { d.sales = d.sales.filter((s) => s.id !== sale.id); d.expenses = d.expenses.filter((e) => e.saleId !== sale.id); const x = d.items.find((i) => i.id === sale.itemId); if (x) x.stato = x.telefono ? "caricato" : "stock"; return d; }, "Sale undone");
    } catch (e) { flash("Error"); }
  };

  const saveEdit = async (id, patch) => { if (!guard()) return; try { await api.updateRow("items", id, patch); apply((d) => { const it = d.items.find((i) => i.id === id); if (it) Object.assign(it, patch); return d; }, "Item updated"); } catch (e) { flash("Error"); } setEditItem(null); };
  const toggleVinted = async (item) => { if (!guard()) return; const v = !item.vinted; try { await api.updateRow("items", item.id, { vinted: v }); apply((d) => { const it = d.items.find((i) => i.id === item.id); if (it) it.vinted = v; return d; }); } catch (e) { flash("Error"); } };
  const bulkNote = async (ids, note) => { if (!guard()) return; try { for (const id of ids) await api.updateRow("items", id, { note }); apply((d) => { d.items.forEach((i) => { if (ids.includes(i.id)) i.note = note; }); return d; }, `Note set on ${ids.length} items`); } catch (e) { flash("Error"); } setBulkNoteIds(null); };
  const bulkFisico = async (ids, fisico) => { if (!guard()) return; try { for (const id of ids) await api.updateRow("items", id, { fisico }); apply((d) => { d.items.forEach((i) => { if (ids.includes(i.id)) i.fisico = fisico; }); return d; }, `${ids.length} items: ${FISICO_LABEL[fisico]}`); } catch (e) { flash("Error"); } setBulkFisicoIds(null); };

  const assignPhone = async (ids, phone) => {
    if (!guard()) return;
    const none = phone === "__none__"; const nowISO = new Date().toISOString();
    try {
      for (const id of ids) {
        const it = data.items.find((x) => x.id === id);
        if (none) await api.updateRow("items", id, { telefono: "", stato: "stock", vinted: false, caricatoAt: null });
        else { const patch = { telefono: phone, stato: "caricato" }; if (!it?.caricatoAt) patch.caricatoAt = nowISO; await api.updateRow("items", id, patch); }
      }
      apply((d) => { d.items.forEach((i) => { if (ids.includes(i.id)) { if (none) { i.telefono = ""; i.stato = "stock"; i.vinted = false; i.caricatoAt = null; } else { i.telefono = phone; i.stato = "caricato"; if (!i.caricatoAt) i.caricatoAt = nowISO; } } }); return d; }, none ? "Returned to stock" : `Listed on ${phone}`);
    } catch (e) { flash("Error"); }
    setAssignIds(null);
  };

  const addOrder = async (form, itemIds) => {
    if (!guard()) return;
    try {
      const o = await api.insertRow("orders", { tracking: form.tracking.trim(), corriere: form.corriere.trim(), nota: form.nota.trim(), data: form.data || todayISO(), stato: "in_viaggio", itemIds }, ctx);
      for (const id of itemIds) await api.updateRow("items", id, { fisico: "viaggio" });
      apply((d) => { d.orders = [o, ...d.orders]; d.items.forEach((i) => { if (itemIds.includes(i.id)) i.fisico = "viaggio"; }); return d; }, "Order created");
    } catch (e) { flash("Error"); }
  };
  const orderDelivered = async (order) => {
    if (!guard()) return;
    try { await api.updateRow("orders", order.id, { stato: "consegnato" }); for (const id of order.itemIds) await api.updateRow("items", id, { fisico: "casa" });
      apply((d) => { const o = d.orders.find((x) => x.id === order.id); if (o) o.stato = "consegnato"; d.items.forEach((i) => { if (order.itemIds.includes(i.id)) i.fisico = "casa"; }); return d; }, "Delivered · items at home");
    } catch (e) { flash("Error"); }
  };
  const removeOrder = async (order) => { if (!guard()) return; if (!window.confirm("Delete this order? Items are not affected.")) return; try { await api.deleteRow("orders", order.id); apply((d) => { d.orders = d.orders.filter((o) => o.id !== order.id); return d; }, "Order deleted"); } catch (e) { flash("Error"); } };

  const addExpense = async (form) => { if (!guard()) return; try { const e = await api.insertRow("expenses", { tipo: form.tipo, importo: num(form.importo), data: form.data || todayISO(), nota: form.nota.trim(), telefono: form.telefono || "" }, ctx); apply((d) => { d.expenses = [e, ...d.expenses]; return d; }, "Expense recorded"); } catch (er) { flash("Error"); } };
  const removeExpense = async (e) => { if (!guard()) return; try { await api.deleteRow("expenses", e.id); apply((d) => { d.expenses = d.expenses.filter((x) => x.id !== e.id); return d; }, "Expense deleted"); } catch (er) { flash("Error"); } };
  const saveExpenseEdit = async (id, patch) => { if (!guard()) return; try { await api.updateRow("expenses", id, patch); apply((d) => { const ex = d.expenses.find((x) => x.id === id); if (ex) Object.assign(ex, patch); return d; }, "Expense updated"); } catch (er) { flash("Error"); } setEditExp(null); };

  const setReso = async (sale, fase) => {
    if (!guard()) return;
    try {
      await api.updateRow("sales", sale.id, { reso: fase });
      const it = data.items.find((i) => i.id === sale.itemId);
      if (it) { const ns = fase === "consegnato" ? (it.telefono ? "caricato" : "stock") : "venduto"; if (it.stato !== ns) await api.updateRow("items", it.id, { stato: ns }); }
      apply((d) => { const s = d.sales.find((x) => x.id === sale.id); if (s) s.reso = fase; const x = d.items.find((i) => i.id === sale.itemId); if (x) x.stato = fase === "consegnato" ? (x.telefono ? "caricato" : "stock") : "venduto"; return d; }, fase === "no" ? "Return cleared" : fase === "consegnato" ? "Return received · back in stock" : "Return updated");
    } catch (e) { flash("Error"); }
  };

  const addTodo = async (testo) => { if (!guard()) return; try { const t = await api.insertRow("todos", { testo, fatto: false }, ctx); apply((d) => { d.todos = [t, ...d.todos]; return d; }); } catch (e) { flash("Error"); } };
  const toggleTodo = async (todo) => { if (!guard()) return; try { await api.updateRow("todos", todo.id, { fatto: !todo.fatto }); apply((d) => { const t = d.todos.find((x) => x.id === todo.id); if (t) t.fatto = !t.fatto; return d; }); } catch (e) { flash("Error"); } };
  const removeTodo = async (todo) => { if (!guard()) return; try { await api.deleteRow("todos", todo.id); apply((d) => { d.todos = d.todos.filter((x) => x.id !== todo.id); return d; }); } catch (e) { flash("Error"); } };

  const saveSettings = async (patch) => {
    if (!canManage) { flash("Only the manager can change settings"); setShowSettings(false); return; }
    try {
      if (demo) { apply((d) => { d.phones = patch.phones; d.ws = { ...d.ws, ...patch }; return d; }, "Settings saved"); setShowSettings(false); return; }
      await updateWorkspace(wsId, { name: patch.name, pct: patch.pct, seller_base: patch.sellerBase, seller_bonus: patch.sellerBonus, bonus_threshold: patch.bonusThreshold, phones: patch.phones });
      setCtxState((c) => ({ ...c, workspace: { ...c.workspace, ...patch, seller_base: patch.sellerBase, seller_bonus: patch.sellerBonus, bonus_threshold: patch.bonusThreshold } }));
      apply((d) => { d.phones = patch.phones; d.ws = { ...d.ws, ...patch, seller_base: patch.sellerBase, seller_bonus: patch.sellerBonus, bonus_threshold: patch.bonusThreshold }; return d; }, "Settings saved");
    } catch (e) { flash("Error"); }
    setShowSettings(false);
  };

  const changeRole = async (membershipId, newRole) => {
    if (!canManage || demo) return;
    try { await setMemberRole(membershipId, newRole); setCtxState((c) => ({ ...c, members: c.members.map((m) => m.id === membershipId ? { ...m, role: newRole } : m) })); flash("Role updated"); } catch (e) { flash(e.message || "Error"); }
  };

  const logout = async () => { if (demo) { onExitDemo && onExitDemo(); return; } await supabase.auth.signOut(); };

  const exportCSV = () => {
    const rows = [["Date", "Type", "Ref", "Description", "Channel/Phone", "In", "Out"]];
    data.sales.forEach((s) => { const r = s.reso && s.reso !== "no"; rows.push([s.data, r ? "Sale (returned)" : "Sale", s.sku, `${s.brand} ${s.nome}`.trim(), s.canale, r ? 0 : s.prezzo, 0]); if (!r) rows.push([s.data, "COGS", s.sku, `Cost ${s.brand} ${s.nome}`.trim(), s.telefono, 0, s.costo]); });
    data.expenses.forEach((e) => rows.push([e.data, `Expense — ${e.tipo}`, "", e.nota, e.telefono, 0, e.importo]));
    data.credits.forEach((c) => rows.push([c.data, c.tipo === "in" ? "Credit earned" : "Supplier payment", "", c.nota, "", c.tipo === "in" ? c.importo : 0, c.tipo === "pagamento" ? c.contanti : 0]));
    rows.sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `rack-ledger-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href); flash("CSV exported");
  };

  const openTodos = data.todos.filter((t) => !t.fatto).length;
  const tabs = [
    ["dash", "Dashboard", <TrendingUp size={14} key="i" />],
    ["stock", "Stock", <Package size={14} key="i" />],
    ["ord", "Orders", <Truck size={14} key="i" />],
    ["sales", "Sales", <Tag size={14} key="i" />],
    ["exp", "Expenses", <Receipt size={14} key="i" />],
    ["todo", "To-do", <ListTodo size={14} key="i" />],
    ...(isTeam ? [["pay", "Payouts", <Coins size={14} key="i" />]] : []),
    ["cred", "Supplier", <Wallet size={14} key="i" />],
  ];
  const inTransit = data.orders.filter((o) => o.stato === "in_viaggio").length;

  return (
    <div className="rk-root">
      {demo && <div className="rk-demobar"><span><Flame size={13} /> DEMO mode — sample data, nothing is saved</span><button className="rk-btn rk-small" onClick={() => onExitDemo && onExitDemo()}>Exit demo</button></div>}
      <header className="rk-header">
        <div className="rk-brandmark">
          <span className="rk-chip rk-chip-logo">RACK</span>
          <span className="rk-sub rk-hide-sm">{ctxState.workspace.name}{isTeam ? ` · ${ROLE_LABEL[role]}` : ""}</span>
        </div>
        <div className="rk-header-actions">
          <button className="rk-btn rk-ghost" onClick={exportCSV} title="Export CSV"><Download size={15} /><span className="rk-hide-sm">CSV</span></button>
          <button className="rk-btn rk-ghost" onClick={() => setShowSettings(true)} title="Settings"><Settings size={15} /><span className="rk-hide-sm">Team</span></button>
          <button className="rk-btn rk-ghost" onClick={logout} title={demo ? "Exit demo" : "Log out"}><LogOut size={15} /></button>
        </div>
      </header>

      <nav className="rk-tabs">
        {tabs.map(([id, label, icon]) => (
          <button key={id} className={`rk-tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
            {icon} {label}
            {id === "cred" && creditBalance > 0 && <span className="rk-tab-pill">{eur(creditBalance)}</span>}
            {id === "ord" && inTransit > 0 && <span className="rk-tab-pill">{inTransit} in transit</span>}
            {id === "todo" && openTodos > 0 && <span className="rk-tab-pill">{openTodos}</span>}
          </button>
        ))}
      </nav>

      <main className="rk-main">
        {tab === "dash" && <Dashboard data={data} creditBalance={creditBalance} />}
        {tab === "stock" && <StockTab data={data} canEdit={canEdit} onAdd={addItems} onSell={setSaleItem} onGift={giftItem} onDelete={removeItem} onAssign={setAssignIds} onBulkSell={setBulkSale} onEdit={setEditItem} onBulkNote={setBulkNoteIds} onBulkFisico={setBulkFisicoIds} onToggleVinted={toggleVinted} />}
        {tab === "ord" && <OrdersTab data={data} canEdit={canEdit} onAdd={addOrder} onDelivered={orderDelivered} onDelete={removeOrder} />}
        {tab === "sales" && <SalesTab data={data} canEdit={canEdit} nameOf={nameOf} onDelete={removeSale} onSetReso={setReso} />}
        {tab === "exp" && <ExpensesTab data={data} canEdit={canEdit} onAdd={addExpense} onDelete={removeExpense} onEdit={setEditExp} />}
        {tab === "todo" && <TodoTab data={data} canEdit={canEdit} onAdd={addTodo} onToggle={toggleTodo} onDelete={removeTodo} />}
        {tab === "pay" && <PayoutsTab data={data} members={ctxState.members} ws={ctxState.workspace} />}
        {tab === "cred" && <CreditsTab data={data} balance={creditBalance} canEdit={canEdit}
          onIn={async (form) => { if (!guard()) return; const ordine = num(form.ordine); const c = await api.insertRow("credits", { tipo: "in", ordine, importo: +(ordine * (data.ws.pct / 100)).toFixed(2), data: form.data || todayISO(), nota: form.nota.trim() }, ctx); apply((d) => { d.credits = [c, ...d.credits]; return d; }, "Credit recorded"); }}
          onPay={async (form) => { if (!guard()) return; const importo = num(form.importo); const usato = +Math.min(Math.max(creditBalance, 0), importo).toFixed(2); const c = await api.insertRow("credits", { tipo: "pagamento", ordine: 0, importo, usatoCredito: usato, contanti: +(importo - usato).toFixed(2), data: form.data || todayISO(), nota: form.nota.trim() }, ctx); apply((d) => { d.credits = [c, ...d.credits]; return d; }, "Payment recorded"); }}
          onDelete={async (c) => { if (!guard()) return; await api.deleteRow("credits", c.id); apply((d) => { d.credits = d.credits.filter((x) => x.id !== c.id); return d; }, "Removed"); }} />}
      </main>

      {saleItem && <SaleModal item={saleItem} onClose={() => setSaleItem(null)} onConfirm={sellOne} />}
      {bulkSale && <BulkSaleModal items={bulkSale} onClose={() => setBulkSale(null)} onConfirm={sellBulk} />}
      {assignIds && <AssignPhoneModal phones={data.phones} count={assignIds.length} onClose={() => setAssignIds(null)} onConfirm={(p) => assignPhone(assignIds, p)} />}
      {editItem && <EditItemModal item={editItem} onClose={() => setEditItem(null)} onSave={saveEdit} />}
      {bulkNoteIds && <BulkNoteModal count={bulkNoteIds.length} onClose={() => setBulkNoteIds(null)} onConfirm={(n) => bulkNote(bulkNoteIds, n)} />}
      {bulkFisicoIds && <BulkFisicoModal count={bulkFisicoIds.length} onClose={() => setBulkFisicoIds(null)} onConfirm={(f) => bulkFisico(bulkFisicoIds, f)} />}
      {editExp && <EditExpenseModal exp={editExp} phones={data.phones} onClose={() => setEditExp(null)} onSave={saveExpenseEdit} />}
      {showSettings && <SettingsModal ws={ctxState.workspace} members={ctxState.members} role={role} canManage={canManage} isTeam={isTeam} onClose={() => setShowSettings(false)} onSave={saveSettings} onChangeRole={changeRole} flash={flash} />}
      {toast && <div className="rk-toast">{toast}</div>}
    </div>
  );
}

/* ============================================================
   Onboarding: create or join a team
   ============================================================ */
function Onboarding({ userId, email, onDone, onLogout }) {
  const [mode, setMode] = useState("choose");
  const [name, setName] = useState("");
  const [display, setDisplay] = useState((email || "").split("@")[0] || "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const startSolo = async () => { setErr(null); setBusy(true); try { await createWorkspace(userId, "My space", display.trim(), false); await onDone(); } catch (e) { setErr(e.message || "Error"); setBusy(false); } };
  const create = async () => { setErr(null); setBusy(true); try { await createWorkspace(userId, name.trim() || "My team", display.trim(), true); await onDone(); } catch (e) { setErr(e.message || "Error"); setBusy(false); } };
  const join = async () => { setErr(null); setBusy(true); try { await joinWorkspace(userId, code, display.trim()); await onDone(); } catch (e) { setErr(e.message || "Invalid code"); setBusy(false); } };

  return (
    <div className="rk-auth">
      <div className="rk-auth-card">
        <div className="rk-auth-brand"><span className="rk-chip rk-chip-logo">RACK</span><span className="rk-sub">your reselling HQ</span></div>
        {mode === "choose" && (<>
          <h1 className="rk-auth-title">Welcome</h1>
          <p className="rk-mutlabel rk-mb6">How do you want to use RACK?</p>
          <button className="rk-btn rk-primary rk-auth-submit" onClick={() => setMode("solo")}><Package size={16} /> Start solo</button>
          <p className="rk-onbnote">Just you, tracking your own reselling.</p>
          <button className="rk-btn rk-ghost rk-auth-submit" onClick={() => setMode("create")}><Users size={16} /> Create a team</button>
          <p className="rk-onbnote">You manage sellers and an investor, with payouts.</p>
          <button className="rk-btn rk-ghost rk-auth-submit" onClick={() => setMode("join")}><UserPlus size={16} /> Join a team</button>
          <p className="rk-onbnote">You have a team code from someone else.</p>
          <button className="rk-auth-switch" onClick={onLogout}>Log out</button>
        </>)}
        {mode === "solo" && (<>
          <h1 className="rk-auth-title">Start solo</h1>
          <p className="rk-mutlabel rk-mb6">Your personal reselling space. You can invite people later.</p>
          <label className="rk-field"><span className="rk-field-label">Your name</span><input className="rk-input" value={display} onChange={(e) => setDisplay(e.target.value)} /></label>
          {err && <p className="rk-auth-err">{err}</p>}
          <button className="rk-btn rk-primary rk-auth-submit" disabled={busy} onClick={startSolo}>{busy ? <Loader2 size={16} className="rk-spin" /> : null} Let's go</button>
          <button className="rk-auth-switch" onClick={() => setMode("choose")}>Back</button>
        </>)}
        {mode === "create" && (<>
          <h1 className="rk-auth-title">Create a team</h1>
          <label className="rk-field"><span className="rk-field-label">Team name</span><input className="rk-input" placeholder="My reselling team" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="rk-field rk-mt12"><span className="rk-field-label">Your name</span><input className="rk-input" value={display} onChange={(e) => setDisplay(e.target.value)} /></label>
          {err && <p className="rk-auth-err">{err}</p>}
          <button className="rk-btn rk-primary rk-auth-submit" disabled={busy} onClick={create}>{busy ? <Loader2 size={16} className="rk-spin" /> : null} Create team</button>
          <button className="rk-auth-switch" onClick={() => setMode("choose")}>Back</button>
        </>)}
        {mode === "join" && (<>
          <h1 className="rk-auth-title">Join a team</h1>
          <label className="rk-field"><span className="rk-field-label">Team code</span><input className="rk-input rk-mono" placeholder="ABC123" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>
          <label className="rk-field rk-mt12"><span className="rk-field-label">Your name</span><input className="rk-input" value={display} onChange={(e) => setDisplay(e.target.value)} /></label>
          {err && <p className="rk-auth-err">{err}</p>}
          <button className="rk-btn rk-primary rk-auth-submit" disabled={busy || !code.trim()} onClick={join}>{busy ? <Loader2 size={16} className="rk-spin" /> : null} Join team</button>
          <button className="rk-auth-switch" onClick={() => setMode("choose")}>Back</button>
        </>)}
      </div>
    </div>
  );
}

/* ============================================================
   Dashboard
   ============================================================ */
function Dashboard({ data, creditBalance }) {
  const [ym, setYm] = useState(thisYM());
  const m = useMemo(() => {
    const sales = data.sales.filter((s) => (s.data || "").slice(0, 7) === ym);
    const valid = sales.filter((s) => !s.reso || s.reso === "no");
    const expenses = data.expenses.filter((e) => (e.data || "").slice(0, 7) === ym);
    const creditsIn = data.credits.filter((c) => c.tipo === "in" && (c.data || "").slice(0, 7) === ym);
    const ricavi = valid.reduce((a, s) => a + s.prezzo, 0);
    const cogs = valid.reduce((a, s) => a + s.costo, 0);
    const spese = expenses.reduce((a, e) => a + e.importo, 0);
    const maturati = creditsIn.reduce((a, c) => a + c.importo, 0);
    return { nVendite: valid.length, nResi: sales.length - valid.length, ricavi, cogs, spese, maturati, profitto: ricavi - cogs - spese + maturati };
  }, [data, ym]);

  const today = useMemo(() => {
    const t = todayISO();
    const sales = data.sales.filter((s) => s.data === t && (!s.reso || s.reso === "no"));
    return { n: sales.length, profitto: sales.reduce((a, s) => a + (s.prezzo - s.costo - (s.costiVendita || 0)), 0) };
  }, [data]);

  const brandStats = useMemo(() => {
    const map = {};
    data.sales.filter((s) => (s.data || "").slice(0, 7) === ym && (!s.reso || s.reso === "no")).forEach((s) => { const k = s.brand || "—"; map[k] = map[k] || { n: 0, profitto: 0 }; map[k].n += 1; map[k].profitto += s.prezzo - s.costo - (s.costiVendita || 0); });
    return Object.entries(map).map(([brand, v]) => ({ brand, ...v })).sort((a, b) => b.profitto - a.profitto).slice(0, 5);
  }, [data, ym]);
  const maxBrand = Math.max(1, ...brandStats.map((b) => Math.abs(b.profitto)));

  const stock = useMemo(() => {
    const attivi = data.items.filter((i) => ACTIVE.includes(i.stato));
    const caricati = attivi.filter((i) => i.stato === "caricato");
    const perPhone = {}; data.phones.forEach((p) => (perPhone[p] = 0));
    caricati.forEach((i) => { perPhone[i.telefono] = (perPhone[i.telefono] || 0) + 1; });
    const lenti = caricati.filter((i) => (daysBetween(i.caricatoAt) ?? 0) >= SLOW_DAYS);
    return { n: attivi.length, nonCaricati: attivi.length - caricati.length, inViaggio: attivi.filter((i) => i.fisico === "viaggio").length, ordinati: attivi.filter((i) => i.fisico === "ordinato").length, valore: attivi.reduce((a, i) => a + i.costo, 0), perPhone, lenti: lenti.length, capitaleLento: lenti.reduce((a, i) => a + i.costo, 0) };
  }, [data]);
  const maxPhone = Math.max(1, ...Object.values(stock.perPhone));

  return (
    <div className="rk-stack">
      <div className="rk-todaybar">
        <div className="rk-today-left"><Flame size={16} /> <span>Today</span></div>
        <div className="rk-today-stats"><span><strong className="rk-mono">{today.n}</strong> {today.n === 1 ? "sale" : "sales"}</span><span className={`rk-mono ${today.profitto >= 0 ? "rk-tonetext-green" : "rk-tonetext-red"}`}>{today.profitto >= 0 ? "+" : ""}{eur(today.profitto)}</span></div>
      </div>
      <div className="rk-monthnav">
        <button className="rk-btn rk-ghost rk-sq" onClick={() => setYm(shiftYM(ym, -1))}><ChevronLeft size={16} /></button>
        <h2>{ymLabel(ym)}</h2>
        <button className="rk-btn rk-ghost rk-sq" onClick={() => setYm(shiftYM(ym, 1))} disabled={ym >= thisYM()}><ChevronRight size={16} /></button>
      </div>
      <div className="rk-kpis">
        <Kpi label="Revenue" value={eur(m.ricavi)} sub={`${m.nVendite} sold${m.nResi ? ` · ${m.nResi} returned` : ""}`} />
        <Kpi label="Cost of goods" value={"−" + eur(m.cogs)} tone="mut" />
        <Kpi label="Operating costs" value={"−" + eur(m.spese)} sub="boost · packaging · gifts · fees" tone="mut" />
        <Kpi label="Supplier credit" value={"+" + eur(m.maturati)} tone="amber" />
        <Kpi label="Net profit" value={eur(m.profitto)} tone={m.profitto >= 0 ? "green" : "red"} big />
      </div>
      <div className="rk-grid2">
        <div className="rk-card">
          <h3 className="rk-h3"><Package size={15} /> Current stock</h3>
          <div className="rk-stockline"><div><div className="rk-bignum">{stock.n}</div><div className="rk-mutlabel">items in stock</div></div><div><div className="rk-bignum">{eur(stock.valore)}</div><div className="rk-mutlabel">capital tied up</div></div></div>
          {(stock.inViaggio > 0 || stock.ordinati > 0) && <p className="rk-mutlabel rk-mt12"><Truck size={12} /> {stock.ordinati > 0 && `${stock.ordinati} to ship`}{stock.ordinati > 0 && stock.inViaggio > 0 && " · "}{stock.inViaggio > 0 && `${stock.inViaggio} in transit`}</p>}
          {stock.nonCaricati > 0 && <p className="rk-mutlabel rk-mt6">{stock.nonCaricati} not listed on any account yet</p>}
          {stock.lenti > 0 && <p className="rk-slowline rk-mt12"><Clock size={13} /> {stock.lenti} items sitting over {SLOW_DAYS}d · {eur(stock.capitaleLento)} locked</p>}
        </div>
        <div className="rk-card">
          <h3 className="rk-h3"><Smartphone size={15} /> Items per phone</h3>
          <div className="rk-bars">{Object.entries(stock.perPhone).map(([p, n]) => (<div key={p} className="rk-barrow"><span className="rk-barlabel">{p}</span><div className="rk-bartrack"><div className="rk-barfill" style={{ width: `${(n / maxPhone) * 100}%` }} /></div><span className="rk-barnum">{n}</span></div>))}</div>
        </div>
      </div>
      {brandStats.length > 0 && (
        <div className="rk-card">
          <h3 className="rk-h3"><BarChart3 size={15} /> Profit by brand · {ymLabel(ym)}</h3>
          <div className="rk-bars">{brandStats.map((b) => (<div key={b.brand} className="rk-barrow"><span className="rk-barlabel">{b.brand} <span className="rk-mutlabel">·{b.n}</span></span><div className="rk-bartrack"><div className={`rk-barfill ${b.profitto < 0 ? "rk-barfill-neg" : ""}`} style={{ width: `${(Math.abs(b.profitto) / maxBrand) * 100}%` }} /></div><span className={`rk-barnum rk-mono ${b.profitto >= 0 ? "rk-tonetext-green" : "rk-tonetext-red"}`}>{eur(b.profitto)}</span></div>))}</div>
        </div>
      )}
      <div className="rk-card rk-walletline"><Wallet size={16} /><span>Supplier credit balance</span><strong className="rk-mono">{eur(creditBalance)}</strong></div>
    </div>
  );
}
function Kpi({ label, value, sub, tone, big }) {
  return (<div className={`rk-kpi ${big ? "rk-kpi-big" : ""} ${tone ? "rk-tone-" + tone : ""}`}><div className="rk-kpi-label">{label}</div><div className="rk-kpi-value rk-mono">{value}</div>{sub && <div className="rk-kpi-sub">{sub}</div>}</div>);
}

/* ============================================================
   Payouts
   ============================================================ */
function PayoutsTab({ data, members, ws }) {
  const [ym, setYm] = useState(thisYM());
  const base = Number(ws.seller_base ?? 8), bonus = Number(ws.seller_bonus ?? 10), threshold = Number(ws.bonus_threshold ?? 5);

  const calc = useMemo(() => {
    const valid = data.sales.filter((s) => (s.data || "").slice(0, 7) === ym && (!s.reso || s.reso === "no"));
    // group by seller -> by day
    const bySeller = {};
    valid.forEach((s) => {
      const sid = s.sellerId || "unknown";
      bySeller[sid] = bySeller[sid] || { byDay: {}, count: 0 };
      bySeller[sid].byDay[s.data] = (bySeller[sid].byDay[s.data] || 0) + 1;
      bySeller[sid].count += 1;
    });
    const sellers = Object.entries(bySeller).map(([sid, v]) => {
      let bonusDays = 0, amount = 0;
      Object.values(v.byDay).forEach((cnt) => { const isBonus = cnt >= threshold; if (isBonus) bonusDays += 1; amount += cnt * (isBonus ? bonus : base); });
      const name = members.find((m) => m.user_id === sid)?.display_name || "Seller";
      return { sid, name, count: v.count, bonusDays, amount };
    }).sort((a, b) => b.amount - a.amount);

    const sellerCost = sellers.reduce((a, s) => a + s.amount, 0);
    const expenses = data.expenses.filter((e) => (e.data || "").slice(0, 7) === ym);
    const creditsIn = data.credits.filter((c) => c.tipo === "in" && (c.data || "").slice(0, 7) === ym);
    const ricavi = valid.reduce((a, s) => a + s.prezzo, 0);
    const cogs = valid.reduce((a, s) => a + s.costo, 0);
    const spese = expenses.reduce((a, e) => a + e.importo, 0);
    const maturati = creditsIn.reduce((a, c) => a + c.importo, 0);
    const grossProfit = ricavi - cogs - spese + maturati;
    const netForSplit = grossProfit - sellerCost;
    return { sellers, sellerCost, grossProfit, netForSplit, half: netForSplit / 2 };
  }, [data, ym, base, bonus, threshold, members]);

  return (
    <div className="rk-stack">
      <div className="rk-monthnav">
        <button className="rk-btn rk-ghost rk-sq" onClick={() => setYm(shiftYM(ym, -1))}><ChevronLeft size={16} /></button>
        <h2>{ymLabel(ym)} · payouts</h2>
        <button className="rk-btn rk-ghost rk-sq" onClick={() => setYm(shiftYM(ym, 1))} disabled={ym >= thisYM()}><ChevronRight size={16} /></button>
      </div>

      <div className="rk-card">
        <h3 className="rk-h3"><Users size={15} /> Sellers — {eur(base)}/sale · {eur(bonus)}/sale on {threshold}+ days</h3>
        {calc.sellers.length === 0 ? <p className="rk-empty">No sales this month.</p> : (
          <div className="rk-rows">
            {calc.sellers.map((s) => (
              <div key={s.sid} className="rk-row">
                <span className="rk-badge rk-badge-travel"><Users size={11} /> {s.name}</span>
                <div className="rk-row-main"><strong>{s.count} sales</strong><span className="rk-row-meta">{s.bonusDays > 0 ? `${s.bonusDays} bonus day${s.bonusDays > 1 ? "s" : ""} @ ${eur(bonus)}` : `all @ ${eur(base)}`}</span></div>
                <span className="rk-mono rk-margin rk-tonetext-green">{eur(s.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rk-card">
        <h3 className="rk-h3"><Coins size={15} /> Split</h3>
        <div className="rk-splitrow"><span>Gross profit</span><strong className="rk-mono">{eur(calc.grossProfit)}</strong></div>
        <div className="rk-splitrow"><span>− Sellers' pay</span><strong className="rk-mono rk-neg">−{eur(calc.sellerCost)}</strong></div>
        <div className="rk-splitrow rk-splitrow-total"><span>Net to split</span><strong className="rk-mono">{eur(calc.netForSplit)}</strong></div>
        <div className="rk-grid2 rk-mt12">
          <div className="rk-kpi rk-tone-green"><div className="rk-kpi-label"><Crown size={12} /> Manager (you) · 50%</div><div className="rk-kpi-value rk-mono">{eur(calc.half)}</div></div>
          <div className="rk-kpi rk-tone-green"><div className="rk-kpi-label"><Coins size={12} /> Investor · 50%</div><div className="rk-kpi-value rk-mono">{eur(calc.half)}</div></div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Stock
   ============================================================ */
const EMPTY_ITEM = { brand: "", nome: "", categoria: "", taglia: "", costo: "", telefono: "", qty: "1", data: "", note: "", fisico: "casa" };
function StockTab({ data, canEdit, onAdd, onSell, onGift, onDelete, onAssign, onBulkSell, onEdit, onBulkNote, onBulkFisico, onToggleVinted }) {
  const [form, setForm] = useState({ ...EMPTY_ITEM, data: todayISO() });
  const [open, setOpen] = useState(data.items.length === 0 && canEdit);
  const [q, setQ] = useState(""); const [fStato, setFStato] = useState("attivi"); const [fPhone, setFPhone] = useState(""); const [sel, setSel] = useState([]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const skuPreview = `${codeOf(form.brand)}-${codeOf(form.categoria)}-###`;
  const canAdd = form.brand.trim() && form.nome.trim() && form.categoria.trim();
  const list = data.items.filter((i) => {
    if (fStato === "attivi") { if (!ACTIVE.includes(i.stato)) return false; } else if (fStato !== "tutti" && i.stato !== fStato) return false;
    if (fPhone && i.telefono !== fPhone) return false;
    if (q) { const t = `${i.sku} ${i.brand} ${i.nome} ${i.categoria} ${i.taglia}`.toLowerCase(); if (!t.includes(q.toLowerCase())) return false; }
    return true;
  });
  const toggleSel = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selItems = data.items.filter((i) => sel.includes(i.id) && ACTIVE.includes(i.stato));
  const activeInList = list.filter((i) => ACTIVE.includes(i.stato));

  return (
    <div className="rk-stack">
      {canEdit && (
        <div className="rk-card">
          <button className="rk-cardtoggle" onClick={() => setOpen(!open)}><Plus size={15} /> Add item <span className="rk-mono rk-skupreview">{skuPreview}</span></button>
          {open && (<div className="rk-form">
            <div className="rk-formgrid">
              <L label="Brand"><input className="rk-input" placeholder="Burberry" value={form.brand} onChange={set("brand")} /></L>
              <L label="Item"><input className="rk-input" placeholder="Check swim shorts" value={form.nome} onChange={set("nome")} /></L>
              <L label="Category"><input className="rk-input" placeholder="Swimwear / Kit…" value={form.categoria} onChange={set("categoria")} /></L>
              <L label="Size"><input className="rk-input" placeholder="M" value={form.taglia} onChange={set("taglia")} /></L>
              <L label="Cost €"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0.00" value={form.costo} onChange={set("costo")} /></L>
              <L label="Phone (optional)"><select className="rk-input" value={form.telefono} onChange={set("telefono")}><option value="">— assign later —</option>{data.phones.map((p) => <option key={p} value={p}>{p}</option>)}</select></L>
              <L label="Quantity"><input className="rk-input rk-mono" inputMode="numeric" value={form.qty} onChange={set("qty")} /></L>
              <L label="Location"><select className="rk-input" value={form.fisico} onChange={set("fisico")}>{FISICO_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></L>
              <L label="Date"><input className="rk-input" type="date" value={form.data} onChange={set("data")} /></L>
              <L label="Notes" wide><input className="rk-input" placeholder="Supplier, batch…" value={form.note} onChange={set("note")} /></L>
            </div>
            <div className="rk-formfoot">
              <span className="rk-mutlabel">Auto SKUs: {skuPreview.replace("###", "001")}, 002… No phone = stays "in stock".</span>
              <button className="rk-btn rk-primary" disabled={!canAdd} onClick={() => { onAdd(form); setForm({ ...EMPTY_ITEM, data: todayISO(), telefono: form.telefono, brand: form.brand, categoria: form.categoria, fisico: form.fisico }); }}><Plus size={15} /> Add {parseInt(form.qty, 10) > 1 ? `${form.qty} items` : ""}</button>
            </div>
          </div>)}
        </div>
      )}

      <div className="rk-filters">
        <div className="rk-search"><Search size={14} /><input className="rk-input rk-input-bare" placeholder="Search SKU, brand…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="rk-input rk-input-auto" value={fStato} onChange={(e) => setFStato(e.target.value)}>
          <option value="attivi">Active (stock + listed)</option><option value="stock">In stock only</option><option value="caricato">Listed</option><option value="venduto">Sold</option><option value="regalato">Gifted</option><option value="tutti">All</option>
        </select>
        <select className="rk-input rk-input-auto" value={fPhone} onChange={(e) => setFPhone(e.target.value)}><option value="">All phones</option>{data.phones.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        {canEdit && activeInList.length > 1 && <button className="rk-btn rk-ghost rk-small" onClick={() => setSel(activeInList.map((i) => i.id))}>Select all</button>}
      </div>

      {canEdit && selItems.length > 0 && (
        <div className="rk-bulkbar">
          <strong>{selItems.length} selected · cost {eur(selItems.reduce((a, i) => a + i.costo, 0))}</strong>
          <button className="rk-btn rk-primary rk-small" onClick={() => onBulkSell(selItems)}>Sell together</button>
          <button className="rk-btn rk-small" onClick={() => onAssign(selItems.map((i) => i.id))}><Smartphone size={13} /> List</button>
          <button className="rk-btn rk-small" onClick={() => onBulkFisico(selItems.map((i) => i.id))}><Truck size={13} /> Location</button>
          <button className="rk-btn rk-small" onClick={() => onBulkNote(selItems.map((i) => i.id))}><Pencil size={13} /> Note</button>
          <button className="rk-btn rk-ghost rk-small" onClick={() => setSel([])}>Cancel</button>
        </div>
      )}

      {list.length === 0 ? <p className="rk-empty">No items here.</p> : (
        <div className="rk-rows">
          {list.map((i) => {
            const active = ACTIVE.includes(i.stato);
            return (
              <div key={i.id} className={`rk-row ${!active ? "rk-row-dim" : ""}`}>
                {canEdit && active && <input type="checkbox" className="rk-check" checked={sel.includes(i.id)} onChange={() => toggleSel(i.id)} />}
                <span className="rk-chip">{i.sku}</span>
                {i.fisico === "viaggio" && <span className="rk-badge rk-badge-travel"><Truck size={11} /> in transit</span>}
                {i.fisico === "ordinato" && <span className="rk-badge rk-badge-order">to ship</span>}
                {i.stato === "caricato" && i.caricatoAt && (() => { const g = daysBetween(i.caricatoAt); return <span className={`rk-badge rk-badge-giac ${g >= SLOW_DAYS ? "rk-badge-slow" : ""}`}><Clock size={11} /> {g}d</span>; })()}
                <div className="rk-row-main"><strong>{i.brand} · {i.nome}</strong><span className="rk-row-meta">{i.categoria}{i.taglia ? ` · ${i.taglia}` : ""} · {i.data}{i.note ? ` · ${i.note}` : ""}</span></div>
                {canEdit && active && <button className={`rk-vinted ${i.vinted ? "on" : ""}`} title="Listed on Vinted" onClick={() => onToggleVinted(i)}>{i.vinted ? <Check size={12} /> : null} Vinted</button>}
                {i.stato === "caricato" ? (canEdit ? <button className="rk-badge rk-badge-btn" onClick={() => onAssign([i.id])}><Smartphone size={11} /> {i.telefono}</button> : <span className="rk-badge"><Smartphone size={11} /> {i.telefono}</span>) : i.stato === "stock" ? <span className="rk-badge rk-badge-stock">in stock</span> : <span className={`rk-stato rk-stato-${i.stato}`}>{STATO_LABEL[i.stato]}</span>}
                <span className="rk-mono rk-row-cost">{eur(i.costo)}</span>
                {canEdit && <button className="rk-btn rk-ghost rk-small" title="Edit" onClick={() => onEdit(i)}><Pencil size={14} /></button>}
                {canEdit && active && (<div className="rk-row-actions">
                  {i.stato === "stock" && <button className="rk-btn rk-small" onClick={() => onAssign([i.id])}><Smartphone size={13} /> List</button>}
                  <button className="rk-btn rk-primary rk-small" onClick={() => onSell(i)}>Sell</button>
                  <button className="rk-btn rk-ghost rk-small" title="Gift" onClick={() => onGift(i)}><Gift size={14} /></button>
                  <button className="rk-btn rk-ghost rk-small rk-danger" title="Delete" onClick={() => onDelete(i)}><Trash2 size={14} /></button>
                </div>)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Orders
   ============================================================ */
const EMPTY_ORDER = { tracking: "", corriere: "", nota: "", data: "" };
function OrdersTab({ data, canEdit, onAdd, onDelivered, onDelete }) {
  const [form, setForm] = useState({ ...EMPTY_ORDER, data: todayISO() }); const [sel, setSel] = useState([]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const locked = new Set(data.orders.filter((o) => o.stato === "in_viaggio").flatMap((o) => o.itemIds));
  const eligible = data.items.filter((i) => ACTIVE.includes(i.stato) && !locked.has(i.id)).sort((a, b) => (a.fisico === b.fisico ? 0 : a.fisico === "casa" ? 1 : -1));
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const skuOf = (id) => data.items.find((i) => i.id === id);
  return (
    <div className="rk-stack">
      {canEdit && (
        <div className="rk-card">
          <h3 className="rk-h3"><Truck size={15} /> New supplier order</h3>
          <div className="rk-formgrid">
            <L label="Tracking"><input className="rk-input rk-mono" placeholder="LP123456789CN" value={form.tracking} onChange={set("tracking")} /></L>
            <L label="Carrier (opt.)"><input className="rk-input" placeholder="Yanwen, Cainiao…" value={form.corriere} onChange={set("corriere")} /></L>
            <L label="Order date"><input className="rk-input" type="date" value={form.data} onChange={set("data")} /></L>
            <L label="Note (opt.)"><input className="rk-input" placeholder="9 swim shorts" value={form.nota} onChange={set("nota")} /></L>
          </div>
          <p className="rk-mutlabel rk-mt12 rk-mb6">What's in the parcel? (add items to Stock first)</p>
          {eligible.length === 0 ? <p className="rk-empty">No linkable items.</p> : (
            <div className="rk-picklist">{eligible.map((i) => (<label key={i.id} className={`rk-pick ${sel.includes(i.id) ? "on" : ""}`}><input type="checkbox" className="rk-check" checked={sel.includes(i.id)} onChange={() => toggle(i.id)} /><span className="rk-chip">{i.sku}</span><span className="rk-pick-name">{i.brand} · {i.nome}{i.taglia ? ` · ${i.taglia}` : ""}</span>{i.fisico !== "casa" && <span className="rk-badge rk-badge-travel">{FISICO_LABEL[i.fisico]}</span>}</label>))}</div>
          )}
          <div className="rk-formfoot"><span className="rk-mutlabel">{sel.length} items · will be marked "in transit"</span><button className="rk-btn rk-primary" disabled={!form.tracking.trim() || !sel.length} onClick={() => { onAdd(form, sel); setForm({ ...EMPTY_ORDER, data: todayISO() }); setSel([]); }}><Plus size={15} /> Create order</button></div>
        </div>
      )}
      {data.orders.length === 0 ? <p className="rk-empty">No tracked orders.</p> : (
        <div className="rk-rows">{data.orders.map((o) => (
          <div key={o.id} className={`rk-row ${o.stato === "consegnato" ? "rk-row-dim" : ""}`}>
            <span className="rk-chip">{o.tracking || "—"}</span>
            <div className="rk-row-main"><strong>{o.nota || `Order ${o.data}`}{o.corriere ? ` · ${o.corriere}` : ""}</strong><span className="rk-row-meta">{o.data} · {o.itemIds.length} items: {o.itemIds.map((id) => skuOf(id)?.sku).filter(Boolean).slice(0, 5).join(", ")}{o.itemIds.length > 5 ? ` +${o.itemIds.length - 5}` : ""}</span></div>
            <span className={`rk-badge ${o.stato === "in_viaggio" ? "rk-badge-travel" : "rk-badge-in"}`}>{o.stato === "in_viaggio" ? "in transit" : "delivered"}</span>
            {o.tracking && <a className="rk-btn rk-ghost rk-small" href={`https://t.17track.net/en#nums=${encodeURIComponent(o.tracking)}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> 17track</a>}
            {canEdit && o.stato === "in_viaggio" && <button className="rk-btn rk-primary rk-small" onClick={() => onDelivered(o)}>Delivered</button>}
            {canEdit && <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(o)}><Trash2 size={14} /></button>}
          </div>
        ))}</div>
      )}
    </div>
  );
}

/* ============================================================
   Sales
   ============================================================ */
function SalesTab({ data, canEdit, nameOf, onDelete, onSetReso }) {
  if (data.sales.length === 0) return <p className="rk-empty">No sales yet. Hit "Sell" on a stock item.</p>;
  const fasi = [["no", "No return"], ["in_arrivo", "Return incoming"], ["spedito", "Return shipped"], ["consegnato", "Return received → stock"]];
  return (
    <div className="rk-rows">
      {data.sales.map((s) => {
        const reso = s.reso && s.reso !== "no";
        const margine = reso ? 0 : s.prezzo - s.costo - (s.costiVendita || 0);
        const roi = s.costo > 0 ? (margine / s.costo) * 100 : 0;
        const tone = reso ? "mut" : roiTone(roi);
        return (
          <div key={s.id} className={`rk-row ${reso ? "rk-row-reso" : ""}`}>
            <span className="rk-chip">{s.sku}</span>
            {reso && <span className="rk-badge rk-badge-reso">{RESO_LABEL[s.reso]}</span>}
            {s.giacenzaGiorni != null && !reso && <span className={`rk-badge rk-badge-giac ${s.giacenzaGiorni >= SLOW_DAYS ? "rk-badge-slow" : ""}`}><Clock size={11} /> {s.giacenzaGiorni}d</span>}
            <div className="rk-row-main"><strong>{s.brand} · {s.nome}</strong><span className="rk-row-meta">{s.data} · {s.canale} · {nameOf ? nameOf(s.sellerId) : s.telefono}</span></div>
            <div className="rk-saleNums rk-mono"><span>{eur(s.prezzo)}</span><span className="rk-mutlabel">cost {eur(s.costo)}{s.costiVendita ? ` + ${eur(s.costiVendita)}` : ""}</span></div>
            <div className="rk-saleMargin"><span className={`rk-mono rk-margin rk-tonetext-${tone}`}>{reso ? eur(0) : (margine >= 0 ? "+" : "") + eur(margine)}</span>{!reso && <span className={`rk-roi rk-tone-${tone}`}>ROI {roi.toFixed(0)}%</span>}</div>
            {canEdit ? (<select className="rk-input rk-input-auto rk-reso-select" value={s.reso || "no"} onChange={(e) => onSetReso(s, e.target.value)}>{fasi.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>) : null}
            {canEdit && <button className="rk-btn rk-ghost rk-small rk-danger" title="Undo sale" onClick={() => onDelete(s)}><Trash2 size={14} /></button>}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Expenses
   ============================================================ */
const EMPTY_EXP = { tipo: "Boost", importo: "", data: "", nota: "", telefono: "" };
function ExpensesTab({ data, canEdit, onAdd, onDelete, onEdit }) {
  const [form, setForm] = useState({ ...EMPTY_EXP, data: todayISO() });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="rk-stack">
      {canEdit && (
        <div className="rk-card">
          <div className="rk-formgrid">
            <L label="Type"><select className="rk-input" value={form.tipo} onChange={set("tipo")}>{EXPENSE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></L>
            <L label="Amount €"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0.00" value={form.importo} onChange={set("importo")} /></L>
            <L label="Date"><input className="rk-input" type="date" value={form.data} onChange={set("data")} /></L>
            <L label="Phone (opt.)"><select className="rk-input" value={form.telefono} onChange={set("telefono")}><option value="">—</option>{data.phones.map((p) => <option key={p} value={p}>{p}</option>)}</select></L>
            <L label="Note" wide><input className="rk-input" placeholder="Boost 3d / 100 mailers…" value={form.nota} onChange={set("nota")} /></L>
          </div>
          <div className="rk-formfoot"><span /><button className="rk-btn rk-primary" disabled={!num(form.importo)} onClick={() => { onAdd(form); setForm({ ...EMPTY_EXP, data: todayISO() }); }}><Plus size={15} /> Record expense</button></div>
        </div>
      )}
      {data.expenses.length === 0 ? <p className="rk-empty">No expenses.</p> : (
        <div className="rk-rows">{data.expenses.map((e) => (
          <div key={e.id} className="rk-row"><span className="rk-badge rk-badge-exp">{e.tipo}</span><div className="rk-row-main"><strong>{e.nota || e.tipo}</strong><span className="rk-row-meta">{e.data}{e.telefono ? ` · ${e.telefono}` : ""}</span></div><span className="rk-mono rk-neg">−{eur(e.importo)}</span>{canEdit && <button className="rk-btn rk-ghost rk-small" title="Edit" onClick={() => onEdit(e)}><Pencil size={14} /></button>}{canEdit && <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(e)}><Trash2 size={14} /></button>}</div>
        ))}</div>
      )}
    </div>
  );
}

/* ============================================================
   To-do
   ============================================================ */
function TodoTab({ data, canEdit, onAdd, onToggle, onDelete }) {
  const [testo, setTesto] = useState("");
  const aperti = data.todos.filter((t) => !t.fatto); const fatti = data.todos.filter((t) => t.fatto);
  const add = () => { if (testo.trim()) { onAdd(testo.trim()); setTesto(""); } };
  return (
    <div className="rk-stack">
      {canEdit && <div className="rk-card"><div className="rk-todoadd"><input className="rk-input" placeholder="e.g. Ship COS-012 · reply to offer…" value={testo} onChange={(e) => setTesto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /><button className="rk-btn rk-primary" disabled={!testo.trim()} onClick={add}><Plus size={15} /> Add</button></div></div>}
      {data.todos.length === 0 ? <p className="rk-empty">No reminders yet.</p> : (
        <div className="rk-rows">
          {aperti.map((t) => (<div key={t.id} className="rk-row rk-todo"><button className="rk-todocheck" onClick={() => canEdit && onToggle(t)} /><span className="rk-row-main"><strong>{t.testo}</strong></span>{canEdit && <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(t)}><Trash2 size={14} /></button>}</div>))}
          {fatti.map((t) => (<div key={t.id} className="rk-row rk-todo rk-todo-done"><button className="rk-todocheck on" onClick={() => canEdit && onToggle(t)}><Check size={12} /></button><span className="rk-row-main"><strong>{t.testo}</strong></span>{canEdit && <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(t)}><Trash2 size={14} /></button>}</div>))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Supplier credit
   ============================================================ */
function CreditsTab({ data, balance, canEdit, onIn, onPay, onDelete }) {
  const [inF, setInF] = useState({ ordine: "", nota: "", data: todayISO() });
  const [payF, setPayF] = useState({ importo: "", nota: "", data: todayISO() });
  const pct = data.ws?.pct ?? 5;
  const credito = +(num(inF.ordine) * (pct / 100)).toFixed(2);
  const usato = +Math.min(Math.max(balance, 0), num(payF.importo)).toFixed(2);
  const contanti = +(num(payF.importo) - usato).toFixed(2);
  return (
    <div className="rk-stack">
      <div className="rk-card rk-walletline rk-wallet-hero"><Wallet size={18} /><span>Supplier credit available</span><strong className="rk-mono">{eur(balance)}</strong></div>
      {canEdit && (
        <div className="rk-grid2">
          <div className="rk-card">
            <h3 className="rk-h3">Brokered order → {pct}% credit</h3>
            <div className="rk-formgrid rk-formgrid-tight">
              <L label="Order amount €"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0.00" value={inF.ordine} onChange={(e) => setInF({ ...inF, ordine: e.target.value })} /></L>
              <L label="Date"><input className="rk-input" type="date" value={inF.data} onChange={(e) => setInF({ ...inF, data: e.target.value })} /></L>
              <L label="Note" wide><input className="rk-input" placeholder="Marco's order — 3 kits" value={inF.nota} onChange={(e) => setInF({ ...inF, nota: e.target.value })} /></L>
            </div>
            <div className="rk-formfoot"><span className="rk-mutlabel">Credit earned: <strong className="rk-mono">{eur(credito)}</strong></span><button className="rk-btn rk-primary" disabled={!credito} onClick={() => { onIn(inF); setInF({ ordine: "", nota: "", data: todayISO() }); }}><Plus size={15} /> Record</button></div>
          </div>
          <div className="rk-card">
            <h3 className="rk-h3">Money sent to supplier</h3>
            <div className="rk-formgrid rk-formgrid-tight">
              <L label="Amount sent €"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0.00" value={payF.importo} onChange={(e) => setPayF({ ...payF, importo: e.target.value })} /></L>
              <L label="Date"><input className="rk-input" type="date" value={payF.data} onChange={(e) => setPayF({ ...payF, data: e.target.value })} /></L>
              <L label="Note" wide><input className="rk-input" placeholder="Payment for swim order" value={payF.nota} onChange={(e) => setPayF({ ...payF, nota: e.target.value })} /></L>
            </div>
            <div className="rk-formfoot"><span className="rk-mutlabel">From credit <strong className="rk-mono rk-amber">{eur(usato)}</strong> · cash <strong className="rk-mono rk-neg">{eur(contanti)}</strong></span><button className="rk-btn rk-primary" disabled={!num(payF.importo)} onClick={() => { onPay(payF); setPayF({ importo: "", nota: "", data: todayISO() }); }}><Plus size={15} /> Record</button></div>
          </div>
        </div>
      )}
      {data.credits.length === 0 ? <p className="rk-empty">No movements.</p> : (
        <div className="rk-rows">{data.credits.map((c) => (
          <div key={c.id} className="rk-row"><span className={`rk-badge ${c.tipo === "in" ? "rk-badge-in" : "rk-badge-out"}`}>{c.tipo === "in" ? "earned" : "payment"}</span><div className="rk-row-main"><strong>{c.nota || (c.tipo === "in" ? "Brokered order" : "Supplier payment")}</strong><span className="rk-row-meta">{c.data}{c.tipo === "in" ? ` · order ${eur(c.ordine)}` : ` · sent ${eur(c.importo)} (credit ${eur(c.usatoCredito)} + cash ${eur(c.contanti)})`}</span></div><span className={`rk-mono ${c.tipo === "in" ? "rk-pos" : "rk-neg"}`}>{c.tipo === "in" ? "+" + eur(c.importo) : "−" + eur(c.usatoCredito || 0)}</span>{canEdit && <button className="rk-btn rk-ghost rk-small rk-danger" onClick={() => onDelete(c)}><Trash2 size={14} /></button>}</div>
        ))}</div>
      )}
    </div>
  );
}

/* ============================================================
   Modals
   ============================================================ */
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
      <p className="rk-mutlabel">Cost {eur(item.costo)} · {item.telefono || "in stock"}{giac != null ? ` · ${giac}d in stock` : ""}</p>
      <div className="rk-formgrid rk-formgrid-tight">
        <L label="Sale price €"><input autoFocus className="rk-input rk-mono" inputMode="decimal" placeholder="0.00" value={form.prezzo} onChange={(e) => setForm({ ...form, prezzo: e.target.value })} /></L>
        <L label="Channel"><select className="rk-input" value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></L>
        {form.canale === "Other" && <L label="Which channel?" wide><input className="rk-input" placeholder="e.g. Subito, Instagram…" value={form.canaleAltro} onChange={(e) => setForm({ ...form, canaleAltro: e.target.value })} /></L>}
        <L label="Selling fees € (opt.)"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0.00" value={form.costi} onChange={(e) => setForm({ ...form, costi: e.target.value })} /></L>
        <L label="Date"><input className="rk-input" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></L>
      </div>
      <div className="rk-formfoot"><span className="rk-mutlabel">Margin <strong className={`rk-mono rk-tonetext-${roiTone(roi)}`}>{eur(margine)}</strong> · ROI <strong className={`rk-mono rk-tonetext-${roiTone(roi)}`}>{roi.toFixed(0)}%</strong></span><button className="rk-btn rk-primary" disabled={!num(form.prezzo) || busy} onClick={() => { setBusy(true); onConfirm(item, form); }}>{busy ? <Loader2 size={15} className="rk-spin" /> : null} Record sale</button></div>
    </Overlay>
  );
}
function BulkSaleModal({ items, onClose, onConfirm }) {
  const [form, setForm] = useState({ prezzo: "", canale: "Vinted", canaleAltro: "", costi: "", data: todayISO() });
  const [busy, setBusy] = useState(false);
  const costoTot = items.reduce((a, i) => a + i.costo, 0); const ricavoTot = items.length * num(form.prezzo);
  const margine = ricavoTot - items.length * num(form.costi) - costoTot; const roi = costoTot > 0 ? (margine / costoTot) * 100 : 0;
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Tag size={16} /> Sell {items.length} items</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <p className="rk-mutlabel rk-mb6">{items.slice(0, 4).map((i) => i.sku).join(", ")}{items.length > 4 ? ` +${items.length - 4}` : ""} · cost {eur(costoTot)}</p>
      <div className="rk-formgrid rk-formgrid-tight">
        <L label="Price each €"><input autoFocus className="rk-input rk-mono" inputMode="decimal" placeholder="0.00" value={form.prezzo} onChange={(e) => setForm({ ...form, prezzo: e.target.value })} /></L>
        <L label="Channel"><select className="rk-input" value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></L>
        {form.canale === "Other" && <L label="Which channel?" wide><input className="rk-input" placeholder="e.g. Subito, Instagram…" value={form.canaleAltro} onChange={(e) => setForm({ ...form, canaleAltro: e.target.value })} /></L>}
        <L label="Fees each € (opt.)"><input className="rk-input rk-mono" inputMode="decimal" placeholder="0.00" value={form.costi} onChange={(e) => setForm({ ...form, costi: e.target.value })} /></L>
        <L label="Date"><input className="rk-input" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></L>
      </div>
      <div className="rk-formfoot"><span className="rk-mutlabel">Revenue <strong className="rk-mono">{eur(ricavoTot)}</strong> · Margin <strong className={`rk-mono rk-tonetext-${roiTone(roi)}`}>{eur(margine)}</strong> · ROI <strong className={`rk-mono rk-tonetext-${roiTone(roi)}`}>{roi.toFixed(0)}%</strong></span><button className="rk-btn rk-primary" disabled={!num(form.prezzo) || busy} onClick={() => { setBusy(true); onConfirm(items, form); }}>{busy ? <Loader2 size={15} className="rk-spin" /> : null} Record {items.length}</button></div>
    </Overlay>
  );
}
function AssignPhoneModal({ phones, count, onClose, onConfirm }) {
  const [phone, setPhone] = useState(phones[0] || "");
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Smartphone size={16} /> List on account</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <p className="rk-mutlabel rk-mb6">{count > 1 ? `${count} items` : "The item"} will be marked "listed".</p>
      <select className="rk-input" value={phone} onChange={(e) => setPhone(e.target.value)}>{phones.map((p) => <option key={p} value={p}>{p}</option>)}<option value="__none__">↩ Move back to stock</option></select>
      <div className="rk-formfoot rk-mt12"><span /><button className="rk-btn rk-primary" onClick={() => onConfirm(phone)}>Confirm</button></div>
    </Overlay>
  );
}
function EditItemModal({ item, onClose, onSave }) {
  const [form, setForm] = useState({ nome: item.nome, taglia: item.taglia, costo: String(item.costo), note: item.note || "", fisico: item.fisico || "casa", data: item.data });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><span className="rk-chip">{item.sku}</span><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <h3 className="rk-modal-title"><Pencil size={15} /> Edit item</h3>
      <div className="rk-formgrid rk-formgrid-tight">
        <L label="Item" wide><input className="rk-input" value={form.nome} onChange={set("nome")} /></L>
        <L label="Size"><input className="rk-input" value={form.taglia} onChange={set("taglia")} /></L>
        <L label="Cost €"><input className="rk-input rk-mono" inputMode="decimal" value={form.costo} onChange={set("costo")} /></L>
        <L label="Location"><select className="rk-input" value={form.fisico} onChange={set("fisico")}>{FISICO_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></L>
        <L label="Date"><input className="rk-input" type="date" value={form.data} onChange={set("data")} /></L>
        <L label="Notes" wide><textarea className="rk-input rk-textarea" rows={3} value={form.note} onChange={set("note")} /></L>
      </div>
      <div className="rk-formfoot"><span /><button className="rk-btn rk-primary" onClick={() => onSave(item.id, { nome: form.nome.trim(), taglia: form.taglia.trim(), costo: num(form.costo), note: form.note.trim(), fisico: form.fisico, data: form.data })}>Save</button></div>
    </Overlay>
  );
}
function BulkNoteModal({ count, onClose, onConfirm }) {
  const [note, setNote] = useState("");
  return (<Overlay onClose={onClose}><div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Pencil size={16} /> Note on {count} items</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div><textarea autoFocus className="rk-input rk-textarea" rows={3} placeholder="e.g. Supplier order 06/10" value={note} onChange={(e) => setNote(e.target.value)} /><div className="rk-formfoot rk-mt12"><span /><button className="rk-btn rk-primary" disabled={!note.trim()} onClick={() => onConfirm(note.trim())}>Apply</button></div></Overlay>);
}
function BulkFisicoModal({ count, onClose, onConfirm }) {
  const [f, setF] = useState("casa");
  return (<Overlay onClose={onClose}><div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Truck size={16} /> Location of {count} items</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div><select className="rk-input" value={f} onChange={(e) => setF(e.target.value)}>{FISICO_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select><div className="rk-formfoot rk-mt12"><span /><button className="rk-btn rk-primary" onClick={() => onConfirm(f)}>Apply</button></div></Overlay>);
}
function EditExpenseModal({ exp, phones, onClose, onSave }) {
  const [form, setForm] = useState({ tipo: exp.tipo, importo: String(exp.importo), data: exp.data, nota: exp.nota || "", telefono: exp.telefono || "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const tipi = EXPENSE_TYPES.includes(form.tipo) ? EXPENSE_TYPES : [form.tipo, ...EXPENSE_TYPES];
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Pencil size={16} /> Edit expense</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>
      <div className="rk-formgrid rk-formgrid-tight">
        <L label="Type"><select className="rk-input" value={form.tipo} onChange={set("tipo")}>{tipi.map((t) => <option key={t}>{t}</option>)}</select></L>
        <L label="Amount €"><input className="rk-input rk-mono" inputMode="decimal" value={form.importo} onChange={set("importo")} /></L>
        <L label="Date"><input className="rk-input" type="date" value={form.data} onChange={set("data")} /></L>
        <L label="Phone (opt.)"><select className="rk-input" value={form.telefono} onChange={set("telefono")}><option value="">—</option>{phones.map((p) => <option key={p} value={p}>{p}</option>)}</select></L>
        <L label="Note" wide><input className="rk-input" placeholder="e.g. 9 mailers" value={form.nota} onChange={set("nota")} /></L>
      </div>
      <div className="rk-formfoot"><span /><button className="rk-btn rk-primary" onClick={() => onSave(exp.id, { tipo: form.tipo, importo: num(form.importo), data: form.data, nota: form.nota.trim(), telefono: form.telefono })}>Save</button></div>
    </Overlay>
  );
}
function SettingsModal({ ws, members, role, canManage, isTeam, onClose, onSave, onChangeRole, flash }) {
  const [name, setName] = useState(ws.name);
  const [phones, setPhones] = useState(Array.isArray(ws.phones) ? [...ws.phones] : []);
  const [pct, setPct] = useState(String(ws.pct));
  const [sBase, setSBase] = useState(String(ws.seller_base ?? 8));
  const [sBonus, setSBonus] = useState(String(ws.seller_bonus ?? 10));
  const [sThr, setSThr] = useState(String(ws.bonus_threshold ?? 5));
  const copyCode = () => { navigator.clipboard?.writeText(ws.join_code); flash && flash("Code copied"); };
  return (
    <Overlay onClose={onClose}>
      <div className="rk-modal-head"><h3 className="rk-modal-title rk-m0"><Settings size={16} /> {isTeam ? "Team settings" : "Settings"}</h3><button className="rk-btn rk-ghost rk-sq" onClick={onClose}><X size={16} /></button></div>

      <div className="rk-joincard">
        <div><div className="rk-field-label">{isTeam ? "Team join code" : "Invite code"}</div><div className="rk-joincode rk-mono">{ws.join_code}</div></div>
        <button className="rk-btn rk-small" onClick={copyCode}><Copy size={13} /> Copy</button>
      </div>
      <p className="rk-mutlabel rk-mb6">{isTeam ? "Share this code so sellers/investor can join your team on signup." : "Want to work with others? Share this code — when someone joins, RACK turns into a team with payouts."}</p>

      {canManage ? (<>
        <label className="rk-field rk-mt12"><span className="rk-field-label">{isTeam ? "Team name" : "Space name"}</span><input className="rk-input" value={name} onChange={(e) => setName(e.target.value)} /></label>

        <p className="rk-mutlabel rk-mt12 rk-mb6">Phones / accounts</p>
        <div className="rk-stack-tight">
          {phones.map((p, idx) => (<div key={idx} className="rk-phone-edit"><Smartphone size={14} /><input className="rk-input" value={p} onChange={(e) => { const n = [...phones]; n[idx] = e.target.value; setPhones(n); }} /><button className="rk-btn rk-ghost rk-sq rk-danger" onClick={() => setPhones(phones.filter((_, i) => i !== idx))}><Trash2 size={14} /></button></div>))}
          <button className="rk-btn rk-ghost" onClick={() => setPhones([...phones, `Account ${phones.length + 1}`])}><Plus size={14} /> Add phone</button>
        </div>

        <div className="rk-formgrid rk-formgrid-tight rk-mt12">
          <L label="Supplier %"><input className="rk-input rk-mono" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></L>
        </div>

        {isTeam && (<>
          <p className="rk-mutlabel rk-mt12 rk-mb6">Seller pay</p>
          <div className="rk-formgrid rk-formgrid-tight">
            <L label="€ per sale"><input className="rk-input rk-mono" inputMode="decimal" value={sBase} onChange={(e) => setSBase(e.target.value)} /></L>
            <L label="€ per sale (bonus)"><input className="rk-input rk-mono" inputMode="decimal" value={sBonus} onChange={(e) => setSBonus(e.target.value)} /></L>
            <L label="Bonus at … sales/day"><input className="rk-input rk-mono" inputMode="numeric" value={sThr} onChange={(e) => setSThr(e.target.value)} /></L>
          </div>

          <p className="rk-mutlabel rk-mt12 rk-mb6">Team members</p>
          <div className="rk-stack-tight">
            {members.map((mb) => (
              <div key={mb.id} className="rk-phone-edit">
                {mb.role === "manager" ? <Crown size={14} /> : mb.role === "investor" ? <Eye size={14} /> : <Users size={14} />}
                <span className="rk-row-main"><strong>{mb.display_name || "—"}</strong></span>
                <select className="rk-input rk-input-auto" value={mb.role} onChange={(e) => onChangeRole(mb.id, e.target.value)}>
                  <option value="manager">Manager</option><option value="investor">Investor</option><option value="seller">Seller</option>
                </select>
              </div>
            ))}
          </div>
        </>)}

        <div className="rk-formfoot rk-mt12"><span /><button className="rk-btn rk-primary" onClick={() => onSave({ name, phones: phones.filter((p) => p.trim()), pct: num(pct) || 5, sellerBase: num(sBase), sellerBonus: num(sBonus), bonusThreshold: parseInt(sThr, 10) || 5 })}>Save</button></div>
      </>) : (
        <p className="rk-mutlabel rk-mt12">Only the manager can edit settings. Your role: <strong>{ROLE_LABEL[role]}</strong>.</p>
      )}
    </Overlay>
  );
}

/* ---------- demo data ---------- */
function demoFixture() {
  const dAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const tAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
  const id = (x) => "demo-" + x;
  const me = "demo-user", luca = "demo-luca", sara = "demo-sara";
  const workspace = { id: "demo-ws", name: "Demo Team", join_code: "DEMO24", is_team: true, pct: 5, seller_base: 8, seller_bonus: 10, bonus_threshold: 5, phones: ["iPhone Vinted", "Account 2", "Account 3"] };
  const members = [
    { id: "m1", user_id: me, role: "manager", display_name: "You" },
    { id: "m2", user_id: "demo-inv", role: "investor", display_name: "Investor" },
    { id: "m3", user_id: luca, role: "seller", display_name: "Luca" },
    { id: "m4", user_id: sara, role: "seller", display_name: "Sara" },
  ];
  const mkDay = (sid, day, n, brand) => Array.from({ length: n }, (_, k) => ({ id: id(`s_${sid}_${day}_${k}`), itemId: id("x" + k), sku: `${brand.slice(0,3).toUpperCase()}-COS-${day}${k}`, nome: "Item", brand, prezzo: 39.9, costo: 15.41, costiVendita: 0.24, canale: "Vinted", data: dAgo(day), telefono: "iPhone Vinted", reso: "no", giacenzaGiorni: 6 + day, sellerId: sid }));
  return {
    ctx: { workspace, membership: members[0], members },
    data: {
      items: [
        { id: id("i1"), sku: "BUR-COS-001", brand: "Burberry", nome: "Check shorts", categoria: "Swimwear", taglia: "M", costo: 15.41, telefono: "iPhone Vinted", stato: "caricato", fisico: "casa", vinted: true, caricatoAt: tAgo(42), data: dAgo(45), note: "" },
        { id: id("i2"), sku: "BUR-COS-002", brand: "Burberry", nome: "Blue shorts", categoria: "Swimwear", taglia: "L", costo: 15.41, telefono: "Account 2", stato: "caricato", fisico: "casa", vinted: false, caricatoAt: tAgo(5), data: dAgo(7), note: "" },
        { id: id("i3"), sku: "JUV-KIT-001", brand: "Juventus", nome: "Home kit 24/25", categoria: "Football kit", taglia: "M", costo: 22, telefono: "", stato: "stock", fisico: "viaggio", vinted: false, caricatoAt: null, data: dAgo(2), note: "Supplier order" },
      ],
      sales: [
        ...mkDay(luca, 0, 6, "Burberry"),  // 6 sales today -> bonus day
        ...mkDay(luca, 4, 2, "Nike"),
        ...mkDay(sara, 1, 3, "Juventus"),
        { id: id("sret"), itemId: id("xr"), sku: "NIK-TUT-010", nome: "Tech suit", brand: "Nike", prezzo: 49, costo: 28, costiVendita: 0.5, canale: "Depop", data: dAgo(3), telefono: "Account 3", reso: "in_arrivo", giacenzaGiorni: 40, sellerId: sara },
      ],
      expenses: [
        { id: id("e1"), tipo: "Boost", importo: 3.99, data: dAgo(2), nota: "Boost 3d", telefono: "iPhone Vinted", saleId: null },
        { id: id("e2"), tipo: "Packaging", importo: 4.8, data: dAgo(4), nota: "20 mailers", telefono: "", saleId: null },
      ],
      credits: [
        { id: id("c1"), tipo: "in", ordine: 200, importo: 10, usatoCredito: 0, contanti: 0, data: dAgo(6), nota: "Marco's order" },
        { id: id("c2"), tipo: "pagamento", ordine: 0, importo: 150, usatoCredito: 10, contanti: 140, data: dAgo(3), nota: "Payment" },
      ],
      orders: [{ id: id("o1"), tracking: "LP00123456789CN", corriere: "Yanwen", nota: "Kits", data: dAgo(2), stato: "in_viaggio", itemIds: [id("i3")] }],
      todos: [{ id: id("t1"), testo: "Ship JUV-KIT to Luca", fatto: false }, { id: id("t2"), testo: "Reply to offer", fatto: false }],
    },
  };
}

function Overlay({ children, onClose }) { return <div className="rk-overlay" onClick={onClose}><div className="rk-modal" onClick={(e) => e.stopPropagation()}>{children}</div></div>; }
function L({ label, children, wide }) { return <label className={`rk-field ${wide ? "rk-field-wide" : ""}`}><span className="rk-field-label">{label}</span>{children}</label>; }
