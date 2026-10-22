// Отправляет каждый новый заказ в Telegram с кнопками смены статуса.
// Секреты (Edge Functions → Secrets): TG_TOKEN — токен бота от @BotFather, TG_CHAT — твой chat id (узнать у @userinfobot).
// Вызов: Database → Webhooks → новый вебхук на INSERT в таблицу orders → Supabase Edge Function "notify".
// Кнопки под сообщением обрабатывает функция tg-bot (см. README).

type Line = { name: string; ml: number; full_bottle: boolean; price: number };
const rub = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
// должно совпадать с SHOP.locations в config.js
const PICKUP: Record<string, string> = { "Н": "Народная, 68А", "П": "Жлобы, 139" };

function orderText(r: Record<string, any>) {
  const lines = (r.items as Line[]).map((l) => `• ${esc(l.name)} — ${l.full_bottle ? "флакон" : l.ml + " мл"}, ${rub(l.price)}`);
  return [
    `🛍 <b>Заказ №${r.number}</b>`,
    ...lines,
    `<b>Итого: ${rub(r.total)}</b>`,
    r.pickup ? `📍 Забрать: ${esc(PICKUP[r.pickup] ?? r.pickup)}` : "",
    "",
    esc(r.customer_name),
    esc(r.phone),
  ].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
}

function statusButtons(id: string, status: string) {
  const all = [["ready", "✅ Готов к выдаче"], ["done", "📦 Выдан"], ["cancelled", "✖️ Отменить"]];
  if (status === "cancelled" || status === "done") return { inline_keyboard: [] };
  return { inline_keyboard: [all.filter(([s]) => s !== status).map(([s, t]) => ({ text: t, callback_data: `st:${s}:${id}` }))] };
}

Deno.serve(async (req) => {
  const { record: r } = await req.json();
  const res = await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: Deno.env.get("TG_CHAT"), text: orderText(r), parse_mode: "HTML",
      reply_markup: statusButtons(r.id, r.status),
    }),
  });
  return new Response(res.ok ? "ok" : await res.text(), { status: res.ok ? 200 : 500 });
});
