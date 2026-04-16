-- ============================================================
-- ShopeeRekap v2 — Database Schema for Supabase (PostgreSQL)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. PROFILES (extended user data)
-- ============================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  store_name    text not null default 'Toko Saya',
  owner_name    text,
  phone         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "profiles_select" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- ============================================================
-- 2. PRODUCTS (master produk & harga modal default)
-- ============================================================
create table if not exists public.products (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  sku             text,
  default_price   numeric(15,2) not null default 0,
  default_modal   numeric(15,2) not null default 0,
  category        text,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.products enable row level security;
create policy "products_all" on public.products for all using (auth.uid() = user_id);
create index if not exists idx_products_user on public.products(user_id);
create index if not exists idx_products_name on public.products(user_id, name);

-- ============================================================
-- 3. TRANSACTIONS (inti: data penjualan)
-- ============================================================
create table if not exists public.transactions (
  id                    uuid primary key default uuid_generate_v4(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  tanggal               date not null,
  order_id              text not null,
  nama_pembeli          text,
  nama_produk           text not null,
  sku                   text,
  variasi               text,

  -- Qty & harga
  qty                   integer not null default 1 check (qty > 0),
  harga_jual            numeric(15,2) not null default 0 check (harga_jual >= 0),
  harga_modal           numeric(15,2) not null default 0 check (harga_modal >= 0),

  -- Kalkulasi otomatis (generated columns)
  total_kotor           numeric(15,2) generated always as (qty * harga_jual) stored,
  total_modal           numeric(15,2) generated always as (qty * harga_modal) stored,

  -- Diskon & voucher
  diskon_produk         numeric(15,2) not null default 0,
  voucher_shopee        numeric(15,2) not null default 0,

  -- Komponen biaya Shopee
  biaya_admin           numeric(15,2) not null default 0,
  biaya_layanan         numeric(15,2) not null default 0,
  biaya_program         numeric(15,2) not null default 0,   -- XTRA, cashback, gratis ongkir, dll
  biaya_affiliate       numeric(15,2) not null default 0,
  ongkir_seller         numeric(15,2) not null default 0,

  -- Biaya iklan per transaksi
  biaya_iklan           numeric(15,2) not null default 0,

  -- Override total diterima (dari laporan resmi Shopee)
  total_diterima_manual numeric(15,2),

  catatan               text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),

  -- Cegah duplikat: 1 order + 1 produk = 1 baris per user
  unique (user_id, order_id, nama_produk)
);

alter table public.transactions enable row level security;
create policy "transactions_all" on public.transactions for all using (auth.uid() = user_id);
create index if not exists idx_trx_user_date   on public.transactions(user_id, tanggal desc);
create index if not exists idx_trx_order       on public.transactions(user_id, order_id);
create index if not exists idx_trx_produk      on public.transactions(user_id, nama_produk);
create index if not exists idx_trx_created     on public.transactions(user_id, created_at desc);

-- ============================================================
-- 4. DAILY_ADS (biaya iklan harian — terpisah dari transaksi)
-- ============================================================
create table if not exists public.daily_ads (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tanggal     date not null,
  total       numeric(15,2) not null default 0 check (total >= 0),
  keterangan  text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id, tanggal)
);

alter table public.daily_ads enable row level security;
create policy "daily_ads_all" on public.daily_ads for all using (auth.uid() = user_id);
create index if not exists idx_ads_user_date on public.daily_ads(user_id, tanggal desc);

-- ============================================================
-- 5. IMPORTS (log riwayat import file)
-- ============================================================
create table if not exists public.imports (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  filename        text not null,
  total_rows      integer default 0,
  success_rows    integer default 0,
  skipped_rows    integer default 0,
  error_rows      integer default 0,
  status          text not null default 'pending' check (status in ('pending','done','error')),
  error_log       jsonb,
  created_at      timestamptz default now()
);

alter table public.imports enable row level security;
create policy "imports_all" on public.imports for all using (auth.uid() = user_id);

-- ============================================================
-- 6. VIEW: daily_summary
--    Kalkulasi rekap harian yang dipakai dashboard & rekap harian
--
-- RUMUS PROFIT:
--   total_potongan_shopee = admin + layanan + program + affiliate + ongkir + voucher
--   total_diterima        = total_kotor - diskon_produk - total_potongan_shopee
--                           (atau total_diterima_manual jika diisi)
--   profit_per_trx        = total_diterima - total_modal - biaya_iklan_trx
--   profit_harian         = sum(profit_per_trx) - biaya_iklan_harian
-- ============================================================
create or replace view public.daily_summary as
select
  t.user_id,
  t.tanggal,

  -- Volume
  count(*)::int                                               as total_transaksi,
  sum(t.qty)::int                                             as total_item,

  -- Revenue & cost
  sum(t.total_kotor)                                          as total_omzet,
  sum(t.total_modal)                                          as total_modal,

  -- Komponen potongan Shopee
  sum(t.biaya_admin)                                          as total_admin,
  sum(t.biaya_layanan)                                        as total_layanan,
  sum(t.biaya_program)                                        as total_program,
  sum(t.biaya_affiliate)                                      as total_affiliate,
  sum(t.ongkir_seller)                                        as total_ongkir,
  sum(t.voucher_shopee)                                       as total_voucher,

  -- Total potongan shopee = semua komponen
  sum(t.biaya_admin + t.biaya_layanan + t.biaya_program
    + t.biaya_affiliate + t.ongkir_seller + t.voucher_shopee) as total_potongan_shopee,

  -- Iklan
  sum(t.biaya_iklan)                                          as total_iklan_trx,
  coalesce(da.total, 0)                                       as total_iklan_harian,
  sum(t.biaya_iklan) + coalesce(da.total, 0)                  as total_iklan,

  -- Profit bersih harian:
  --   = sum( diterima_per_trx - modal_per_trx - iklan_per_trx ) - iklan_harian
  --   diterima_per_trx = manual override OR (kotor - diskon - potongan_shopee)
  sum(
    coalesce(
      nullif(t.total_diterima_manual, 0),
      t.total_kotor
        - t.diskon_produk
        - (t.biaya_admin + t.biaya_layanan + t.biaya_program
           + t.biaya_affiliate + t.ongkir_seller + t.voucher_shopee)
    )
    - t.total_modal
    - t.biaya_iklan
  ) - coalesce(da.total, 0)                                   as profit_bersih

from public.transactions t
left join public.daily_ads da
  on da.user_id = t.user_id and da.tanggal = t.tanggal
group by t.user_id, t.tanggal, da.total
order by t.tanggal desc;

-- Grant access to authenticated users
grant select on public.daily_summary to authenticated;

-- ============================================================
-- 7. VIEW: product_summary
-- ============================================================
create or replace view public.product_summary as
select
  user_id,
  nama_produk,
  sku,
  sum(qty)::int                          as total_qty,
  sum(total_kotor)                       as total_omzet,
  sum(total_modal)                       as total_modal,
  sum(
    coalesce(
      nullif(total_diterima_manual, 0),
      total_kotor
        - diskon_produk
        - (biaya_admin + biaya_layanan + biaya_program
           + biaya_affiliate + ongkir_seller + voucher_shopee)
    )
    - total_modal
    - biaya_iklan
  )                                      as total_profit,
  max(tanggal)                           as last_sold_date,
  count(*)::int                          as total_transaksi
from public.transactions
group by user_id, nama_produk, sku
order by total_profit desc;

grant select on public.product_summary to authenticated;

-- ============================================================
-- 8. TRIGGERS: auto-update updated_at
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated     before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger trg_transactions_updated before update on public.transactions
  for each row execute function public.set_updated_at();
create trigger trg_products_updated     before update on public.products
  for each row execute function public.set_updated_at();
create trigger trg_daily_ads_updated    before update on public.daily_ads
  for each row execute function public.set_updated_at();

-- ============================================================
-- 9. TRIGGER: auto-create profile on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, store_name, owner_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'Toko Saya'),
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_new_user on auth.users;
create trigger trg_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();
