-- Выполни целиком в Supabase: SQL Editor → New query → Run. Потом выполни seed.sql, чтобы загрузить прайс.

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

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  perfume_id uuid references perfumes(id) on delete set null,
  perfume_name text,
  customer_name text not null,
  phone text not null,
  ml numeric not null,
  full_bottle boolean default false,
  total numeric,
  created_at timestamptz default now()
);

alter table perfumes enable row level security;
alter table orders enable row level security;

drop policy if exists "public read" on perfumes;
drop policy if exists "admin all" on perfumes;
drop policy if exists "admin read orders" on orders;
create policy "public read" on perfumes for select using (not hidden or auth.role() = 'authenticated');
create policy "admin all" on perfumes for all to authenticated using (true) with check (true);
create policy "admin read orders" on orders for select to authenticated using (true);

-- Заказ: проверяет минимум и остаток, списывает миллилитры и записывает заявку одной операцией.
create or replace function place_order(p_perfume uuid, p_name text, p_phone text, p_ml numeric, p_full boolean)
returns text language plpgsql security definer set search_path = public as $$
declare p perfumes; need numeric; cost numeric;
begin
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_phone), '') = '' then return 'Заполните имя и телефон'; end if;
  select * into p from perfumes where id = p_perfume and not hidden for update;
  if not found then return 'Аромат не найден'; end if;
  if p_full and (p.bottle_price is null or p.bottle_volume is null) then return 'Этот аромат продаётся только на распив'; end if;
  need := case when p_full then p.bottle_volume else floor(p_ml) end;
  if need is null or (not p_full and need < p.min_ml) then return 'Минимальный объём ' || p.min_ml || ' мл'; end if;
  if p.ml_left is not null and need > p.ml_left then return 'В наличии только ' || p.ml_left || ' мл'; end if;
  cost := case when p_full then p.bottle_price else need * p.price_per_ml end;
  if p.ml_left is not null then
    update perfumes set ml_left = ml_left - need where id = p_perfume;
  end if;
  insert into orders(perfume_id, perfume_name, customer_name, phone, ml, full_bottle, total)
  values (p_perfume, coalesce(p.house || ' ', '') || p.name, left(p_name, 100), left(p_phone, 30), need, p_full, cost);
  return 'ok';
end $$;

insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict (id) do nothing;
drop policy if exists "public photos" on storage.objects;
drop policy if exists "admin upload" on storage.objects;
create policy "public photos" on storage.objects for select using (bucket_id = 'photos');
create policy "admin upload" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
