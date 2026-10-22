# Распив духов

Витрина ароматов с продажей по миллилитрам или целым флаконом, автоматическим остатком, админкой и заявками в Telegram.

## Файлы

| Файл | Что это |
|---|---|
| `index.html` | Витрина для покупателей |
| `admin.html` | Админка: добавление ароматов, остатки, заявки. На витрине ссылки на неё нет |
| `store.js` | Работа с данными (демо или Supabase) |
| `config.js` | Настройки подключения к Supabase |
| `styles.css` | Оформление |
| `data/price.txt` | Прайс распива, перенесённый с Taplink: бренд, аромат, цена за мл, где потестить |
| `data/catalog.js` | Каталог для демо-режима, собирается из прайса |
| `tools/build_catalog.py` | Пересобирает `catalog.js` и `seed.sql` после правки прайса |
| `supabase/schema.sql` | Таблицы, правила доступа и функция заказа |
| `supabase/seed.sql` | Загрузка прайса в базу |
| `supabase/functions/notify/index.ts` | Отправка заявок в Telegram |

## Запуск локально

Пока в `config.js` пустые поля, сайт работает в демо-режиме: шесть тестовых ароматов, данные хранятся в браузере, в админку пускает без пароля.

```bash
cd perfume-site
python3 -m http.server 8000
```

Открой http://localhost:8000 (витрина) и http://localhost:8000/admin.html (админка).

## Прайс и контакты

Контакты, адреса и часы работы лежат в `config.js` в разделе `SHOP`. Прайс лежит в `data/price.txt`: одна строка на аромат, поля через `|`. После правки выполни `python3 tools/build_catalog.py`. Когда база подключена, ароматы удобнее менять в админке: там можно поменять цену, указать остаток, скрыть аромат с витрины и загрузить фото.

## Подключение настоящей базы

1. Зарегистрируйся на https://supabase.com и создай проект.
2. SQL Editor → вставь содержимое `supabase/schema.sql` → Run. Затем так же выполни `supabase/seed.sql`, чтобы загрузить прайс.
3. Authentication → Users → Add user: создай себе почту и пароль для входа в админку.
4. Authentication → Sign In / Providers → выключи «Allow new users to sign up», чтобы никто другой не завёл аккаунт.
5. Project Settings → API: скопируй Project URL и anon public key в `config.js`.

После этого демо-режим выключается, а в админку пускает только по паролю.

## Уведомления в Telegram

1. В Telegram открой @BotFather → `/newbot` → получишь токен.
2. Напиши своему боту любое сообщение, затем узнай свой chat id у @userinfobot.
3. Supabase → Edge Functions → создай функцию `notify` с кодом из `supabase/functions/notify/index.ts`.
4. Edge Functions → Secrets: добавь `TG_TOKEN` и `TG_CHAT`.
5. Database → Webhooks → Create: таблица `orders`, событие Insert, тип Supabase Edge Function, функция `notify`.

## Безопасность админки

Адрес `admin.html` можно переименовать во что-то неочевидное (например `panel-7k2x.html`). Но настоящая защита в базе: без входа никто не может добавить, изменить или удалить аромат и не видит заявки, даже если найдёт страницу.

## Публикация

Сайт статический: подойдут GitHub Pages, Netlify, Vercel или любой хостинг, где можно выложить HTML-файлы.
