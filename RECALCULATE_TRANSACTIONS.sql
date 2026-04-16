-- ============================================================
-- RECALCULATE TRANSACTIONS
-- Fix kalkulasi total_harga_produk, harga_modal, biaya Shopee,
-- dan profit untuk semua transaksi yang sudah diimport.
--
-- ROOT CAUSE:
--   File Shopee "Total Harga Produk" = HARGA PER UNIT (bukan total).
--   Import lama menyimpan nilai apa adanya tanpa × qty.
--   Akibatnya untuk qty > 1:
--     - total_harga_produk terlalu kecil (hanya 1 unit)
--     - harga_modal_total sudah benar (× qty)
--     - Hasil: profit menjadi sangat negatif (salah)
--
-- CONTOH SEBELUM FIX:
--   qty=2, total_harga_produk=125.965 (per unit), modal=115.500 (2 unit)
--   profit = 125.965 - 115.500 - 24.239 = -13.774 ← SALAH
--
-- CONTOH SETELAH FIX:
--   qty=2, total_harga_produk=251.930 (total), modal=115.500 (2 unit)
--   biaya_admin = 8.25% × 251.930 = 20.784
--   biaya_layanan = 10% × 251.930 = 25.193
--   profit = 251.930 - 115.500 - 47.227 = 89.203 ← BENAR
--
-- AMAN DIJALANKAN:
--   - qty = 1 → × 1 = tidak ada perubahan nilai
--   - qty > 1 → diperbaiki
--   - Jalankan SEKALI SAJA
-- ============================================================

-- ── STEP 1: Preview dulu sebelum update ─────────────────────
-- Jalankan query ini untuk melihat transaksi yang akan berubah:

SELECT
  order_id,
  nama_produk,
  qty,
  total_harga_produk                          AS thp_lama,
  total_harga_produk * qty                    AS thp_baru,
  harga_modal_per_item,
  harga_modal_per_item * qty                  AS modal_baru,
  profit                                      AS profit_lama,
  -- Simulasi profit baru
  (total_harga_produk * qty)
    - (harga_modal_per_item * qty)
    - (
        COALESCE(voucher_ditanggung_penjual, 0)
        + ROUND((total_harga_produk * qty) * 0.0825)
        + ROUND((total_harga_produk * qty) * 0.1000)
        + 1250
      )                                       AS profit_baru_simulasi
FROM public.transactions
WHERE qty > 1
ORDER BY tanggal DESC
LIMIT 50;

-- ── STEP 2: Jalankan UPDATE setelah preview terlihat benar ──
-- Hapus komentar di bawah ini (blok BEGIN...COMMIT) lalu Run.

/*
BEGIN;

UPDATE public.transactions
SET
  -- 1. Fix total_harga_produk: unit price × qty = total revenue
  total_harga_produk = total_harga_produk * qty,

  -- 2. Fix harga_modal_total: selalu harga_modal_per_item × qty
  harga_modal_total = harga_modal_per_item * qty,

  -- 3. Recalculate biaya administrasi (8.25% dari total baru)
  biaya_administrasi = ROUND((total_harga_produk * qty) * 0.0825),

  -- 4. Recalculate biaya layanan gabungan (10% dari total baru)
  biaya_layanan_promo_xtra_gratis_ongkir_xtra = ROUND((total_harga_produk * qty) * 0.1000),

  -- 5. Biaya proses pesanan tetap Rp 1.250 per transaksi
  biaya_proses_pesanan = 1250,

  -- 6. Recalculate total_biaya_shopee
  total_biaya_shopee =
      COALESCE(voucher_ditanggung_penjual, 0)
    + ROUND((total_harga_produk * qty) * 0.0825)
    + ROUND((total_harga_produk * qty) * 0.1000)
    + 1250
    + COALESCE(biaya_program_hemat_biaya_kirim, 0)
    + COALESCE(biaya_transaksi_spaylater, 0)
    + COALESCE(biaya_ams, 0),

  -- 7. Recalculate profit
  profit =
      (total_harga_produk * qty)
    - (harga_modal_per_item * qty)
    - (
          COALESCE(voucher_ditanggung_penjual, 0)
        + ROUND((total_harga_produk * qty) * 0.0825)
        + ROUND((total_harga_produk * qty) * 0.1000)
        + 1250
        + COALESCE(biaya_program_hemat_biaya_kirim, 0)
        + COALESCE(biaya_transaksi_spaylater, 0)
        + COALESCE(biaya_ams, 0)
      )

-- Update SEMUA transaksi (qty=1 tidak berubah nilainya karena × 1)
WHERE qty > 0;

-- Verifikasi hasil
SELECT
  COUNT(*)                                    AS total_transaksi,
  COUNT(*) FILTER (WHERE qty > 1)             AS transaksi_qty_lebih_1,
  SUM(profit)                                 AS total_profit_baru,
  AVG(profit)                                 AS rata_profit,
  COUNT(*) FILTER (WHERE profit < 0)          AS transaksi_negatif
FROM public.transactions;

COMMIT;
*/
