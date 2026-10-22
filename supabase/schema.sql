-- Выполни целиком в Supabase: SQL Editor → New query → Run.

create table if not exists perfumes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  house text,
  description text,
  photo_url text,
  color text default '#6E3F84',
  price_per_ml numeric not null check (price_per_ml > 0),
  bottle_price numeric,
  bottle_volume numeric not null check (bottle_volume > 0),
  ml_left numeric not null check (ml_left >= 0),
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

-- Доступ: каталог читают все, менять может только вошедший администратор.
alter table perfumes enable row level security;
alter table orders enable row level security;

drop policy if exists "public read" on perfumes;
drop policy if exists "admin all" on perfumes;
drop policy if exists "admin read orders" on orders;
create policy "public read" on perfumes for select using (true);
create policy "admin all" on perfumes for all to authenticated using (true) with check (true);
create policy "admin read orders" on orders for select to authenticated using (true);

-- Заказ: проверяет остаток, списывает миллилитры и записывает заявку одной операцией.
create or replace function place_order(p_perfume uuid, p_name text, p_phone text, p_ml numeric, p_full boolean)
returns text language plpgsql security definer set search_path = public as $$
declare p perfumes; need numeric; cost numeric;
begin
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_phone), '') = '' then return 'Заполните имя и телефон'; end if;
  select * into p from perfumes where id = p_perfume for update;
  if not found then return 'Товар не найден'; end if;
  if p_full and p.bottle_price is null then return 'Этот аромат продаётся только на распив'; end if;
  need := case when p_full then p.bottle_volume else floor(p_ml) end;
  if need is null or need <= 0 then return 'Укажите объём'; end if;
  if need > p.ml_left then return 'Недостаточно в наличии'; end if;
  cost := case when p_full then p.bottle_price else need * p.price_per_ml end;
  update perfumes set ml_left = ml_left - need where id = p_perfume;
  insert into orders(perfume_id, perfume_name, customer_name, phone, ml, full_bottle, total)
  values (p_perfume, p.name, left(p_name, 100), left(p_phone, 30), need, p_full, cost);
  return 'ok';
end $$;

-- Хранилище фото: смотреть могут все, загружать только администратор.
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict (id) do nothing;
drop policy if exists "public photos" on storage.objects;
drop policy if exists "admin upload" on storage.objects;
create policy "public photos" on storage.objects for select using (bucket_id = 'photos');
create policy "admin upload" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
