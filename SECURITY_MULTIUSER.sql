-- ============================================================
-- SHOPEE REKAP — Multi-User Security Fix
-- Jalankan di: Supabase Dashboard → SQL Editor → New Query
--
-- Isi:
--   A. Verifikasi RLS semua tabel
--   B. Fix views: tambah WHERE user_id = auth.uid()
--      agar view sendiri menolak bocor data antar user
--   C. Recreate policies idempotent (skip jika sudah ada)
-- ============================================================

-- ============================================================
-- A. VERIFIKASI RLS — cek tabel mana yang belum enable RLS
-- ============================================================
-- Jalankan dulu untuk lihat status RLS semua tabel:
SELECT
  schemaname,
  tablename,
  rowsecurity  AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================================
-- B. PASTIKAN RLS AKTIF — hanya pada TABLE (bukan VIEW)
--    relkind = 'r' artinya regular table
--    relkind = 'v' artinya view — RLS tidak bisa diaktifkan pada view
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
  tbl_list TEXT[] := ARRAY[
    'transactions',
    'master_harga_modal',
    'daily_ads_cost',
    'daily_ads',
    'products',
    'profiles',
    'imports',
    'shopee_transactions',
    'unmatched_modal_items',
    'harga_modal_history',
    'master_sku',
    'sku_cost_history',
    'unmatched_import_items'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbl_list LOOP
    -- Hanya enable RLS jika relasi ada DAN merupakan table (bukan view)
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = tbl
        AND c.relkind = 'r'   -- 'r' = regular table, bukan 'v' view
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      RAISE NOTICE 'RLS enabled: %', tbl;
    ELSE
      RAISE NOTICE 'SKIP (view atau tidak ada): %', tbl;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- C. BUAT POLICY UNTUK TABEL YANG BELUM ADA POLICY
--    (idempotent: skip jika policy sudah ada, skip jika view)
--
--    CATATAN: FUNCTION tidak boleh dideklarasikan di dalam DO block.
--    Solusi: inline EXISTS check per tabel.
--    relkind = 'r' → regular table (bukan view/matview/dll)
-- ============================================================

DO $$
BEGIN

  -- transactions
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='transactions' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='transactions' AND policyname='transactions_all'
  ) THEN
    CREATE POLICY transactions_all ON public.transactions
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: transactions_all';
  ELSE
    RAISE NOTICE 'SKIP policy transactions_all (sudah ada atau bukan table)';
  END IF;

  -- master_harga_modal
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='master_harga_modal' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='master_harga_modal' AND policyname='hm_all'
  ) THEN
    CREATE POLICY hm_all ON public.master_harga_modal
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: hm_all';
  ELSE
    RAISE NOTICE 'SKIP policy hm_all (sudah ada atau bukan table)';
  END IF;

  -- daily_ads_cost
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='daily_ads_cost' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='daily_ads_cost' AND policyname='dac_all'
  ) THEN
    CREATE POLICY dac_all ON public.daily_ads_cost
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: dac_all';
  ELSE
    RAISE NOTICE 'SKIP policy dac_all (sudah ada atau bukan table)';
  END IF;

  -- daily_ads
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='daily_ads' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='daily_ads' AND policyname='daily_ads_all'
  ) THEN
    CREATE POLICY daily_ads_all ON public.daily_ads
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: daily_ads_all';
  ELSE
    RAISE NOTICE 'SKIP policy daily_ads_all (sudah ada atau bukan table)';
  END IF;

  -- products
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='products' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='products' AND policyname='products_all'
  ) THEN
    CREATE POLICY products_all ON public.products
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: products_all';
  ELSE
    RAISE NOTICE 'SKIP policy products_all (sudah ada atau bukan table)';
  END IF;

  -- profiles (primary key = id, bukan user_id)
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='profiles' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_select'
  ) THEN
    CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (auth.uid() = id);
    CREATE POLICY profiles_insert ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
    CREATE POLICY profiles_update ON public.profiles FOR UPDATE USING (auth.uid() = id);
    RAISE NOTICE 'Policy created: profiles_select / insert / update';
  ELSE
    RAISE NOTICE 'SKIP policy profiles (sudah ada atau bukan table)';
  END IF;

  -- imports
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='imports' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='imports' AND policyname='imports_all'
  ) THEN
    CREATE POLICY imports_all ON public.imports
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: imports_all';
  ELSE
    RAISE NOTICE 'SKIP policy imports_all (sudah ada atau bukan table)';
  END IF;

  -- shopee_transactions (akan di-SKIP otomatis jika ini view di DB kamu)
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='shopee_transactions' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='shopee_transactions' AND policyname='stx_all'
  ) THEN
    CREATE POLICY stx_all ON public.shopee_transactions
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: stx_all';
  ELSE
    RAISE NOTICE 'SKIP policy stx_all (sudah ada atau merupakan VIEW — normal)';
  END IF;

  -- unmatched_modal_items (akan di-SKIP otomatis jika ini view di DB kamu)
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='unmatched_modal_items' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='unmatched_modal_items' AND policyname='umi_all'
  ) THEN
    CREATE POLICY umi_all ON public.unmatched_modal_items
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: umi_all';
  ELSE
    RAISE NOTICE 'SKIP policy umi_all (sudah ada atau merupakan VIEW — normal)';
  END IF;

  -- harga_modal_history
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='harga_modal_history' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='harga_modal_history' AND policyname='hmh_all'
  ) THEN
    CREATE POLICY hmh_all ON public.harga_modal_history
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: hmh_all';
  ELSE
    RAISE NOTICE 'SKIP policy hmh_all (sudah ada atau bukan table)';
  END IF;

  -- master_sku
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='master_sku' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='master_sku' AND policyname='master_sku_all'
  ) THEN
    CREATE POLICY master_sku_all ON public.master_sku
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: master_sku_all';
  ELSE
    RAISE NOTICE 'SKIP policy master_sku_all (sudah ada atau bukan table)';
  END IF;

  -- sku_cost_history
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='sku_cost_history' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='sku_cost_history' AND policyname='sku_cost_history_all'
  ) THEN
    CREATE POLICY sku_cost_history_all ON public.sku_cost_history
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: sku_cost_history_all';
  ELSE
    RAISE NOTICE 'SKIP policy sku_cost_history_all (sudah ada atau bukan table)';
  END IF;

  -- unmatched_import_items
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='unmatched_import_items' AND c.relkind='r'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='unmatched_import_items' AND policyname='uii_all'
  ) THEN
    CREATE POLICY uii_all ON public.unmatched_import_items
      FOR ALL USING (auth.uid() = user_id);
    RAISE NOTICE 'Policy created: uii_all';
  ELSE
    RAISE NOTICE 'SKIP policy uii_all (sudah ada atau bukan table)';
  END IF;

END $$;

-- ============================================================
-- D. FIX VIEWS — tambah WHERE user_id = auth.uid()
--
-- Views TIDAK mendapat perlindungan RLS dari tabel dasarnya.
-- Tanpa filter ini, query ke view tanpa .eq('user_id', ...)
-- akan mengembalikan data semua user!
--
-- Solusi: embed auth.uid() filter langsung di dalam view.
-- Supabase/PostgreSQL mengevaluasi auth.uid() di runtime
-- sesuai session user yang sedang login.
--
-- PENTING: CREATE OR REPLACE VIEW tidak bisa mengubah nama/urutan
-- kolom yang sudah ada. Solusi: DROP CASCADE dulu semua view,
-- baru CREATE ulang. Urutan DROP harus dari view paling dependen
-- ke paling dasar (bulanan → harian → dst).
-- ============================================================

-- Drop semua view yang akan di-recreate (CASCADE handles dependencies)
DROP VIEW IF EXISTS public.shopee_net_profit_bulanan  CASCADE;
DROP VIEW IF EXISTS public.shopee_net_profit_harian   CASCADE;
DROP VIEW IF EXISTS public.shopee_sku_summary         CASCADE;
DROP VIEW IF EXISTS public.daily_summary_v2           CASCADE;
DROP VIEW IF EXISTS public.daily_summary              CASCADE;
DROP VIEW IF EXISTS public.product_summary            CASCADE;

-- D1. daily_summary_v2 (view yang aktif dipakai app)
CREATE VIEW public.daily_summary_v2
WITH (security_barrier = true)    -- cegah query-rewriting bypass
AS
SELECT
  t.user_id,
  t.tanggal,
  COUNT(*)::int                                    AS total_transaksi,
  SUM(t.qty)::int                                  AS total_item,
  -- Omzet: pakai total_harga_produk (field import Shopee), fallback ke total_kotor (manual)
  SUM(
    CASE WHEN COALESCE(t.total_harga_produk, 0) > 0
      THEN t.total_harga_produk
      ELSE COALESCE(t.total_kotor, 0)
    END
  )                                                AS total_omzet,
  -- Modal: pakai harga_modal_total (field import), fallback ke total_modal (manual)
  SUM(
    CASE WHEN COALESCE(t.harga_modal_total, 0) > 0
      THEN t.harga_modal_total
      ELSE COALESCE(t.total_modal, 0)
    END
  )                                                AS total_modal,

  -- Total biaya shopee: pakai field baru jika ada, fallback ke lama
  SUM(
    CASE
      WHEN (
        COALESCE(t.biaya_administrasi, 0)
        + COALESCE(t.biaya_program_hemat_biaya_kirim, 0)
        + COALESCE(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra, 0)
        + COALESCE(t.biaya_proses_pesanan, 0)
        + COALESCE(t.biaya_transaksi_spaylater, 0)
        + COALESCE(t.biaya_ams, 0)
      ) > 0
      THEN (
        COALESCE(t.biaya_administrasi, 0)
        + COALESCE(t.biaya_program_hemat_biaya_kirim, 0)
        + COALESCE(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra, 0)
        + COALESCE(t.biaya_proses_pesanan, 0)
        + COALESCE(t.biaya_transaksi_spaylater, 0)
        + COALESCE(t.biaya_ams, 0)
      )
      ELSE (
        COALESCE(t.biaya_admin, 0)
        + COALESCE(t.biaya_layanan, 0)
        + COALESCE(t.biaya_program, 0)
        + COALESCE(t.biaya_affiliate, 0)
        + COALESCE(t.ongkir_seller, 0)
        + COALESCE(t.voucher_shopee, 0)
      )
    END
  )                                                AS total_biaya_shopee,

  SUM(COALESCE(t.biaya_administrasi, 0))                            AS total_biaya_administrasi,
  SUM(COALESCE(t.biaya_program_hemat_biaya_kirim, 0))               AS total_biaya_hemat_kirim,
  SUM(COALESCE(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra, 0))   AS total_biaya_xtra,
  SUM(COALESCE(t.biaya_proses_pesanan, 0))                          AS total_biaya_proses,
  SUM(COALESCE(t.biaya_transaksi_spaylater, 0))                     AS total_biaya_spaylater,
  SUM(COALESCE(t.biaya_ams, 0))                                     AS total_biaya_ams,

  -- Profit: pakai field `profit` yang sudah dihitung saat import/input manual
  SUM(COALESCE(t.profit, 0))                       AS profit_bersih,

  COALESCE(da.total_iklan, 0)                      AS total_iklan_harian

FROM public.transactions t
LEFT JOIN public.daily_ads_cost da
  ON da.user_id = t.user_id AND da.tanggal = t.tanggal
WHERE t.user_id = auth.uid()   -- ← KUNCI: view hanya tampilkan data user sendiri
GROUP BY t.user_id, t.tanggal, da.total_iklan
ORDER BY t.tanggal DESC;

GRANT SELECT ON public.daily_summary_v2 TO authenticated;

-- D2. shopee_net_profit_harian
-- PENTING: Import Shopee menyimpan omzet di total_harga_produk (bukan total_kotor).
--          Profit sudah dihitung saat import dan disimpan di kolom `profit`.
--          View ini menggunakan nilai-nilai tersebut agar hasilnya konsisten
--          dengan data yang sudah tersimpan di DB.
CREATE VIEW public.shopee_net_profit_harian
WITH (security_barrier = true)
AS
WITH daily AS (
  SELECT
    t.user_id,
    t.tanggal,
    COUNT(*)::int                                       AS total_transaksi,
    SUM(t.qty)::int                                     AS total_qty,
    -- Omzet = total_harga_produk (field yang dipakai import Shopee)
    -- Fallback ke total_kotor untuk transaksi manual
    SUM(
      CASE WHEN COALESCE(t.total_harga_produk, 0) > 0
        THEN t.total_harga_produk
        ELSE COALESCE(t.total_kotor, 0)
      END
    )                                                   AS total_omzet,
    -- Modal = harga_modal_total (dihitung saat import)
    -- Fallback ke total_modal untuk transaksi manual
    SUM(
      CASE WHEN COALESCE(t.harga_modal_total, 0) > 0
        THEN t.harga_modal_total
        ELSE COALESCE(t.total_modal, 0)
      END
    )                                                   AS total_modal_keluar,
    -- Biaya Shopee: pakai field baru jika ada, fallback ke field lama
    SUM(
      CASE
        WHEN (
          COALESCE(t.biaya_administrasi,0)
          + COALESCE(t.biaya_program_hemat_biaya_kirim,0)
          + COALESCE(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra,0)
          + COALESCE(t.biaya_proses_pesanan,0)
          + COALESCE(t.biaya_transaksi_spaylater,0)
          + COALESCE(t.biaya_ams,0)
        ) > 0
        THEN (
          COALESCE(t.biaya_administrasi,0)
          + COALESCE(t.biaya_program_hemat_biaya_kirim,0)
          + COALESCE(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra,0)
          + COALESCE(t.biaya_proses_pesanan,0)
          + COALESCE(t.biaya_transaksi_spaylater,0)
          + COALESCE(t.biaya_ams,0)
        )
        ELSE (
          COALESCE(t.biaya_admin,0)
          + COALESCE(t.biaya_layanan,0)
          + COALESCE(t.biaya_program,0)
          + COALESCE(t.biaya_affiliate,0)
          + COALESCE(t.ongkir_seller,0)
          + COALESCE(t.voucher_shopee,0)
        )
      END
    )                                                   AS total_biaya_shopee,
    -- Profit langsung dari field `profit` yang sudah dihitung saat import/input
    SUM(COALESCE(t.profit, 0))                          AS total_profit,
    COUNT(*) FILTER (
      WHERE COALESCE(t.unmatched_modal, false) = true
    )::int                                              AS total_unmatched
  FROM public.transactions t
  WHERE t.user_id = auth.uid()   -- ← isolasi per user
  GROUP BY t.user_id, t.tanggal
)
SELECT
  d.user_id,
  d.tanggal,
  d.total_transaksi,
  d.total_qty,
  d.total_omzet,
  d.total_modal_keluar,
  d.total_biaya_shopee,
  d.total_profit                                        AS profit_produk,
  COALESCE(ac.total_iklan, 0)                           AS total_iklan_harian,
  COALESCE(ac.catatan, '')                              AS catatan_iklan,
  d.total_profit - COALESCE(ac.total_iklan, 0)          AS net_profit_harian,
  d.total_unmatched,
  CASE
    WHEN d.total_transaksi > 0
    THEN ROUND(
      100.0 * (d.total_transaksi - d.total_unmatched) / d.total_transaksi,
      2
    )
    ELSE 100
  END                                                   AS match_rate_pct,
  CASE
    WHEN d.total_omzet > 0
    THEN ROUND(
      100.0 * (d.total_profit - COALESCE(ac.total_iklan, 0)) / d.total_omzet,
      2
    )
    ELSE 0
  END                                                   AS net_margin_pct
FROM daily d
LEFT JOIN public.daily_ads_cost ac
  ON ac.user_id = d.user_id AND ac.tanggal = d.tanggal
ORDER BY d.tanggal DESC;

GRANT SELECT ON public.shopee_net_profit_harian TO authenticated;

-- D3. shopee_net_profit_bulanan
CREATE VIEW public.shopee_net_profit_bulanan
WITH (security_barrier = true)
AS
SELECT
  n.user_id,
  DATE_TRUNC('month', n.tanggal)::date                  AS bulan,
  TO_CHAR(n.tanggal, 'Mon YYYY')                        AS label_bulan,
  SUM(n.total_transaksi)::int                           AS total_transaksi,
  SUM(n.total_qty)::int                                 AS total_qty,
  SUM(n.total_omzet)                                    AS total_omzet,
  SUM(n.total_modal_keluar)                             AS total_modal_keluar,
  SUM(n.total_biaya_shopee)                             AS total_biaya_shopee,
  SUM(n.profit_produk)                                  AS profit_produk,
  SUM(n.total_iklan_harian)                             AS total_iklan,
  SUM(n.net_profit_harian)                              AS net_profit,
  SUM(n.total_unmatched)::int                           AS total_unmatched
FROM public.shopee_net_profit_harian n   -- sudah ter-filter oleh view di atas
WHERE n.user_id = auth.uid()             -- ← double guard
GROUP BY n.user_id, DATE_TRUNC('month', n.tanggal), TO_CHAR(n.tanggal, 'Mon YYYY')
ORDER BY bulan DESC;

GRANT SELECT ON public.shopee_net_profit_bulanan TO authenticated;

-- D4. shopee_sku_summary
CREATE VIEW public.shopee_sku_summary
WITH (security_barrier = true)
AS
SELECT
  t.user_id,
  t.sku_induk,
  t.nama_produk,
  m.harga_modal                         AS harga_modal_master,
  SUM(t.qty)::int                       AS total_qty,
  SUM(t.total_harga_produk)             AS total_omzet,
  SUM(t.harga_modal_total)              AS total_modal_keluar,
  SUM(t.total_biaya_shopee)             AS total_biaya_shopee,
  SUM(t.profit)                         AS total_profit,
  COUNT(*)::int                         AS total_transaksi,
  MAX(t.tanggal)                        AS last_sold_date,
  COUNT(*) FILTER (WHERE t.unmatched_modal)::int AS trx_unmatched
FROM public.shopee_transactions t
LEFT JOIN public.master_harga_modal m
  ON m.user_id = t.user_id AND m.sku_induk = t.sku_induk
WHERE t.user_id = auth.uid()    -- ← isolasi per user
GROUP BY t.user_id, t.sku_induk, t.nama_produk, m.harga_modal
ORDER BY total_profit DESC;

GRANT SELECT ON public.shopee_sku_summary TO authenticated;

-- D5. daily_summary (view lama — fallback)
CREATE VIEW public.daily_summary
WITH (security_barrier = true)
AS
SELECT
  t.user_id,
  t.tanggal,
  COUNT(*)::int                                               AS total_transaksi,
  SUM(t.qty)::int                                             AS total_item,
  SUM(
    CASE WHEN COALESCE(t.total_harga_produk, 0) > 0
      THEN t.total_harga_produk
      ELSE COALESCE(t.total_kotor, 0)
    END
  )                                                           AS total_omzet,
  SUM(
    CASE WHEN COALESCE(t.harga_modal_total, 0) > 0
      THEN t.harga_modal_total
      ELSE COALESCE(t.total_modal, 0)
    END
  )                                                           AS total_modal,
  SUM(COALESCE(t.biaya_admin,0) + COALESCE(t.biaya_layanan,0) + COALESCE(t.biaya_program,0)
    + COALESCE(t.biaya_affiliate,0) + COALESCE(t.ongkir_seller,0)
    + COALESCE(t.voucher_shopee,0))                           AS total_potongan_shopee,
  SUM(COALESCE(t.biaya_iklan, 0))                             AS total_iklan_trx,
  COALESCE(da.total, 0)                                       AS total_iklan_harian,
  SUM(COALESCE(t.biaya_iklan, 0)) + COALESCE(da.total, 0)    AS total_iklan,
  SUM(COALESCE(t.profit, 0)) - COALESCE(da.total, 0)         AS profit_bersih
FROM public.transactions t
LEFT JOIN public.daily_ads da
  ON da.user_id = t.user_id AND da.tanggal = t.tanggal
WHERE t.user_id = auth.uid()   -- ← isolasi per user
GROUP BY t.user_id, t.tanggal, da.total
ORDER BY t.tanggal DESC;

GRANT SELECT ON public.daily_summary TO authenticated;

-- D6. product_summary
CREATE VIEW public.product_summary
WITH (security_barrier = true)
AS
SELECT
  user_id,
  nama_produk,
  sku,
  SUM(qty)::int                          AS total_qty,
  SUM(
    CASE WHEN COALESCE(total_harga_produk, 0) > 0
      THEN total_harga_produk
      ELSE COALESCE(total_kotor, 0)
    END
  )                                      AS total_omzet,
  SUM(
    CASE WHEN COALESCE(harga_modal_total, 0) > 0
      THEN harga_modal_total
      ELSE COALESCE(total_modal, 0)
    END
  )                                      AS total_modal,
  SUM(COALESCE(profit, 0))               AS total_profit,
  MAX(tanggal)                           AS last_sold_date,
  COUNT(*)::int                          AS total_transaksi
FROM public.transactions
WHERE user_id = auth.uid()    -- ← isolasi per user
GROUP BY user_id, nama_produk, sku
ORDER BY total_profit DESC;

GRANT SELECT ON public.product_summary TO authenticated;

-- ============================================================
-- E. VERIFIKASI AKHIR
-- ============================================================

-- Cek semua policy yang ada:
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Cek RLS status semua tabel:
SELECT
  tablename,
  rowsecurity AS rls_enabled,
  CASE WHEN rowsecurity THEN '✓ AMAN' ELSE '✗ TIDAK AMAN' END AS status
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
