-- Выполни целиком в Supabase: SQL Editor → New query → Run. Потом выполни seed.sql, чтобы загрузить прайс.
-- Скрипт можно запускать повторно: он обновляет функции и правила, не трогая данные.

-- ---------- ароматы ----------
create table if not exists perfumes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  house text,
  description text,
  photo_url text,
  color text default '#6E3F84',
  location text,                         -- 'Н', 'П' или 'НП': где можно потестить
  price_per_ml numeric not null check (price_per_ml > 0),
  min_ml numeric not null default 2 check (min_ml >= 1),
  bottle_price numeric,                  -- пусто: целым флаконом не продаётся
  bottle_volume numeric check (bottle_volume > 0),
  ml_left numeric check (ml_left >= 0),  -- пусто: остаток не ведётся
  hidden boolean not null default false, -- скрыть с витрины, не удаляя
  created_at timestamptz default now()
);

-- ---------- администраторы ----------
-- Покупатели тоже входят в систему (по телефону), поэтому права админа даёт только эта таблица.
create table if not exists admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table admins enable row level security;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- ---------- заказы ----------
-- items: [{perfume_id, name, ml, full_bottle, price}] — снимок корзины на момент заказа
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  phone text not null,
  items jsonb not null,
  total numeric not null,
  status text not null default 'new' check (status in ('new', 'ready', 'done', 'cancelled')),
  created_at timestamptz default now()
);
create index if not exists orders_user_idx on orders(user_id, created_at desc);

-- ---------- правила доступа ----------
alter table perfumes enable row level security;
alter table orders enable row level security;

drop policy if exists "public read" on perfumes;
drop policy if exists "admin all" on perfumes;
drop policy if exists "admin read orders" on orders;
drop policy if exists "own orders" on orders;
drop policy if exists "admin orders" on orders;
drop policy if exists "admin update orders" on orders;

create policy "public read" on perfumes for select using (not hidden or is_admin());
create policy "admin all" on perfumes for all using (is_admin()) with check (is_admin());
create policy "own orders" on orders for select using (user_id = auth.uid() or is_admin());
create policy "admin update orders" on orders for update using (is_admin()) with check (is_admin());

-- ---------- оформление заказа ----------
-- p_items: [{"perfume_id": "...", "ml": 5, "full_bottle": false}, ...]
-- Возвращает {"ok": true, "number": 12} или {"ok": false, "error": "..."}.
drop function if exists place_order(uuid, text, text, numeric, boolean);
create or replace function place_order(p_items jsonb, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ph text := coalesce(auth.jwt() ->> 'phone', '');
  it jsonb; p perfumes; need numeric; full boolean; price numeric;
  lines jsonb := '[]'::jsonb; sum numeric := 0; num bigint;
begin
  if uid is null or ph = '' then return jsonb_build_object('ok', false, 'error', 'Войдите по номеру телефона'); end if;
  if coalesce(trim(p_name), '') = '' then return jsonb_build_object('ok', false, 'error', 'Укажите имя'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Корзина пуста');
  end if;
  if jsonb_array_length(p_items) > 30 then return jsonb_build_object('ok', false, 'error', 'Слишком много позиций'); end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into p from perfumes where id = (it ->> 'perfume_id')::uuid and not hidden for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'Один из ароматов больше недоступен'); end if;
    full := coalesce((it ->> 'full_bottle')::boolean, false);
    if full and (p.bottle_price is null or p.bottle_volume is null) then
      return jsonb_build_object('ok', false, 'error', p.house || ' ' || p.name || ' продаётся только на распив');
    end if;
    need := case when full then p.bottle_volume else floor((it ->> 'ml')::numeric) end;
    if not full and (need is null or need < p.min_ml) then
      return jsonb_build_object('ok', false, 'error', p.house || ' ' || p.name || ': минимум ' || p.min_ml || ' мл');
    end if;
    if p.ml_left is not null and need > p.ml_left then
      return jsonb_build_object('ok', false, 'error', p.house || ' ' || p.name || ': в наличии ' || p.ml_left || ' мл');
    end if;
    price := case when full then p.bottle_price else need * p.price_per_ml end;
    if p.ml_left is not null then update perfumes set ml_left = ml_left - need where id = p.id; end if;
    lines := lines || jsonb_build_object('perfume_id', p.id, 'name', coalesce(p.house || ' ', '') || p.name,
                                         'ml', need, 'full_bottle', full, 'price', price);
    sum := sum + price;
  end loop;

  insert into orders(user_id, customer_name, phone, items, total)
  values (uid, left(trim(p_name), 100), '+' || ltrim(ph, '+'), lines, sum)
  returning number into num;
  return jsonb_build_object('ok', true, 'number', num);
end $$;
revoke all on function place_order(jsonb, text) from public, anon;
grant execute on function place_order(jsonb, text) to authenticated;

-- ---------- фото ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict (id) do nothing;
drop policy if exists "public photos" on storage.objects;
drop policy if exists "admin upload" on storage.objects;
create policy "public photos" on storage.objects for select using (bucket_id = 'photos');
create policy "admin upload" on storage.objects for insert with check (bucket_id = 'photos' and is_admin());

-- ---------- после первого запуска ----------
-- Создай себе пользователя (Authentication → Users → Add user, почта и пароль) и сделай его админом:
--   insert into admins select id from auth.users where email = 'твоя@почта.ru';
