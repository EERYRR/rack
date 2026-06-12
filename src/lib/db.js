import { supabase } from "../supabaseClient";

/* ============================================================
   Mappatura colonne DB (snake_case) <-> oggetti app (camelCase)
   ============================================================ */
const mapFrom = {
  items: (r) => ({
    id: r.id, sku: r.sku, brand: r.brand, nome: r.nome, categoria: r.categoria,
    taglia: r.taglia, costo: Number(r.costo), telefono: r.telefono || "",
    stato: r.stato, fisico: r.fisico, vinted: !!r.vinted, data: r.data, note: r.note || "",
  }),
  sales: (r) => ({
    id: r.id, itemId: r.item_id, sku: r.sku, nome: r.nome, brand: r.brand,
    prezzo: Number(r.prezzo), costo: Number(r.costo), costiVendita: Number(r.costi_vendita),
    canale: r.canale, data: r.data, telefono: r.telefono || "",
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
};

const mapTo = {
  items: (o, uid) => ({
    user_id: uid, sku: o.sku, brand: o.brand, nome: o.nome, categoria: o.categoria,
    taglia: o.taglia, costo: o.costo, telefono: o.telefono || "", stato: o.stato,
    fisico: o.fisico, vinted: !!o.vinted, data: o.data || null, note: o.note || "",
  }),
  sales: (o, uid) => ({
    user_id: uid, item_id: o.itemId, sku: o.sku, nome: o.nome, brand: o.brand,
    prezzo: o.prezzo, costo: o.costo, costi_vendita: o.costiVendita || 0,
    canale: o.canale, data: o.data || null, telefono: o.telefono || "",
  }),
  expenses: (o, uid) => ({
    user_id: uid, tipo: o.tipo, importo: o.importo, data: o.data || null,
    nota: o.nota || "", telefono: o.telefono || "", sale_id: o.saleId || null,
  }),
  credits: (o, uid) => ({
    user_id: uid, tipo: o.tipo, ordine: o.ordine || 0, importo: o.importo,
    usato_credito: o.usatoCredito || 0, contanti: o.contanti || 0,
    data: o.data || null, nota: o.nota || "",
  }),
  orders: (o, uid) => ({
    user_id: uid, tracking: o.tracking || "", corriere: o.corriere || "", nota: o.nota || "",
    data: o.data || null, stato: o.stato, item_ids: o.itemIds || [],
  }),
};

/* ---------- profilo ---------- */
export async function loadProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  return {
    role: data.role || "reseller",
    pct: Number(data.pct ?? 5),
    phones: Array.isArray(data.phones) ? data.phones : [],
    email: data.email,
  };
}

export async function updateProfile(userId, patch) {
  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
}

/* ---------- caricamento completo ---------- */
export async function loadAll(userId) {
  const tables = ["items", "sales", "expenses", "credits", "orders"];
  const out = {};
  await Promise.all(
    tables.map(async (t) => {
      const { data, error } = await supabase
        .from(t).select("*").eq("user_id", userId).order("created_at", { ascending: false });
      if (error) throw error;
      out[t] = (data || []).map(mapFrom[t]);
    })
  );
  return out;
}

/* ---------- CRUD generico ---------- */
export async function insertRow(table, obj, userId) {
  const { data, error } = await supabase
    .from(table).insert(mapTo[table](obj, userId)).select().single();
  if (error) throw error;
  return mapFrom[table](data);
}

export async function insertMany(table, objs, userId) {
  const { data, error } = await supabase
    .from(table).insert(objs.map((o) => mapTo[table](o, userId))).select();
  if (error) throw error;
  return (data || []).map(mapFrom[table]);
}

export async function updateRow(table, id, patch) {
  // patch è in camelCase: lo converto al volo per i campi noti
  const remap = {
    itemId: "item_id", costiVendita: "costi_vendita", usatoCredito: "usato_credito",
    itemIds: "item_ids", saleId: "sale_id",
  };
  const row = {};
  Object.entries(patch).forEach(([k, v]) => { row[remap[k] || k] = v; });
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
