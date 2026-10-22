// Отправляет каждую новую заявку в Telegram.
// Секреты (Edge Functions → Secrets): TG_TOKEN — токен бота от @BotFather, TG_CHAT — твой chat id (узнать у @userinfobot).
// Вызов: Database → Webhooks → новый вебхук на INSERT в таблицу orders → Supabase Edge Function "notify".

Deno.serve(async (req) => {
  const { record: r } = await req.json();
  const money = new Intl.NumberFormat("ru-RU").format(Math.round(r.total)) + " ₽";
  const text = [
    "🛍 Новая заявка",
    r.perfume_name,
    `${r.full_bottle ? "Флакон" : r.ml + " мл"} — ${money}`,
    r.customer_name,
    r.phone,
  ].join("\n");

  const res = await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: Deno.env.get("TG_CHAT"), text }),
  });
  return new Response(res.ok ? "ok" : await res.text(), { status: res.ok ? 200 : 500 });
});
