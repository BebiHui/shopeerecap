-- =============================================================
-- FIX: Buat/Replace semua View Supabase untuk Shopee Rekap
-- Jalankan SELURUH file ini di Supabase → SQL Editor
-- =============================================================
-- ROOT CAUSE: Halaman Dashboard, Rekap Harian, dan Profit Rekap
-- semuanya baca dari VIEW database (bukan tabel langsung).
-- View-view ini tidak ada atau pakai nama field lama.
-- Hasilnya: semua halaman summary tampil 0.
--
-- VIEW yang dibutuhkan:
--   1. shopee_transactions       → alias dari tabel transactions
--   2. daily_summary_v2          → rekap harian per user
--   3. daily_summary             → alias daily_summary_v2 (kompatibilitas)
--   4. shopee_net_profit_harian  → profit + iklan per hari
--   5. shopee_net_profit_bulanan → profit + iklan per bulan
--   6. shopee_sku_summary        → rekap per SKU
-- =============================================================

-- --------------------------------------------------
-- 1. shopee_transactions (alias tabel transactions)
--    Dashboard membaca dari sini untuk:
--    - Tampil transaksi terbaru
--    - Hitung total transaksi dengan modal belum diisi
-- --------------------------------------------------
DROP VIEW IF EXISTS shopee_transactions CASCADE;

CREATE OR REPLACE VIEW shopee_transactions AS
SELECT
  id,
  user_id,
  tanggal,
  order_id,
  nama_produk,
  sku_induk,
  qty,
  total_harga_produk,
  harga_modal_per_item,
  -- Hitung harga_modal_total: pakai kolom jika ada, fallback kalkulasi
  COALESCE(
    harga_modal_total,
    harga_modal_per_item * qty,
    0
  )::numeric AS harga_modal_total,
  voucher_ditanggung_penjual,
  biaya_administrasi,
  biaya_program_hemat_biaya_kirim,
  biaya_layanan_promo_xtra_gratis_ongkir_xtra,
  biaya_proses_pesanan,
  biaya_transaksi_spaylater,
  biaya_ams,
  total_biaya_shopee,
  profit,
  -- Field untuk flagging SKU belum ada harga modal
  unmatched_modal,
  created_at,
  updated_at
FROM transactions;

-- --------------------------------------------------
-- 2. daily_summary_v2 (rekap per hari per user)
--    Dipakai oleh: /dashboard/daily-recap
--
-- Field yang dipakai page:
--   tanggal, user_id,
--   total_omzet, profit_bersih, total_modal,
--   total_biaya_shopee, total_iklan_harian,
--   total_transaksi, total_item
-- --------------------------------------------------
DROP VIEW IF EXISTS daily_summary_v2 CASCADE;

CREATE OR REPLACE VIEW daily_summary_v2 AS
SELECT
  t.user_id,
  t.tanggal,
  COALESCE(SUM(t.total_harga_produk), 0)                    AS total_omzet,
  COALESCE(SUM(t.profit), 0)                                 AS profit_bersih,
  COALESCE(SUM(
    COALESCE(t.harga_modal_total, t.harga_modal_per_item * t.qty, 0)
  ), 0)                                                       AS total_modal,
  COALESCE(SUM(t.total_biaya_shopee), 0)                     AS total_biaya_shopee,
  -- MAX bukan SUM: daily_ads_cost punya 1 baris per hari, bukan per transaksi
  COALESCE(MAX(a.total_iklan), 0)                            AS total_iklan_harian,
  COUNT(t.id)                                                 AS total_transaksi,
  COALESCE(SUM(t.qty), 0)                                    AS total_item
FROM transactions t
LEFT JOIN daily_ads_cost a
  ON a.user_id = t.user_id
  AND a.tanggal::date = t.tanggal::date
GROUP BY t.user_id, t.tanggal;

-- --------------------------------------------------
-- 3. daily_summary (kompatibilitas: fallback dari daily-recap page)
-- --------------------------------------------------
DROP VIEW IF EXISTS daily_summary CASCADE;

CREATE OR REPLACE VIEW daily_summary AS
SELECT * FROM daily_summary_v2;

-- --------------------------------------------------
-- 4. shopee_net_profit_harian (profit harian gabungan)
--    Dipakai oleh: /dashboard, /dashboard/profit-rekap,
--                  /dashboard/iklan-harian
--
-- Field yang dipakai:
--   tanggal, user_id,
--   profit_produk, total_iklan_harian, net_profit_harian,
--   total_transaksi, total_omzet, total_modal_keluar
-- --------------------------------------------------
DROP VIEW IF EXISTS shopee_net_profit_harian CASCADE;

CREATE OR REPLACE VIEW shopee_net_profit_harian AS
SELECT
  t.user_id,
  t.tanggal,
  COALESCE(SUM(t.profit), 0)                                 AS profit_produk,
  COALESCE(MAX(a.total_iklan), 0)                            AS total_iklan_harian,
  COALESCE(SUM(t.profit), 0) - COALESCE(MAX(a.total_iklan), 0)
                                                              AS net_profit_harian,
  COUNT(t.id)                                                 AS total_transaksi,
  COALESCE(SUM(t.total_harga_produk), 0)                    AS total_omzet,
  COALESCE(SUM(
    COALESCE(t.harga_modal_total, t.harga_modal_per_item * t.qty, 0)
  ), 0)                                                       AS total_modal_keluar
FROM transactions t
LEFT JOIN daily_ads_cost a
  ON a.user_id = t.user_id
  AND a.tanggal::date = t.tanggal::date
GROUP BY t.user_id, t.tanggal;

-- --------------------------------------------------
-- 5. shopee_net_profit_bulanan (profit per bulan)
--    Dipakai oleh: /dashboard/profit-rekap
--
-- Field: bulan (YYYY-MM), user_id,
--   profit_produk, total_iklan, net_profit,
--   total_transaksi, total_omzet, total_modal_keluar
-- --------------------------------------------------
DROP VIEW IF EXISTS shopee_net_profit_bulanan CASCADE;

CREATE OR REPLACE VIEW shopee_net_profit_bulanan AS
WITH monthly_trx AS (
  SELECT
    user_id,
    TO_CHAR(tanggal::date, 'YYYY-MM')                        AS bulan,
    COALESCE(SUM(profit), 0)                                  AS profit_produk,
    COUNT(id)                                                  AS total_transaksi,
    COALESCE(SUM(total_harga_produk), 0)                     AS total_omzet,
    COALESCE(SUM(
      COALESCE(harga_modal_total, harga_modal_per_item * qty, 0)
    ), 0)                                                      AS total_modal_keluar
  FROM transactions
  GROUP BY user_id, TO_CHAR(tanggal::date, 'YYYY-MM')
),
monthly_ads AS (
  SELECT
    user_id,
    TO_CHAR(tanggal::date, 'YYYY-MM')                        AS bulan,
    COALESCE(SUM(total_iklan), 0)                             AS total_iklan
  FROM daily_ads_cost
  GROUP BY user_id, TO_CHAR(tanggal::date, 'YYYY-MM')
)
SELECT
  trx.user_id,
  trx.bulan,
  trx.profit_produk,
  COALESCE(ads.total_iklan, 0)                               AS total_iklan,
  trx.profit_produk - COALESCE(ads.total_iklan, 0)          AS net_profit,
  trx.total_transaksi,
  trx.total_omzet,
  trx.total_modal_keluar
FROM monthly_trx trx
LEFT JOIN monthly_ads ads
  ON ads.user_id = trx.user_id
  AND ads.bulan = trx.bulan
ORDER BY trx.user_id, trx.bulan DESC;

-- --------------------------------------------------
-- 6. shopee_sku_summary (rekap per SKU)
--    Dipakai oleh: /dashboard, /dashboard/profit-rekap
--
-- Field: user_id, sku_induk, nama_produk,
--   total_profit, total_omzet, total_transaksi, total_qty
-- --------------------------------------------------
DROP VIEW IF EXISTS shopee_sku_summary CASCADE;

CREATE OR REPLACE VIEW shopee_sku_summary AS
SELECT
  user_id,
  sku_induk,
  -- Ambil nama_produk terbaru untuk SKU tersebut
  (ARRAY_AGG(nama_produk ORDER BY created_at DESC))[1]       AS nama_produk,
  COALESCE(SUM(profit), 0)                                    AS total_profit,
  COALESCE(SUM(total_harga_produk), 0)                       AS total_omzet,
  COUNT(id)                                                    AS total_transaksi,
  COALESCE(SUM(qty), 0)                                       AS total_qty
FROM transactions
WHERE sku_induk IS NOT NULL AND sku_induk != ''
GROUP BY user_id, sku_induk;

-- --------------------------------------------------
-- INDEX REKOMENDASI (jalankan jika belum ada)
-- Percepat query range tanggal dan join iklan harian
-- --------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transactions_user_tanggal
  ON transactions (user_id, tanggal);

CREATE INDEX IF NOT EXISTS idx_daily_ads_cost_user_tanggal
  ON daily_ads_cost (user_id, tanggal);

-- --------------------------------------------------
-- VERIFIKASI: Cek view sudah benar
-- Uncomment baris di bawah untuk test setelah run
-- --------------------------------------------------
-- SELECT * FROM daily_summary_v2 ORDER BY tanggal DESC LIMIT 10;
-- SELECT * FROM shopee_net_profit_harian ORDER BY tanggal DESC LIMIT 10;
-- SELECT * FROM shopee_net_profit_bulanan LIMIT 10;
-- SELECT * FROM shopee_sku_summary ORDER BY total_profit DESC LIMIT 10;

