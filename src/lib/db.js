import { supabase } from "../supabaseClient";

/* ============================================================
   Column mapping DB(snake_case) <-> app(camelCase)
   ============================================================ */
const mapFrom = {
  items: (r) => ({
    id: r.id, sku: r.sku, brand: r.brand, nome: r.nome, categoria: r.categoria,
    taglia: r.taglia, costo: Number(r.costo), telefono: r.telefono || "",
    stato: r.stato, fisico: r.fisico, vinted: !!r.vinted,
    caricatoAt: r.caricato_at || null, data: r.data, note: r.note || "",
  }),
  sales: (r) => ({
    id: r.id, itemId: r.item_id, sku: r.sku, nome: r.nome, brand: r.brand,
    prezzo: Number(r.prezzo), costo: Number(r.costo), costiVendita: Number(r.costi_vendita),
    canale: r.canale, data: r.data, telefono: r.telefono || "", reso: r.reso || "no",
    giacenzaGiorni: r.giacenza_giorni ?? null, sellerId: r.seller_id || null,
  }),
  expenses: (r) => ({
    id: r.id, tipo: r.tipo, importo: Number(r.importo), data: r.data,
    nota: r.nota || "", telefono: r.telefono || "", saleId: r.sale_id || null,
  }),
  credits: (r) => ({
    id: r.id, tipo: r.tipo, ordine: Number(r.ordine), importo: Number(r.importo),
    usatoCredito: Number(r.usato_credito), contanti: Number(r.contanti),
    data: r.data, nota: r.nota || "",
  }),
  orders: (r) => ({
    id: r.id, tracking: r.tracking || "", corriere: r.corriere || "", nota: r.nota || "",
    data: r.data, stato: r.stato, itemIds: r.item_ids || [],
  }),
  todos: (r) => ({ id: r.id, testo: r.testo, fatto: !!r.fatto }),
};

const mapTo = {
  items: (o, ctx) => ({
    user_id: ctx.userId, workspace_id: ctx.wsId, sku: o.sku, brand: o.brand, nome: o.nome,
    categoria: o.categoria, taglia: o.taglia, costo: o.costo, telefono: o.telefono || "",
    stato: o.stato, fisico: o.fisico, vinted: !!o.vinted, caricato_at: o.caricatoAt || null,
    data: o.data || null, note: o.note || "",
  }),
  sales: (o, ctx) => ({
    user_id: ctx.userId, workspace_id: ctx.wsId, seller_id: o.sellerId || ctx.userId,
    item_id: o.itemId, sku: o.sku, nome: o.nome, brand: o.brand,
    prezzo: o.prezzo, costo: o.costo, costi_vendita: o.costiVendita || 0,
    canale: o.canale, data: o.data || null, telefono: o.telefono || "",
    reso: o.reso || "no", giacenza_giorni: o.giacenzaGiorni ?? null,
  }),
  expenses: (o, ctx) => ({
    user_id: ctx.userId, workspace_id: ctx.wsId, tipo: o.tipo, importo: o.importo,
    data: o.data || null, nota: o.nota || "", telefono: o.telefono || "", sale_id: o.saleId || null,
  }),
  credits: (o, ctx) => ({
    user_id: ctx.userId, workspace_id: ctx.wsId, tipo: o.tipo, ordine: o.ordine || 0,
    importo: o.importo, usato_credito: o.usatoCredito || 0, contanti: o.contanti || 0,
    data: o.data || null, nota: o.nota || "",
  }),
  orders: (o, ctx) => ({
    user_id: ctx.userId, workspace_id: ctx.wsId, tracking: o.tracking || "", corriere: o.corriere || "",
    nota: o.nota || "", data: o.data || null, stato: o.stato, item_ids: o.itemIds || [],
  }),
  todos: (o, ctx) => ({ user_id: ctx.userId, workspace_id: ctx.wsId, testo: o.testo, fatto: !!o.fatto }),
};

const REMAP = {
  itemId: "item_id", costiVendita: "costi_vendita", usatoCredito: "usato_credito",
  itemIds: "item_ids", saleId: "sale_id", caricatoAt: "caricato_at",
  giacenzaGiorni: "giacenza_giorni", sellerId: "seller_id",
};

const randomCode = () =>
  Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

/* ---------- workspace context ---------- */
// returns { workspace, membership, members } or null if the user has no team yet
export async function loadWorkspaceContext(userId) {
  const { data: mems, error } = await supabase
    .from("memberships").select("*").eq("user_id", userId).limit(1);
  if (error) throw error;
  if (!mems || mems.length === 0) return null;
  const membership = mems[0];
  const [{ data: ws, error: e2 }, { data: members, error: e3 }] = await Promise.all([
    supabase.from("workspaces").select("*").eq("id", membership.workspace_id).single(),
    supabase.from("memberships").select("*").eq("workspace_id", membership.workspace_id),
  ]);
  if (e2) throw e2; if (e3) throw e3;
  return { workspace: ws, membership, members: members || [] };
}

export async function createWorkspace(userId, name, displayName, isTeam = true) {
  const { data, error } = await supabase.rpc("create_team", {
    p_name: name || (isTeam ? "My team" : "My space"), p_display: displayName || null, p_is_team: isTeam,
  });
  if (error) throw error;
  return data; // workspace id
}

export async function joinWorkspace(userId, code, displayName) {
  const { data, error } = await supabase.rpc("join_team", {
    p_code: (code || "").toUpperCase().trim(), p_display: displayName || null,
  });
  if (error) throw new Error(error.message || "Invalid team code");
  return data;
}

export async function updateWorkspace(wsId, patch) {
  const { error } = await supabase.from("workspaces").update(patch).eq("id", wsId);
  if (error) throw error;
}

export async function setMemberRole(membershipId, role) {
  const { error } = await supabase.from("memberships").update({ role }).eq("id", membershipId);
  if (error) throw error;
}

/* ---------- load all workspace data ---------- */
export async function loadAll(wsId) {
  const tables = ["items", "sales", "expenses", "credits", "orders", "todos"];
  const out = {};
  await Promise.all(tables.map(async (t) => {
    const { data, error } = await supabase
      .from(t).select("*").eq("workspace_id", wsId).order("created_at", { ascending: false });
    if (error) throw error;
    out[t] = (data || []).map(mapFrom[t]);
  }));
  return out;
}

/* ---------- generic CRUD ---------- */
export async function insertRow(table, obj, ctx) {
  const { data, error } = await supabase.from(table).insert(mapTo[table](obj, ctx)).select().single();
  if (error) throw error;
  return mapFrom[table](data);
}
export async function insertMany(table, objs, ctx) {
  const { data, error } = await supabase.from(table).insert(objs.map((o) => mapTo[table](o, ctx))).select();
  if (error) throw error;
  return (data || []).map(mapFrom[table]);
}
export async function updateRow(table, id, patch) {
  const row = {};
  Object.entries(patch).forEach(([k, v]) => { row[REMAP[k] || k] = v; });
  const { error } = await supabase.from(table).update(row).eq("id", id);
  if (error) throw error;
}
export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}
export async function deleteWhere(table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error) throw error;
}
