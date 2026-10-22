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
-- поля, добавленные позже (скрипт можно запускать на уже созданной базе)
alter table perfumes add column if not exists is_new boolean not null default false; -- метка «Новинка»
alter table perfumes add column if not exists tags text[] not null default '{}';    -- ноты и тип: древесный, цветочный, унисекс…
-- старые пометки «новинка 2026» в описании превращаем в флаг
update perfumes set is_new = true,
  description = nullif(trim(regexp_replace(description, 'новинка\s*\d*', '', 'i')), '')
where description ~* 'новинка';

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
alter table orders add column if not exists pickup text check (pickup in ('Н', 'П')); -- где забрать
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
-- p_items: [{"perfume_id": "...", "ml": 5, "full_bottle": false}, ...], p_pickup: 'Н' или 'П'
-- Возвращает {"ok": true, "number": 12} или {"ok": false, "error": "..."}.
drop function if exists place_order(uuid, text, text, numeric, boolean);
drop function if exists place_order(jsonb, text);
create or replace function place_order(p_items jsonb, p_name text, p_pickup text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ph text := coalesce(auth.jwt() ->> 'phone', '');
  it jsonb; p perfumes; need numeric; is_full boolean; price numeric;
  lines jsonb := '[]'::jsonb; total_sum numeric := 0; num bigint;
begin
  if uid is null or ph = '' then return jsonb_build_object('ok', false, 'error', 'Войдите по номеру телефона'); end if;
  if coalesce(trim(p_name), '') = '' then return jsonb_build_object('ok', false, 'error', 'Укажите имя'); end if;
  if p_pickup is not null and p_pickup not in ('Н', 'П') then return jsonb_build_object('ok', false, 'error', 'Выберите, где забрать заказ'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Корзина пуста');
  end if;
  if jsonb_array_length(p_items) > 30 then return jsonb_build_object('ok', false, 'error', 'Слишком много позиций'); end if;
  -- защита от накруток: не больше 3 заказов за 10 минут и 5 необработанных заказов на один номер
  if (select count(*) from orders where user_id = uid and created_at > now() - interval '10 minutes') >= 3 then
    return jsonb_build_object('ok', false, 'error', 'Слишком много заказов подряд. Попробуйте через несколько минут');
  end if;
  if (select count(*) from orders where user_id = uid and status = 'new') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'У вас уже 5 заказов в обработке. Дождитесь звонка или отмените лишние');
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into p from perfumes where id = (it ->> 'perfume_id')::uuid and not hidden for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'Один из ароматов больше недоступен'); end if;
    is_full := coalesce((it ->> 'full_bottle')::boolean, false);
    if is_full and (p.bottle_price is null or p.bottle_volume is null) then
      return jsonb_build_object('ok', false, 'error', p.house || ' ' || p.name || ' продаётся только на распив');
    end if;
    need := case when is_full then p.bottle_volume else floor((it ->> 'ml')::numeric) end;
    if not is_full and (need is null or need < p.min_ml) then
      return jsonb_build_object('ok', false, 'error', p.house || ' ' || p.name || ': минимум ' || p.min_ml || ' мл');
    end if;
    if not is_full and need > 100 then
      return jsonb_build_object('ok', false, 'error', p.house || ' ' || p.name || ': на распив не больше 100 мл');
    end if;
    if p.ml_left is not null and need > p.ml_left then
      return jsonb_build_object('ok', false, 'error', p.house || ' ' || p.name || ': в наличии ' || p.ml_left || ' мл');
    end if;
    price := case when is_full then p.bottle_price else need * p.price_per_ml end;
    if p.ml_left is not null then update perfumes set ml_left = ml_left - need where id = p.id; end if;
    lines := lines || jsonb_build_object('perfume_id', p.id, 'name', coalesce(p.house || ' ', '') || p.name,
                                         'ml', need, 'full_bottle', is_full, 'price', price);
    total_sum := total_sum + price;
  end loop;

  insert into orders(user_id, customer_name, phone, items, total, pickup)
  values (uid, left(trim(p_name), 100), '+' || ltrim(ph, '+'), lines, total_sum, p_pickup)
  returning number into num;
  return jsonb_build_object('ok', true, 'number', num);
end $$;
revoke all on function place_order(jsonb, text, text) from public, anon;
grant execute on function place_order(jsonb, text, text) to authenticated;

-- ---------- отмена заказа ----------
-- При переводе заказа в «Отменён» миллилитры возвращаются в остаток. Отменённый заказ вернуть нельзя:
-- остаток мог уже уйти другим покупателям, проще оформить заказ заново.
create or replace function orders_status_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  if new.status = old.status then return new; end if;
  if old.status = 'cancelled' then raise exception 'Отменённый заказ нельзя вернуть, оформите новый'; end if;
  if new.status = 'cancelled' then
    for it in select * from jsonb_array_elements(old.items) loop
      update perfumes set ml_left = ml_left + (it ->> 'ml')::numeric
      where id = (it ->> 'perfume_id')::uuid and ml_left is not null;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists orders_status_guard on orders;
create trigger orders_status_guard before update of status on orders
  for each row execute function orders_status_guard();

-- покупатель может сам отменить заказ, пока его не собрали
create or replace function cancel_my_order(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update orders set status = 'cancelled' where id = p_id and user_id = auth.uid() and status = 'new';
  if not found then return jsonb_build_object('ok', false, 'error', 'Этот заказ уже нельзя отменить, позвоните нам'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function cancel_my_order(uuid) from public, anon;
grant execute on function cancel_my_order(uuid) to authenticated;

-- ---------- фото ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict (id) do nothing;
drop policy if exists "public photos" on storage.objects;
drop policy if exists "admin upload" on storage.objects;
drop policy if exists "admin delete photos" on storage.objects;
create policy "public photos" on storage.objects for select using (bucket_id = 'photos');
create policy "admin upload" on storage.objects for insert with check (bucket_id = 'photos' and is_admin());
-- админ может удалять старые фото, когда загружает новое
create policy "admin delete photos" on storage.objects for delete using (bucket_id = 'photos' and is_admin());

-- ---------- после первого запуска ----------
-- Создай себе пользователя (Authentication → Users → Add user, почта и пароль) и сделай его админом:
--   insert into admins select id from auth.users where email = 'твоя@почта.ru';
