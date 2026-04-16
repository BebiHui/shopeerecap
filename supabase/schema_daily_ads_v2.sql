-- ============================================================
-- ShopeeRekap — Schema: Daily Ads Cost (Iklan Harian)
-- Jalankan di Supabase SQL Editor setelah schema_shopee_v2.sql
-- ============================================================

-- ============================================================
-- 1. DAILY_ADS_COST
--    Total biaya iklan per hari per user (bukan per transaksi)
--    Constraint: satu hari hanya satu record per user
-- ============================================================
create table if not exists public.daily_ads_cost (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tanggal     date not null,
  total_iklan numeric(15,2) not null default 0 check (total_iklan >= 0),
  catatan     text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  -- Satu hari satu record per user
  unique (user_id, tanggal)
);

alter table public.daily_ads_cost enable row level security;
create policy "dac_all" on public.daily_ads_cost
  for all using (auth.uid() = user_id);

create index if not exists idx_dac_user_date on public.daily_ads_cost(user_id, tanggal desc);

-- Trigger updated_at
create trigger trg_dac_updated
  before update on public.daily_ads_cost
  for each row execute function public.set_updated_at();

-- ============================================================
-- 2. VIEW: shopee_net_profit_harian
--    Gabung shopee_daily_summary + daily_ads_cost
--    net_profit_harian = total_profit_transaksi - total_iklan_harian
-- ============================================================
create or replace view public.shopee_net_profit_harian as
select
  s.user_id,
  s.tanggal,
  s.total_transaksi,
  s.total_qty,
  s.total_omzet,
  s.total_modal_keluar,
  s.total_biaya_shopee,
  s.total_profit                                      as profit_produk,
  coalesce(d.total_iklan, 0)                          as total_iklan_harian,
  coalesce(d.catatan, '')                             as catatan_iklan,
  -- NET PROFIT = profit transaksi - iklan harian
  s.total_profit - coalesce(d.total_iklan, 0)         as net_profit_harian,
  s.total_unmatched,
  s.match_rate_pct,
  -- Margin net terhadap omzet
  case
    when s.total_omzet > 0
    then round(
      100.0 * (s.total_profit - coalesce(d.total_iklan, 0)) / s.total_omzet,
      2
    )
    else 0
  end                                                 as net_margin_pct
from public.shopee_daily_summary s
left join public.daily_ads_cost d
  on d.user_id = s.user_id and d.tanggal = s.tanggal
order by s.tanggal desc;

grant select on public.shopee_net_profit_harian to authenticated;

-- ============================================================
-- 3. VIEW: shopee_net_profit_bulanan
--    Agregasi bulanan dengan net profit
-- ============================================================
create or replace view public.shopee_net_profit_bulanan as
select
  n.user_id,
  date_trunc('month', n.tanggal)::date                as bulan,
  to_char(n.tanggal, 'Mon YYYY')                      as label_bulan,
  sum(n.total_transaksi)::int                         as total_transaksi,
  sum(n.total_qty)::int                               as total_qty,
  sum(n.total_omzet)                                  as total_omzet,
  sum(n.total_modal_keluar)                           as total_modal_keluar,
  sum(n.total_biaya_shopee)                           as total_biaya_shopee,
  sum(n.profit_produk)                                as profit_produk,
  sum(n.total_iklan_harian)                           as total_iklan,
  sum(n.net_profit_harian)                            as net_profit,
  sum(n.total_unmatched)::int                         as total_unmatched
from public.shopee_net_profit_harian n
group by n.user_id, date_trunc('month', n.tanggal), to_char(n.tanggal, 'Mon YYYY')
order by bulan desc;

grant select on public.shopee_net_profit_bulanan to authenticated;

-- ============================================================
-- 4. Helper query: rekap iklan & net profit per periode
-- ============================================================
-- Contoh query untuk aplikasi:
--
-- Hari ini:
--   select * from shopee_net_profit_harian
--   where user_id = $uid and tanggal = current_date
--
-- 7 hari terakhir:
--   select sum(profit_produk) as profit, sum(total_iklan_harian) as iklan,
--          sum(net_profit_harian) as net_profit
--   from shopee_net_profit_harian
--   where user_id = $uid and tanggal >= current_date - 6
--
-- Bulan ini:
--   select * from shopee_net_profit_bulanan
--   where user_id = $uid and bulan = date_trunc('month', current_date)
