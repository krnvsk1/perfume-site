// Слой данных: один и тот же интерфейс для демо-режима (localStorage) и для Supabase.
(function () {
  const cfg = window.APP_CONFIG || {};
  const live = !!(cfg.SUPABASE_URL && cfg.SUPABASE_KEY && window.supabase);
  const KEY = "perfume-site-demo-v5";
  const ME = KEY + "-me";
  const DEMO_CODE = "1234";
  const seed = () => JSON.parse(JSON.stringify(window.CATALOG || []));

  // +7 961 584-83-84, 89615848384, 9615848384 → +79615848384
  function normPhone(raw) {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
    if (d.length === 10) d = "7" + d;
    return d.length >= 11 && d.length <= 15 ? "+" + d : null;
  }

  // ---------- демо ----------
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function read() { const s = ls.get(KEY); return s && s.items ? s : { items: seed(), orders: [], customers: {} }; }
  function write(s) { return ls.set(KEY, s); }
  const fileToDataUrl = f => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });

  // Фото с телефона весят 3–8 МБ. Перед загрузкой уменьшаем до 900 px по большей стороне и сохраняем в WebP:
  // выходит 40–120 КБ, витрина грузится быстро. Прозрачный фон сохраняется.
  async function compressImage(file, max = 900) {
    if (!file || !/^image\//.test(file.type) || file.type === "image/svg+xml") return file;
    try {
      const img = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, "image/webp", 0.85));
      if (!blob || (blob.size >= file.size && k === 1)) return file;
      return new File([blob], file.name.replace(/\.\w+$/, "") + ".webp", { type: "image/webp" });
    } catch (e) { return file; }
  }
  // при отмене заказа миллилитры возвращаются в остаток
  function restock(s, o) {
    o.items.forEach(l => { const p = s.items.find(x => x.id === l.perfume_id); if (p && p.ml_left != null) p.ml_left += l.ml; });
  }
  const fail = error => ({ ok: false, error });

  const demo = {
    live: false,
    demoCode: DEMO_CODE,
    normPhone,
    async list({ all = false } = {}) { const items = read().items; return all ? items : items.filter(p => !p.hidden); },
    async add(item, file) {
      const s = read();
      s.items.unshift({ ...item, id: String(Date.now()), photo_url: file ? await fileToDataUrl(await compressImage(file)) : null });
      if (!write(s)) throw new Error("в демо не хватает места для фото, возьми картинку поменьше");
    },
    async update(id, patch, file) {
      const s = read(); const p = s.items.find(x => x.id === id);
      Object.assign(p, patch);
      if (file) p.photo_url = await fileToDataUrl(await compressImage(file));
      if (!write(s)) throw new Error("в демо не хватает места для фото, возьми картинку поменьше");
    },
    async remove(id) { const s = read(); s.items = s.items.filter(x => x.id !== id); write(s); },

    // покупатель
    async sendCode(phone) { return normPhone(phone) ? null : "Проверь номер телефона"; },
    async verifyCode(phone, code) {
      const ph = normPhone(phone);
      if (!ph) return "Проверь номер телефона";
      if (String(code).trim() !== DEMO_CODE) return "Неверный код";
      const s = read(); s.customers[ph] = s.customers[ph] || { name: "" }; write(s);
      ls.set(ME, ph); return null;
    },
    async customer() { const ph = ls.get(ME); if (!ph) return null; return { phone: ph, name: (read().customers[ph] || {}).name || "" }; },
    async setName(name) { const ph = ls.get(ME); const s = read(); if (ph) { s.customers[ph] = { name }; write(s); } },
    async customerSignOut() { ls.del(ME); },
    async placeOrder(lines, name, pickup) {
      const ph = ls.get(ME); if (!ph) return fail("Войдите по номеру телефона");
      if (!String(name || "").trim()) return fail("Укажите имя");
      if (pickup && !["Н", "П"].includes(pickup)) return fail("Выберите, где забрать заказ");
      if (!lines.length) return fail("Корзина пуста");
      const s = read(), out = []; let sum = 0;
      for (const l of lines) {        // сначала проверяем всё, потом списываем
        const p = s.items.find(x => x.id === l.perfume_id && !x.hidden);
        if (!p) return fail("Один из ароматов больше недоступен");
        const title = `${p.house} ${p.name}`;
        if (l.full_bottle && !(p.bottle_price && p.bottle_volume)) return fail(`${title} продаётся только на распив`);
        const need = l.full_bottle ? p.bottle_volume : Math.floor(l.ml);
        if (!l.full_bottle && need < (p.min_ml || 1)) return fail(`${title}: минимум ${p.min_ml} мл`);
        if (!l.full_bottle && need > 100) return fail(`${title}: на распив не больше 100 мл`);
        if (p.ml_left != null && need > p.ml_left) return fail(`${title}: в наличии ${p.ml_left} мл`);
        const price = l.full_bottle ? p.bottle_price : need * p.price_per_ml;
        out.push({ p, line: { perfume_id: p.id, name: title, ml: need, full_bottle: !!l.full_bottle, price } });
        sum += price;
      }
      out.forEach(({ p, line }) => { if (p.ml_left != null) p.ml_left -= line.ml; });
      const number = (s.orders.reduce((m, o) => Math.max(m, o.number || 0), 0)) + 1;
      s.orders.push({ id: String(Date.now()), number, user_phone: ph, customer_name: name.trim(), phone: ph,
        items: out.map(x => x.line), total: sum, pickup: pickup || null, status: "new", created_at: new Date().toISOString() });
      s.customers[ph] = { name: name.trim() };
      write(s); return { ok: true, number };
    },
    async myOrders() { const ph = ls.get(ME); return read().orders.filter(o => o.user_phone === ph).reverse(); },
    async cancelMyOrder(id) {
      const s = read(), ph = ls.get(ME), o = s.orders.find(x => x.id === id && x.user_phone === ph);
      if (!o || o.status !== "new") return fail("Этот заказ уже нельзя отменить, позвоните нам");
      o.status = "cancelled"; restock(s, o); write(s); return { ok: true };
    },

    // администратор
    async orders() { return read().orders.slice().reverse(); },
    async setStatus(id, status) {
      const s = read(); const o = s.orders.find(x => x.id === id);
      if (!o || o.status === status) return;
      if (o.status === "cancelled") throw new Error("Отменённый заказ нельзя вернуть, оформите новый");
      if (status === "cancelled") restock(s, o);
      o.status = status; write(s);
    },
    async session() { return true; },
    async signIn() { return null; },
    async signOut() {},
    reset() { write({ items: seed(), orders: [], customers: {} }); ls.del(ME); }
  };

  // ---------- Supabase ----------
  const sb = live ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY) : null;
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  async function upload(file) {
    file = await compressImage(file);
    const path = Date.now() + "-" + file.name.replace(/[^\w.-]/g, "_");
    ok(await sb.storage.from("photos").upload(path, file, { contentType: file.type, cacheControl: "31536000" }));
    return sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
  }
  // старое фото удаляем из хранилища, чтобы не копились лишние файлы
  async function dropPhoto(url) {
    const m = String(url || "").match(/\/storage\/v1\/object\/public\/photos\/(.+)$/);
    if (m) await sb.storage.from("photos").remove([decodeURIComponent(m[1])]).catch(() => {});
  }
  const authErr = e => /expired|invalid/i.test(e.message) ? "Неверный или устаревший код" : /rate|seconds/i.test(e.message) ? "Подожди минуту и запроси код снова" : e.message;

  const remote = {
    live: true,
    normPhone,
    async list({ all = false } = {}) {
      let q = sb.from("perfumes").select("*").order("house").order("name");
      if (!all) q = q.eq("hidden", false);
      return ok(await q);
    },
    async add(item, file) { ok(await sb.from("perfumes").insert({ ...item, photo_url: file ? await upload(file) : null })); },
    async update(id, patch, file) {
      let old = null;
      if (file) {
        old = (ok(await sb.from("perfumes").select("photo_url").eq("id", id).single()) || {}).photo_url;
        patch = { ...patch, photo_url: await upload(file) };
      }
      ok(await sb.from("perfumes").update(patch).eq("id", id));
      if (old) await dropPhoto(old);
    },
    async remove(id) {
      const old = (ok(await sb.from("perfumes").select("photo_url").eq("id", id).single()) || {}).photo_url;
      ok(await sb.from("perfumes").delete().eq("id", id));
      if (old) await dropPhoto(old);
    },

    // покупатель: вход по SMS-коду
    async sendCode(phone) {
      const ph = normPhone(phone); if (!ph) return "Проверь номер телефона";
      const { error } = await sb.auth.signInWithOtp({ phone: ph });
      return error ? authErr(error) : null;
    },
    async verifyCode(phone, code) {
      const { error } = await sb.auth.verifyOtp({ phone: normPhone(phone), token: String(code).trim(), type: "sms" });
      return error ? authErr(error) : null;
    },
    async customer() {
      const u = (await sb.auth.getUser()).data.user;
      return u && u.phone ? { phone: "+" + u.phone.replace(/^\+/, ""), name: (u.user_metadata || {}).name || "" } : null;
    },
    async setName(name) { await sb.auth.updateUser({ data: { name } }); },
    async customerSignOut() { await sb.auth.signOut(); },
    async placeOrder(lines, name, pickup) {
      const res = ok(await sb.rpc("place_order", { p_items: lines, p_name: name, p_pickup: pickup || null }));
      if (res.ok) await sb.auth.updateUser({ data: { name } });
      return res;
    },
    async myOrders() {
      const u = (await sb.auth.getUser()).data.user; if (!u) return [];
      return ok(await sb.from("orders").select("*").eq("user_id", u.id).order("created_at", { ascending: false }).limit(50));
    },
    async cancelMyOrder(id) { return ok(await sb.rpc("cancel_my_order", { p_id: id })); },

    // администратор
    async orders() { return ok(await sb.from("orders").select("*").order("created_at", { ascending: false }).limit(500)); },
    async setStatus(id, status) { ok(await sb.from("orders").update({ status }).eq("id", id)); },
    async session() {
      const s = (await sb.auth.getSession()).data.session; if (!s) return null;
      return ok(await sb.rpc("is_admin")) ? s : null;
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return "Неверная почта или пароль.";
      return (await this.session()) ? null : "У этого пользователя нет прав администратора.";
    },
    async signOut() { await sb.auth.signOut(); },
    reset() {}
  };

  window.Store = live ? remote : demo;

  window.compressImage = compressImage;
  window.STATUS = { new: "Принят", ready: "Готов к выдаче", done: "Выдан", cancelled: "Отменён" };
  window.fmtMoney = n => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " " + (cfg.CURRENCY || "₽");
  window.fmtDate = d => new Date(d).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  window.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
})();
