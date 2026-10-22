// Обрабатывает нажатия кнопок под сообщением о заказе: «Готов к выдаче», «Выдан», «Отменить».
// Меняет статус заказа в базе (при отмене миллилитры возвращаются в остаток) и обновляет сообщение.
//
// Секреты: TG_TOKEN, TG_CHAT (те же, что у notify) и TG_SECRET — любая длинная случайная строка.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
// Функцию нужно развернуть без проверки JWT: Telegram его не присылает, вместо этого проверяется TG_SECRET.
// Подключение описано в README, раздел «Кнопки в Telegram».

const STATUS: Record<string, string> = { new: "Принят", ready: "Готов к выдаче", done: "Выдан", cancelled: "Отменён" };
const ICON: Record<string, string> = { new: "🆕", ready: "✅", done: "📦", cancelled: "✖️" };
const env = (k: string) => Deno.env.get(k) ?? "";

async function tg(method: string, body: unknown) {
  return fetch(`https://api.telegram.org/bot${env("TG_TOKEN")}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  // запрос должен прийти от Telegram с нашим секретом, иначе игнорируем
  if (!env("TG_SECRET") || req.headers.get("x-telegram-bot-api-secret-token") !== env("TG_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const upd = await req.json().catch(() => ({}));
  const cb = upd.callback_query;
  if (!cb) return new Response("ok");
  // нажимать кнопки может только владелец (тот же чат, куда приходят заказы)
  if (String(cb.message?.chat?.id) !== env("TG_CHAT")) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Нет доступа" });
    return new Response("ok");
  }
  const [kind, status, id] = String(cb.data ?? "").split(":");
  if (kind !== "st" || !STATUS[status] || !/^[0-9a-f-]{36}$/i.test(id ?? "")) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    return new Response("ok");
  }

  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/orders?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: err.message || "Не получилось сменить статус", show_alert: true });
    return new Response("ok");
  }
  const [order] = await res.json();
  if (!order) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Заказ не найден", show_alert: true });
    return new Response("ok");
  }

  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: `Статус: ${STATUS[status]}` });
  // переписываем строку статуса в конце сообщения и оставляем только подходящие кнопки
  const base = String(cb.message.text ?? "").replace(/\n\nСтатус: .*$/s, "");
  const buttons = status === "cancelled" || status === "done" ? [] :
    [["ready", "✅ Готов к выдаче"], ["done", "📦 Выдан"], ["cancelled", "✖️ Отменить"]]
      .filter(([s]) => s !== status).map(([s, t]) => ({ text: t, callback_data: `st:${s}:${id}` }));
  await tg("editMessageText", {
    chat_id: cb.message.chat.id, message_id: cb.message.message_id,
    text: `${base}\n\nСтатус: ${ICON[status]} ${STATUS[status]}`,
    entities: cb.message.entities, // сохраняем жирный шрифт исходного сообщения
    reply_markup: { inline_keyboard: buttons.length ? [buttons] : [] },
  });
  return new Response("ok");
});
