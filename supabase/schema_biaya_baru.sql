-- ============================================================
-- ShopeeRekap — Migrasi: Field Biaya Baru pada Tabel Transactions
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- Tambah 6 kolom biaya baru (idempotent)
do $$
begin
  -- 1. Biaya Administrasi
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='biaya_administrasi') then
    alter table public.transactions
      add column biaya_administrasi numeric(15,2) not null default 0;
  end if;

  -- 2. Biaya Program Hemat Biaya Kirim
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='biaya_program_hemat_biaya_kirim') then
    alter table public.transactions
      add column biaya_program_hemat_biaya_kirim numeric(15,2) not null default 0;
  end if;

  -- 3. Biaya Layanan Promo XTRA+ & Gratis Ongkir XTRA
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='biaya_layanan_promo_xtra_gratis_ongkir_xtra') then
    alter table public.transactions
      add column biaya_layanan_promo_xtra_gratis_ongkir_xtra numeric(15,2) not null default 0;
  end if;

  -- 4. Biaya Proses Pesanan
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='biaya_proses_pesanan') then
    alter table public.transactions
      add column biaya_proses_pesanan numeric(15,2) not null default 0;
  end if;

  -- 5. Biaya Transaksi SPayLater
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='biaya_transaksi_spaylater') then
    alter table public.transactions
      add column biaya_transaksi_spaylater numeric(15,2) not null default 0;
  end if;

  -- 6. Biaya AMS
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='biaya_ams') then
    alter table public.transactions
      add column biaya_ams numeric(15,2) not null default 0;
  end if;

  -- total_harga_produk (jika belum ada — alias untuk harga_jual × qty yang sudah ada sebagai total_kotor)
  -- Untuk transaksi manual: total_harga_produk = total_kotor
  -- Kolom ini sudah ada di shopee_transactions, tambahkan ke transactions juga
  if not exists (select 1 from information_schema.columns
    where table_name='transactions' and column_name='total_harga_produk') then
    alter table public.transactions
      add column total_harga_produk numeric(15,2);
  end if;

end $$;

-- Index untuk biaya baru (opsional, untuk query agregasi)
create index if not exists idx_trx_biaya_adm
  on public.transactions(user_id, biaya_administrasi)
  where biaya_administrasi > 0;

-- ============================================================
-- View baru: daily_summary_v2
-- Memakai 6 biaya baru sebagai total_biaya_shopee
-- Backward compatible: jika biaya baru semua 0 dan biaya lama ada,
-- tampilkan biaya lama sebagai fallback (untuk data historis)
-- ============================================================
create or replace view public.daily_summary_v2 as
select
  t.user_id,
  t.tanggal,
  count(*)::int                                    as total_transaksi,
  sum(t.qty)::int                                  as total_item,
  sum(t.total_kotor)                               as total_omzet,
  sum(t.total_modal)                               as total_modal,

  -- Total biaya shopee: pakai field baru jika ada, fallback ke lama
  sum(
    case
      when (
        coalesce(t.biaya_administrasi, 0)
        + coalesce(t.biaya_program_hemat_biaya_kirim, 0)
        + coalesce(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra, 0)
        + coalesce(t.biaya_proses_pesanan, 0)
        + coalesce(t.biaya_transaksi_spaylater, 0)
        + coalesce(t.biaya_ams, 0)
      ) > 0
      then (
        coalesce(t.biaya_administrasi, 0)
        + coalesce(t.biaya_program_hemat_biaya_kirim, 0)
        + coalesce(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra, 0)
        + coalesce(t.biaya_proses_pesanan, 0)
        + coalesce(t.biaya_transaksi_spaylater, 0)
        + coalesce(t.biaya_ams, 0)
      )
      else (
        -- Fallback ke field biaya lama
        coalesce(t.biaya_admin, 0)
        + coalesce(t.biaya_layanan, 0)
        + coalesce(t.biaya_program, 0)
        + coalesce(t.biaya_affiliate, 0)
        + coalesce(t.ongkir_seller, 0)
        + coalesce(t.voucher_shopee, 0)
      )
    end
  )                                                as total_biaya_shopee,

  -- Breakdown 6 biaya baru
  sum(coalesce(t.biaya_administrasi, 0))                            as total_biaya_administrasi,
  sum(coalesce(t.biaya_program_hemat_biaya_kirim, 0))               as total_biaya_hemat_kirim,
  sum(coalesce(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra, 0))   as total_biaya_xtra,
  sum(coalesce(t.biaya_proses_pesanan, 0))                          as total_biaya_proses,
  sum(coalesce(t.biaya_transaksi_spaylater, 0))                     as total_biaya_spaylater,
  sum(coalesce(t.biaya_ams, 0))                                     as total_biaya_ams,

  -- Profit bersih dengan formula baru:
  -- profit = total_harga_produk (atau total_kotor) - total_biaya_shopee - total_modal
  sum(
    t.total_kotor
    - case
        when (
          coalesce(t.biaya_administrasi, 0)
          + coalesce(t.biaya_program_hemat_biaya_kirim, 0)
          + coalesce(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra, 0)
          + coalesce(t.biaya_proses_pesanan, 0)
          + coalesce(t.biaya_transaksi_spaylater, 0)
          + coalesce(t.biaya_ams, 0)
        ) > 0
        then (
          coalesce(t.biaya_administrasi, 0)
          + coalesce(t.biaya_program_hemat_biaya_kirim, 0)
          + coalesce(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra, 0)
          + coalesce(t.biaya_proses_pesanan, 0)
          + coalesce(t.biaya_transaksi_spaylater, 0)
          + coalesce(t.biaya_ams, 0)
        )
        else (
          coalesce(t.biaya_admin, 0)
          + coalesce(t.biaya_layanan, 0)
          + coalesce(t.biaya_program, 0)
          + coalesce(t.biaya_affiliate, 0)
          + coalesce(t.ongkir_seller, 0)
          + coalesce(t.voucher_shopee, 0)
        )
      end
    - t.total_modal
  )                                                as profit_bersih,

  -- Join dengan daily_ads_cost
  coalesce(da.total, 0)                            as total_iklan_harian

from public.transactions t
left join public.daily_ads da
  on da.user_id = t.user_id and da.tanggal = t.tanggal
group by t.user_id, t.tanggal, da.total
order by t.tanggal desc;

grant select on public.daily_summary_v2 to authenticated;
