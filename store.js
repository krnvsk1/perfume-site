// Слой данных: один и тот же интерфейс для демо-режима (localStorage) и для Supabase.
(function () {
  const cfg = window.APP_CONFIG || {};
  const live = !!(cfg.SUPABASE_URL && cfg.SUPABASE_KEY && window.supabase);
  const KEY = "perfume-site-demo-v3";
  const seed = () => JSON.parse(JSON.stringify(window.CATALOG || []));

  // ---------- демо ----------
  function read() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.items) return s; } catch (e) {}
    return { items: seed(), orders: [] };
  }
  function write(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); return true; }
    catch (e) { return false; }
  }
  const fileToDataUrl = f => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });

  const demo = {
    live: false,
    async list({ all = false } = {}) { const items = read().items; return all ? items : items.filter(p => !p.hidden); },
    async add(item, file) {
      const s = read();
      s.items.unshift({ ...item, id: String(Date.now()), photo_url: file ? await fileToDataUrl(file) : null });
      if (!write(s)) throw new Error("в демо не хватает места для фото, возьми картинку поменьше");
    },
    async update(id, patch, file) {
      const s = read(); const p = s.items.find(x => x.id === id);
      Object.assign(p, patch);
      if (file) p.photo_url = await fileToDataUrl(file);
      if (!write(s)) throw new Error("в демо не хватает места для фото, возьми картинку поменьше");
    },
    async remove(id) { const s = read(); s.items = s.items.filter(x => x.id !== id); write(s); },
    async placeOrder(id, name, phone, ml, full) {
      const s = read(); const p = s.items.find(x => x.id === id);
      if (!p) return "Аромат не найден";
      if (full && !(p.bottle_price && p.bottle_volume)) return "Этот аромат продаётся только на распив";
      const need = full ? p.bottle_volume : Math.floor(ml);
      if (!full && need < (p.min_ml || 1)) return `Минимальный объём ${p.min_ml} мл`;
      if (p.ml_left != null && need > p.ml_left) return `В наличии только ${p.ml_left} мл`;
      if (p.ml_left != null) p.ml_left -= need;
      s.orders.push({ perfume_name: `${p.house} ${p.name}`, customer_name: name, phone, ml: need, full_bottle: full,
        total: full ? p.bottle_price : need * p.price_per_ml, created_at: new Date().toISOString() });
      write(s); return "ok";
    },
    async orders() { return read().orders.slice().reverse(); },
    async session() { return true; },
    async signIn() { return null; },
    async signOut() {},
    reset() { write({ items: seed(), orders: [] }); }
  };

  // ---------- Supabase ----------
  const sb = live ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY) : null;
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  async function upload(file) {
    const path = Date.now() + "-" + file.name.replace(/[^\w.-]/g, "_");
    ok(await sb.storage.from("photos").upload(path, file));
    return sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
  }

  const remote = {
    live: true,
    async list({ all = false } = {}) {
      let q = sb.from("perfumes").select("*").order("house").order("name");
      if (!all) q = q.eq("hidden", false);
      return ok(await q);
    },
    async add(item, file) { ok(await sb.from("perfumes").insert({ ...item, photo_url: file ? await upload(file) : null })); },
    async update(id, patch, file) {
      if (file) patch = { ...patch, photo_url: await upload(file) };
      ok(await sb.from("perfumes").update(patch).eq("id", id));
    },
    async remove(id) { ok(await sb.from("perfumes").delete().eq("id", id)); },
    async placeOrder(id, name, phone, ml, full) {
      return ok(await sb.rpc("place_order", { p_perfume: id, p_name: name, p_phone: phone, p_ml: ml, p_full: full }));
    },
    async orders() { return ok(await sb.from("orders").select("*").order("created_at", { ascending: false }).limit(200)); },
    async session() { return (await sb.auth.getSession()).data.session; },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); return error ? error.message : null; },
    async signOut() { await sb.auth.signOut(); },
    reset() {}
  };

  window.Store = live ? remote : demo;

  window.fmtMoney = n => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " " + (cfg.CURRENCY || "₽");
  window.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
})();
