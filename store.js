// Слой данных: один и тот же интерфейс для демо-режима (localStorage) и для Supabase.
(function () {
  const cfg = window.APP_CONFIG || {};
  const live = !!(cfg.SUPABASE_URL && cfg.SUPABASE_KEY && window.supabase);
  const KEY = "perfume-site-demo-v1";

  const SEED = [
    { id: "1", house: "Maison Vesper", name: "Ноктюрн", description: "Чёрная слива, удовые смолы и ваниль. Тёплый вечерний шлейф.", price_per_ml: 290, bottle_price: 21500, bottle_volume: 100, ml_left: 64, color: "#5B2A4E" },
    { id: "2", house: "Atelier Brume", name: "Морской ирис", description: "Ирис, морская соль и сухой кедр. Прохладный и чистый.", price_per_ml: 210, bottle_price: 15800, bottle_volume: 100, ml_left: 88, color: "#6E8FA6" },
    { id: "3", house: "Casa Lumen", name: "Нероли 7", description: "Цветок апельсина, петитгрейн, белый мускус. Дневной, светлый.", price_per_ml: 170, bottle_price: 9900, bottle_volume: 75, ml_left: 75, color: "#D9B45A" },
    { id: "4", house: "Maison Vesper", name: "Табачный лист", description: "Табак, мёд, сухофрукты и бобы тонка.", price_per_ml: 320, bottle_price: 23900, bottle_volume: 100, ml_left: 22, color: "#8A5A2B" },
    { id: "5", house: "Orto Verde", name: "Инжирный сад", description: "Лист инжира, кокосовое молоко, зелёные ноты.", price_per_ml: 190, bottle_price: 12400, bottle_volume: 100, ml_left: 47, color: "#7C9A5B" },
    { id: "6", house: "Atelier Brume", name: "Роза в дыму", description: "Турецкая роза, ладан, пачули.", price_per_ml: 260, bottle_price: 18700, bottle_volume: 100, ml_left: 3, color: "#A23A4A" }
  ];

  // ---------- демо ----------
  function read() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.items) return s; } catch (e) {}
    return { items: JSON.parse(JSON.stringify(SEED)), orders: [] };
  }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  const fileToDataUrl = f => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });

  const demo = {
    live: false,
    async list() { return read().items; },
    async add(item, file) {
      const s = read();
      s.items.unshift({ ...item, id: String(Date.now()), photo_url: file ? await fileToDataUrl(file) : null });
      write(s);
    },
    async update(id, patch) { const s = read(); const p = s.items.find(x => x.id === id); Object.assign(p, patch); write(s); },
    async remove(id) { const s = read(); s.items = s.items.filter(x => x.id !== id); write(s); },
    async placeOrder(id, name, phone, ml, full) {
      const s = read(); const p = s.items.find(x => x.id === id);
      if (!p) return "Товар не найден";
      const need = full ? p.bottle_volume : ml;
      if (!need || need <= 0) return "Укажите объём";
      if (need > p.ml_left) return "Недостаточно в наличии";
      p.ml_left -= need;
      s.orders.push({ perfume_name: p.name, customer_name: name, phone, ml: need, full_bottle: full,
        total: full ? p.bottle_price : need * p.price_per_ml, created_at: new Date().toISOString() });
      write(s); return "ok";
    },
    async orders() { return read().orders.slice().reverse(); },
    async session() { return true; },
    async signIn() { return null; },
    async signOut() {},
    reset() { write({ items: JSON.parse(JSON.stringify(SEED)), orders: [] }); }
  };

  // ---------- Supabase ----------
  let sb = live ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY) : null;
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  const remote = {
    live: true,
    async list() { return ok(await sb.from("perfumes").select("*").order("created_at", { ascending: false })); },
    async add(item, file) {
      let photo_url = null;
      if (file) {
        const path = Date.now() + "-" + file.name.replace(/[^\w.-]/g, "_");
        ok(await sb.storage.from("photos").upload(path, file));
        photo_url = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
      }
      ok(await sb.from("perfumes").insert({ ...item, photo_url }));
    },
    async update(id, patch) { ok(await sb.from("perfumes").update(patch).eq("id", id)); },
    async remove(id) { ok(await sb.from("perfumes").delete().eq("id", id)); },
    async placeOrder(id, name, phone, ml, full) {
      return ok(await sb.rpc("place_order", { p_perfume: id, p_name: name, p_phone: phone, p_ml: ml, p_full: full }));
    },
    async orders() { return ok(await sb.from("orders").select("*").order("created_at", { ascending: false }).limit(100)); },
    async session() { return (await sb.auth.getSession()).data.session; },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); return error ? error.message : null; },
    async signOut() { await sb.auth.signOut(); },
    reset() {}
  };

  window.Store = live ? remote : demo;

  // общие помощники
  window.fmtMoney = n => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " " + (cfg.CURRENCY || "₽");
  window.esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
})();
