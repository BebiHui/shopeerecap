-- ============================================================
-- ShopeeRekap — Schema v2: Harga Modal + Transaksi Shopee
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. MASTER_HARGA_MODAL
--    Key utama: sku_induk (bukan nama produk)
--    harga_modal = per item (qty akan dikalikan saat import)
-- ============================================================
create table if not exists public.master_harga_modal (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- KEY UTAMA matching — UNIK per user
  sku_induk       text not null,

  -- Info produk (hanya untuk tampilan)
  nama_produk     text not null,
  nama_variasi    text,

  -- Harga modal per item — snapshot ke transaksi saat import
  harga_modal     numeric(15,2) not null default 0 check (harga_modal >= 0),

  is_active       boolean not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),

  unique (user_id, sku_induk)
);

alter table public.master_harga_modal enable row level security;
create policy "hm_all" on public.master_harga_modal
  for all using (auth.uid() = user_id);

create index if not exists idx_hm_user        on public.master_harga_modal(user_id);
create index if not exists idx_hm_sku_induk   on public.master_harga_modal(user_id, sku_induk);
create index if not exists idx_hm_active      on public.master_harga_modal(user_id, is_active);

-- Trigger updated_at
create trigger trg_hm_updated
  before update on public.master_harga_modal
  for each row execute function public.set_updated_at();

-- Riwayat perubahan harga modal
create table if not exists public.harga_modal_history (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  sku_induk         text not null,
  harga_modal_lama  numeric(15,2) not null,
  harga_modal_baru  numeric(15,2) not null,
  changed_at        timestamptz default now()
);

alter table public.harga_modal_history enable row level security;
create policy "hmh_all" on public.harga_modal_history
  for all using (auth.uid() = user_id);
create index if not exists idx_hmh_user on public.harga_modal_history(user_id, sku_induk);

-- Trigger catat history perubahan harga modal
create or replace function public.log_harga_modal_change()
returns trigger language plpgsql security definer as $$
begin
  if old.harga_modal is distinct from new.harga_modal then
    insert into public.harga_modal_history(user_id, sku_induk, harga_modal_lama, harga_modal_baru)
    values (new.user_id, new.sku_induk, old.harga_modal, new.harga_modal);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hm_history on public.master_harga_modal;
create trigger trg_hm_history
  after update on public.master_harga_modal
  for each row execute function public.log_harga_modal_change();

-- ============================================================
-- 2. SHOPEE_TRANSACTIONS — tabel transaksi Shopee
--    Terpisah dari tabel 'transactions' lama agar tidak konflik
--    Formula profit sesuai aturan bisnis user
-- ============================================================
create table if not exists public.shopee_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  import_id       uuid,   -- referensi ke tabel imports

  -- Identifikasi transaksi
  order_id        text not null,
  tanggal         date not null,
  completed_at    timestamptz,

  -- Produk
  sku_induk       text,           -- key matching ke master_harga_modal
  nama_produk     text,
  nama_variasi    text,
  qty             integer not null default 1 check (qty > 0),

  -- Revenue: total_harga_produk dari Shopee = sudah final, sudah x qty
  total_harga_produk  numeric(15,2) not null default 0,

  -- Komponen biaya Shopee (masing-masing dari kolom export Shopee)
  biaya_administrasi                        numeric(15,2) default 0,
  biaya_program_hemat_kirim                 numeric(15,2) default 0,
  biaya_layanan_promo_xtra_gratis_ongkir    numeric(15,2) default 0,
  biaya_proses_pesanan                      numeric(15,2) default 0,
  biaya_transaksi_spaylater                 numeric(15,2) default 0,
  biaya_affiliate                           numeric(15,2) default 0,

  -- Harga modal (snapshot dari master saat import — tidak berubah meski master berubah)
  harga_modal_per_item  numeric(15,2) default 0,
  harga_modal_total     numeric(15,2) generated always as (
    harga_modal_per_item * qty
  ) stored,

  -- Computed fields (stored untuk performa query)
  total_biaya_shopee  numeric(15,2) generated always as (
    coalesce(biaya_administrasi, 0)
    + coalesce(biaya_program_hemat_kirim, 0)
    + coalesce(biaya_layanan_promo_xtra_gratis_ongkir, 0)
    + coalesce(biaya_proses_pesanan, 0)
    + coalesce(biaya_transaksi_spaylater, 0)
    + coalesce(biaya_affiliate, 0)
  ) stored,

  -- FORMULA PROFIT UTAMA:
  -- profit = total_harga_produk - total_biaya_shopee - harga_modal_total
  profit  numeric(15,2) generated always as (
    total_harga_produk
    - (
        coalesce(biaya_administrasi, 0)
        + coalesce(biaya_program_hemat_kirim, 0)
        + coalesce(biaya_layanan_promo_xtra_gratis_ongkir, 0)
        + coalesce(biaya_proses_pesanan, 0)
        + coalesce(biaya_transaksi_spaylater, 0)
        + coalesce(biaya_affiliate, 0)
      )
    - (harga_modal_per_item * qty)
  ) stored,

  -- Status matching
  unmatched_modal boolean not null default false,

  -- Catatan
  catatan         text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),

  -- Cegah duplikat per order per produk per user
  unique (user_id, order_id, nama_produk)
);

alter table public.shopee_transactions enable row level security;
create policy "stx_all" on public.shopee_transactions
  for all using (auth.uid() = user_id);

create index if not exists idx_stx_user_date   on public.shopee_transactions(user_id, tanggal desc);
create index if not exists idx_stx_order       on public.shopee_transactions(user_id, order_id);
create index if not exists idx_stx_sku_induk   on public.shopee_transactions(user_id, sku_induk);
create index if not exists idx_stx_unmatched   on public.shopee_transactions(user_id, unmatched_modal);
create index if not exists idx_stx_created     on public.shopee_transactions(user_id, created_at desc);

-- Trigger updated_at
create trigger trg_stx_updated
  before update on public.shopee_transactions
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. UNMATCHED_MODAL_ITEMS — transaksi yg sku_induk tidak ketemu
-- ============================================================
create table if not exists public.unmatched_modal_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  import_id       uuid,
  shopee_trx_id   uuid references public.shopee_transactions(id) on delete cascade,

  raw_order_id    text,
  raw_sku_induk   text,
  nama_produk     text,
  nama_variasi    text,
  qty             integer default 1,
  total_harga_produk  numeric(15,2) default 0,

  -- Resolve manual
  resolved            boolean default false,
  resolved_sku_induk  text,
  resolved_at         timestamptz,

  created_at      timestamptz default now()
);

alter table public.unmatched_modal_items enable row level security;
create policy "umi_all" on public.unmatched_modal_items
  for all using (auth.uid() = user_id);
create index if not exists idx_umi_user     on public.unmatched_modal_items(user_id);
create index if not exists idx_umi_resolved on public.unmatched_modal_items(user_id, resolved);

-- ============================================================
-- 4. VIEWS — rekap & analisa
-- ============================================================

-- Rekap harian Shopee transactions
create or replace view public.shopee_daily_summary as
select
  user_id,
  tanggal,
  count(*)::int                       as total_transaksi,
  sum(qty)::int                       as total_qty,
  sum(total_harga_produk)             as total_omzet,
  sum(harga_modal_total)              as total_modal_keluar,
  sum(total_biaya_shopee)             as total_biaya_shopee,
  sum(biaya_administrasi)             as total_biaya_administrasi,
  sum(biaya_program_hemat_kirim)      as total_biaya_hemat_kirim,
  sum(biaya_layanan_promo_xtra_gratis_ongkir) as total_biaya_xtra,
  sum(biaya_proses_pesanan)           as total_biaya_proses,
  sum(biaya_transaksi_spaylater)      as total_biaya_spaylater,
  sum(biaya_affiliate)                as total_biaya_affiliate,
  sum(profit)                         as total_profit,
  count(*) filter (where unmatched_modal)::int as total_unmatched,
  round(
    100.0 * count(*) filter (where not unmatched_modal) / nullif(count(*), 0),
    1
  )                                   as match_rate_pct
from public.shopee_transactions
group by user_id, tanggal
order by tanggal desc;

grant select on public.shopee_daily_summary to authenticated;

-- Rekap per SKU Induk
create or replace view public.shopee_sku_summary as
select
  t.user_id,
  t.sku_induk,
  t.nama_produk,
  m.harga_modal                       as harga_modal_master,
  sum(t.qty)::int                     as total_qty,
  sum(t.total_harga_produk)           as total_omzet,
  sum(t.harga_modal_total)            as total_modal_keluar,
  sum(t.total_biaya_shopee)           as total_biaya_shopee,
  sum(t.profit)                       as total_profit,
  count(*)::int                       as total_transaksi,
  max(t.tanggal)                      as last_sold_date,
  count(*) filter (where t.unmatched_modal)::int as trx_unmatched
from public.shopee_transactions t
left join public.master_harga_modal m
  on m.user_id = t.user_id and m.sku_induk = t.sku_induk
group by t.user_id, t.sku_induk, t.nama_produk, m.harga_modal
order by total_profit desc;

grant select on public.shopee_sku_summary to authenticated;

-- Rekap mingguan
create or replace view public.shopee_weekly_summary as
select
  user_id,
  date_trunc('week', tanggal)::date   as minggu_mulai,
  count(*)::int                       as total_transaksi,
  sum(qty)::int                       as total_qty,
  sum(total_harga_produk)             as total_omzet,
  sum(harga_modal_total)              as total_modal_keluar,
  sum(total_biaya_shopee)             as total_biaya_shopee,
  sum(profit)                         as total_profit,
  count(*) filter (where unmatched_modal)::int as total_unmatched
from public.shopee_transactions
group by user_id, date_trunc('week', tanggal)
order by minggu_mulai desc;

grant select on public.shopee_weekly_summary to authenticated;

-- Rekap bulanan
create or replace view public.shopee_monthly_summary as
select
  user_id,
  date_trunc('month', tanggal)::date  as bulan,
  to_char(tanggal, 'Mon YYYY')        as label_bulan,
  count(*)::int                       as total_transaksi,
  sum(qty)::int                       as total_qty,
  sum(total_harga_produk)             as total_omzet,
  sum(harga_modal_total)              as total_modal_keluar,
  sum(total_biaya_shopee)             as total_biaya_shopee,
  sum(profit)                         as total_profit,
  count(*) filter (where unmatched_modal)::int as total_unmatched
from public.shopee_transactions
group by user_id, date_trunc('month', tanggal), to_char(tanggal, 'Mon YYYY')
order by bulan desc;

grant select on public.shopee_monthly_summary to authenticated;

-- ============================================================
-- SEED: Contoh master_harga_modal (ganti USER_ID_HERE)
-- ============================================================
/*
insert into public.master_harga_modal (user_id, sku_induk, nama_produk, nama_variasi, harga_modal)
values
  ('USER_ID_HERE', 'SKU-IND-KRD-VR125',  'Kampas Rem Depan Vario 125', 'Standar',  25000),
  ('USER_ID_HERE', 'SKU-IND-OLI-YML10W', 'Oli Yamalube 10W-40 1L',    '1 Liter',  38000),
  ('USER_ID_HERE', 'SKU-IND-FUA-BEAT',   'Filter Udara Beat FI',       'Original', 32000),
  ('USER_ID_HERE', 'SKU-IND-BSI-NGK',    'Busi NGK CPR8EA-9',          'Standard', 18000),
  ('USER_ID_HERE', 'SKU-IND-BAN-IRC-89', 'Ban IRC Tubeless 80/90-14',  '80/90-14', 185000)
on conflict (user_id, sku_induk) do nothing;
*/
