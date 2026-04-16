// src/lib/shopee-costs.ts
// ============================================================
// Helper kalkulasi biaya Shopee default — dipakai saat import
// transaksi harian agar setiap transaksi langsung memiliki
// estimasi biaya Shopee dan profit tanpa input manual.
//
// RULE BIAYA:
//   1. Biaya Administrasi      = 8.25% × total_harga_produk
//   2. Biaya Layanan           = 10.0% × total_harga_produk
//        terdiri dari:
//          • 4.5% Promo XTRA+
//          • 5.5% Gratis Ongkir XTRA
//        (digabung ke satu field biaya_layanan_promo_xtra_gratis_ongkir_xtra)
//   3. Biaya Proses Pesanan    = Rp 1.250 (tetap, per transaksi)
//   4. Biaya Hemat Kirim       = 0  (tidak diautomatisasi)
//   5. Biaya SPayLater         = 0  (tidak selalu ada)
//   6. Biaya AMS               = 0  (tidak selalu ada)
//
// FORMULA TOTAL:
//   total_biaya_shopee =
//     voucher_ditanggung_penjual
//     + biaya_administrasi
//     + biaya_program_hemat_biaya_kirim
//     + biaya_layanan_promo_xtra_gratis_ongkir_xtra
//     + biaya_proses_pesanan
//     + biaya_transaksi_spaylater
//     + biaya_ams
//
// FORMULA PROFIT:
//   profit = total_harga_produk - harga_modal_total - total_biaya_shopee
// ============================================================

/** Helper aman — tidak pernah NaN */
function n(v: unknown): number {
  const x = Number(v ?? 0)
  return isNaN(x) ? 0 : x
}

// ── Rate & konstanta ──────────────────────────────────────────

/** Rate biaya administrasi Shopee */
export const RATE_ADMINISTRASI = 0.0825           // 8.25%

/**
 * Rate biaya layanan gabungan:
 *   4.5%  Promo XTRA+  → biaya_layanan_promo_xtra
 *   5.5%  Gratis Ongkir XTRA → biaya_layanan_gratis_ongkir_xtra
 * Total = 10.0% → disimpan ke field biaya_layanan_promo_xtra_gratis_ongkir_xtra
 */
export const RATE_LAYANAN_PROMO_XTRA = 0.045      // 4.5%
export const RATE_LAYANAN_GRATIS_ONGKIR = 0.055   // 5.5%
export const RATE_LAYANAN_TOTAL =                 // = 10.0%
  RATE_LAYANAN_PROMO_XTRA + RATE_LAYANAN_GRATIS_ONGKIR

/** Biaya proses pesanan — nilai tetap per transaksi */
export const BIAYA_PROSES_PESANAN_DEFAULT = 1_250 // Rp 1.250

// ── Output type ───────────────────────────────────────────────

export interface DefaultShopeeCosts {
  /** 8.25% × total_harga_produk */
  biaya_administrasi: number

  /**
   * (4.5% + 5.5%) × total_harga_produk = 10.0% × total_harga_produk
   * Terdiri dari Promo XTRA+ (4.5%) + Gratis Ongkir XTRA (5.5%)
   */
  biaya_layanan_promo_xtra_gratis_ongkir_xtra: number

  /** Rp 1.250 tetap */
  biaya_proses_pesanan: number

  /** Default 0 — tidak diautomatisasi */
  biaya_program_hemat_biaya_kirim: number

  /** Default 0 — tidak selalu ada */
  biaya_transaksi_spaylater: number

  /** Default 0 — tidak selalu ada */
  biaya_ams: number

  /**
   * Total semua biaya Shopee + voucher penjual.
   * Siap dipakai langsung sebagai pengurang profit.
   */
  total_biaya_shopee: number
}

// ── Fungsi utama ──────────────────────────────────────────────

/**
 * Hitung biaya Shopee default untuk satu transaksi.
 *
 * Dipakai saat import Excel → setiap baris langsung punya estimasi biaya.
 * User tetap bisa override manual setelah import.
 *
 * @param total_harga_produk  Nilai penjualan final dari Shopee (sudah include qty)
 * @param voucher_ditanggung_penjual  Voucher dari file import (default 0)
 * @returns DefaultShopeeCosts — semua field selalu angka valid, tidak pernah NaN
 *
 * @example
 * // qty=1, total_harga_produk=300_000, harga_modal_per_item=150_000
 * const costs = calculateDefaultShopeeCosts(300_000, 0)
 * // → biaya_administrasi = 24_750  (8.25%)
 * // → biaya_layanan...   = 30_000  (10%)
 * // → biaya_proses...    =  1_250  (tetap)
 * // → total_biaya_shopee = 56_000
 * // → profit = 300_000 - 150_000 - 56_000 = 94_000
 */
export function calculateDefaultShopeeCosts(
  total_harga_produk: number,
  voucher_ditanggung_penjual = 0
): DefaultShopeeCosts {
  const thp     = Math.max(0, n(total_harga_produk))
  const voucher = Math.max(0, n(voucher_ditanggung_penjual))

  // ── 1. Biaya Administrasi: 8.25% ─────────────────────────
  const biaya_administrasi = Math.round(thp * RATE_ADMINISTRASI)

  // ── 2. Biaya Layanan gabungan: 10.0% ─────────────────────
  //       4.5% (Promo XTRA+) + 5.5% (Gratis Ongkir XTRA)
  const biaya_layanan_promo_xtra_gratis_ongkir_xtra =
    Math.round(thp * RATE_LAYANAN_TOTAL)

  // ── 3. Biaya Proses Pesanan: tetap Rp 1.250 ──────────────
  const biaya_proses_pesanan = BIAYA_PROSES_PESANAN_DEFAULT

  // ── 4–6. Tidak diautomatisasi — default 0 ────────────────
  const biaya_program_hemat_biaya_kirim = 0
  const biaya_transaksi_spaylater       = 0
  const biaya_ams                       = 0

  // ── Total ─────────────────────────────────────────────────
  const total_biaya_shopee =
    voucher +
    biaya_administrasi +
    biaya_program_hemat_biaya_kirim +
    biaya_layanan_promo_xtra_gratis_ongkir_xtra +
    biaya_proses_pesanan +
    biaya_transaksi_spaylater +
    biaya_ams

  return {
    biaya_administrasi,
    biaya_layanan_promo_xtra_gratis_ongkir_xtra,
    biaya_proses_pesanan,
    biaya_program_hemat_biaya_kirim,
    biaya_transaksi_spaylater,
    biaya_ams,
    total_biaya_shopee,
  }
}

/**
 * Hitung profit transaksi dari hasil import.
 *
 * @param total_harga_produk  Nilai penjualan final
 * @param qty                 Jumlah item
 * @param harga_modal_per_item Harga modal per item (dari master harga modal)
 * @param costs               Hasil calculateDefaultShopeeCosts
 */
export function calculateImportProfit(
  total_harga_produk: number,
  qty: number,
  harga_modal_per_item: number,
  costs: DefaultShopeeCosts
): { harga_modal_total: number; profit: number } {
  const thp              = Math.max(0, n(total_harga_produk))
  const harga_modal_total = Math.max(0, n(harga_modal_per_item)) * Math.max(1, n(qty))
  const profit           = thp - harga_modal_total - n(costs.total_biaya_shopee)

  return { harga_modal_total, profit }
}
