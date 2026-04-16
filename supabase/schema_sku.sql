-- ============================================================
-- ShopeeRekap — Schema Tambahan: Master SKU & Harga Modal
-- Jalankan SETELAH schema.sql di SQL Editor Supabase
-- ============================================================

-- ============================================================
-- A. MASTER_SKU — harga modal berbasis SKU
-- ============================================================
create table if not exists public.master_sku (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- Identifier utama — UNIK per user
  sku             text not null,
  sku_induk       text,                          -- SKU parent (bundle/variasi)

  -- Info produk
  nama_produk     text not null,
  nama_variasi    text,                          -- misal: Merah-XL, 1L, dll

  -- Harga modal (snapshot disimpan ke transaksi saat import)
  harga_modal     numeric(15,2) not null default 0 check (harga_modal >= 0),

  -- Metadata
  kategori        text,
  supplier        text,
  catatan         text,
  is_active       boolean not null default true,

  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),

  -- Satu SKU unik per user
  unique (user_id, sku)
);

alter table public.master_sku enable row level security;
create policy "master_sku_all" on public.master_sku
  for all using (auth.uid() = user_id);

create index if not exists idx_msku_user       on public.master_sku(user_id);
create index if not exists idx_msku_sku        on public.master_sku(user_id, sku);
create index if not exists idx_msku_sku_induk  on public.master_sku(user_id, sku_induk);
create index if not exists idx_msku_active     on public.master_sku(user_id, is_active);

-- ============================================================
-- B. SKU_COST_HISTORY — riwayat perubahan harga modal
-- ============================================================
create table if not exists public.sku_cost_history (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  sku             text not null,
  harga_modal_lama numeric(15,2) not null,
  harga_modal_baru numeric(15,2) not null,
  changed_at      timestamptz default now(),
  changed_by      uuid references auth.users(id)
);

alter table public.sku_cost_history enable row level security;
create policy "sku_cost_history_all" on public.sku_cost_history
  for all using (auth.uid() = user_id);
create index if not exists idx_cost_hist_sku on public.sku_cost_history(user_id, sku);

-- Trigger: catat riwayat saat harga_modal berubah
create or replace function public.log_sku_cost_change()
returns trigger language plpgsql security definer as $$
begin
  if old.harga_modal is distinct from new.harga_modal then
    insert into public.sku_cost_history
      (user_id, sku, harga_modal_lama, harga_modal_baru, changed_by)
    values
      (new.user_id, new.sku, old.harga_modal, new.harga_modal, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sku_cost_history on public.master_sku;
create trigger trg_sku_cost_history
  after update on public.master_sku
  for each row execute function public.log_sku_cost_change();

-- Trigger: updated_at
create trigger trg_master_sku_updated
  before update on public.master_sku
  for each row execute function public.set_updated_at();

-- ============================================================
-- C. UNMATCHED_IMPORT_ITEMS — transaksi import yg SKU-nya tdk ditemukan
-- ============================================================
create table if not exists public.unmatched_import_items (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  import_id       uuid references public.imports(id) on delete cascade,

  -- Data dari file Shopee
  raw_order_id    text,
  raw_sku         text,              -- SKU yang ditemukan di file (mungkin kosong/salah)
  raw_sku_induk   text,
  nama_produk     text,
  nama_variasi    text,
  qty             integer default 0,
  total_payment   numeric(15,2) default 0,

  -- Status resolusi
  resolved        boolean default false,
  resolved_sku    text,              -- SKU master yang dipakai setelah di-resolve manual
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id),

  created_at      timestamptz default now()
);

alter table public.unmatched_import_items enable row level security;
create policy "unmatched_all" on public.unmatched_import_items
  for all using (auth.uid() = user_id);
create index if not exists idx_unmatched_user   on public.unmatched_import_items(user_id);
create index if not exists idx_unmatched_import on public.unmatched_import_items(import_id);
create index if not exists idx_unmatched_resolved on public.unmatched_import_items(user_id, resolved);

-- ============================================================
-- D. ALTER TABLE TRANSACTIONS — tambah kolom baru
--    (idempotent: pakai IF NOT EXISTS via DO block)
-- ============================================================
do $$
begin
  -- SKU induk (parent SKU / bundle)
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='sku_induk') then
    alter table public.transactions add column sku_induk text;
  end if;

  -- Flag unmatched SKU
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='unmatched_sku') then
    alter table public.transactions add column unmatched_sku boolean not null default false;
  end if;

  -- Snapshot harga modal saat import (tidak berubah meski master diupdate)
  -- NOTE: harga_modal sudah ada di skema lama, ini hanya konfirmasi
  -- Tambah tanggal_transaksi alias (opsional — tetap pakai 'tanggal')

  -- seller_burden_total = total potongan Shopee yang jadi beban seller
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='seller_burden_total') then
    alter table public.transactions add column seller_burden_total numeric(15,2) generated always as (
      biaya_admin + biaya_layanan + biaya_program + biaya_affiliate + ongkir_seller + voucher_shopee
    ) stored;
  end if;

  -- total_payment = uang yang diterima seller (diterima_manual atau hitung otomatis)
  -- Ini adalah alias computed — disimpan sebagai stored generated column
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='total_payment') then
    alter table public.transactions add column total_payment numeric(15,2);
  end if;

  -- total_operational_cost = seller_burden_total + biaya_iklan
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='total_operational_cost') then
    alter table public.transactions add column total_operational_cost numeric(15,2);
  end if;

  -- profit_before_ads = total_payment - total_modal - seller_burden_total
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='profit_before_ads') then
    alter table public.transactions add column profit_before_ads numeric(15,2);
  end if;

  -- profit_net = total_payment - total_modal - total_operational_cost
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='profit_net') then
    alter table public.transactions add column profit_net numeric(15,2);
  end if;

end $$;

-- Index baru untuk SKU
create index if not exists idx_trx_sku          on public.transactions(user_id, sku);
create index if not exists idx_trx_unmatched    on public.transactions(user_id, unmatched_sku);

-- ============================================================
-- E. VIEW: sku_modal_summary — rekap harga modal per SKU
-- ============================================================
create or replace view public.sku_modal_summary as
select
  t.user_id,
  t.sku,
  t.sku_induk,
  t.nama_produk,
  ms.nama_variasi,
  ms.kategori,
  ms.supplier,
  ms.harga_modal                       as modal_master_saat_ini,
  sum(t.qty)::int                      as total_qty,
  sum(t.total_modal)                   as total_modal_keluar,
  sum(t.total_kotor)                   as total_omzet,
  sum(
    coalesce(nullif(t.total_diterima_manual,0),
      t.total_kotor - t.diskon_produk
      - (t.biaya_admin+t.biaya_layanan+t.biaya_program
         +t.biaya_affiliate+t.ongkir_seller+t.voucher_shopee)
    ) - t.total_modal - t.biaya_iklan
  )                                    as total_profit,
  count(*)::int                        as total_transaksi,
  max(t.tanggal)                       as last_sold_date,
  count(*) filter (where t.unmatched_sku)::int as trx_unmatched
from public.transactions t
left join public.master_sku ms
  on ms.user_id = t.user_id and ms.sku = t.sku
where t.sku is not null
group by t.user_id, t.sku, t.sku_induk, t.nama_produk,
         ms.nama_variasi, ms.kategori, ms.supplier, ms.harga_modal
order by total_modal_keluar desc;

grant select on public.sku_modal_summary to authenticated;

-- ============================================================
-- F. FUNCTION: match_and_apply_sku_modal
--    Dipanggil dari API saat import Shopee
--    Mencocokkan SKU → master_sku → isi harga_modal
-- ============================================================
create or replace function public.match_sku_modal(
  p_user_id uuid,
  p_sku      text,
  p_sku_induk text default null
)
returns table (
  found        boolean,
  harga_modal  numeric,
  nama_produk  text,
  nama_variasi text,
  kategori     text
)
language sql stable security definer as $$
  select
    true,
    ms.harga_modal,
    ms.nama_produk,
    ms.nama_variasi,
    ms.kategori
  from public.master_sku ms
  where ms.user_id = p_user_id
    and ms.is_active = true
    and (
      -- Prioritas 1: cocok exact SKU
      ms.sku = p_sku
      or
      -- Prioritas 2: cocok SKU induk jika SKU kosong
      (p_sku is null or p_sku = '') and ms.sku = p_sku_induk
    )
  order by
    case when ms.sku = p_sku then 0 else 1 end
  limit 1;
$$;

-- ============================================================
-- G. HELPER VIEWS: rekap modal keluar per periode
-- ============================================================

-- Modal keluar harian (bergabung dengan daily_summary yang sudah ada)
create or replace view public.modal_harian as
select
  user_id,
  tanggal,
  sum(total_modal)              as total_modal_keluar,
  sum(qty)::int                 as total_qty,
  count(*)::int                 as total_trx,
  count(*) filter (where unmatched_sku)::int as trx_unmatched,
  round(
    100.0 * count(*) filter (where not unmatched_sku) / nullif(count(*),0),
    1
  )                             as match_rate_pct
from public.transactions
group by user_id, tanggal
order by tanggal desc;

grant select on public.modal_harian to authenticated;

-- Modal keluar per kategori SKU
create or replace view public.modal_per_kategori as
select
  t.user_id,
  coalesce(ms.kategori, 'Tidak Terkategori') as kategori,
  sum(t.total_modal)           as total_modal_keluar,
  sum(t.qty)::int              as total_qty,
  count(distinct t.sku)::int   as jumlah_sku,
  count(*)::int                as total_transaksi
from public.transactions t
left join public.master_sku ms
  on ms.user_id = t.user_id and ms.sku = t.sku
group by t.user_id, ms.kategori
order by total_modal_keluar desc;

grant select on public.modal_per_kategori to authenticated;
