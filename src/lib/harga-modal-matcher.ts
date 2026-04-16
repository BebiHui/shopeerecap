// src/lib/harga-modal-matcher.ts
//
// Matching SKU Induk → Master Harga Modal
// KEY RULE: SKU Induk adalah satu-satunya acuan matching
// Nama produk HANYA untuk tampilan, bukan untuk matching

import type { MasterHargaModal } from '@/types'

/**
 * Bangun lookup map SKU Induk → MasterHargaModal
 * Case-insensitive, trim whitespace
 * Panggil SEKALI sebelum loop import (O(1) per lookup)
 */
export function buildHargaModalMap(
  master: MasterHargaModal[]
): Map<string, MasterHargaModal> {
  const map = new Map<string, MasterHargaModal>()
  for (const m of master) {
    if (m.is_active && m.sku_induk) {
      map.set(normalizeKey(m.sku_induk), m)
    }
  }
  return map
}

/** Normalisasi key: lowercase + trim */
function normalizeKey(s: string): string {
  return s.toLowerCase().trim()
}

export interface HargaModalMatchResult {
  matched: boolean
  harga_modal_per_item: number
  nama_produk_master?: string
  nama_variasi_master?: string
}

/**
 * Cocokkan sku_induk dari transaksi Shopee ke master harga modal.
 * HANYA berdasarkan SKU Induk — tidak pernah berdasarkan nama produk.
 *
 * @param skuIndukFromFile  - SKU Induk dari file Shopee (bisa null/empty)
 * @param hargaModalMap     - Map yang dibangun dari buildHargaModalMap()
 * @returns HargaModalMatchResult
 */
export function matchHargaModal(
  skuIndukFromFile: string | null | undefined,
  hargaModalMap: Map<string, MasterHargaModal>
): HargaModalMatchResult {
  const key = normalizeKey(skuIndukFromFile ?? '')

  if (!key) {
    return { matched: false, harga_modal_per_item: 0 }
  }

  const found = hargaModalMap.get(key)
  if (!found) {
    return { matched: false, harga_modal_per_item: 0 }
  }

  return {
    matched: true,
    harga_modal_per_item: found.harga_modal,
    nama_produk_master: found.nama_produk,
    nama_variasi_master: found.nama_variasi ?? undefined,
  }
}

/**
 * Hitung semua derived fields sesuai formula bisnis:
 *
 * total_biaya_shopee = biaya_administrasi + biaya_program_hemat_kirim
 *                    + biaya_layanan_promo_xtra + biaya_proses_pesanan
 *                    + biaya_transaksi_spaylater + biaya_affiliate
 *
 * harga_modal_total  = harga_modal_per_item × qty
 *
 * profit             = total_harga_produk
 *                    - total_biaya_shopee
 *                    - harga_modal_total
 *
 * PENTING:
 * - total_harga_produk dari Shopee sudah final (sudah × qty)
 * - harga_modal_total yang perlu × qty
 */
export function hitungProfitShopee(params: {
  total_harga_produk: number
  qty: number
  harga_modal_per_item: number
  biaya_administrasi: number
  biaya_program_hemat_kirim: number
  biaya_layanan_promo_xtra_gratis_ongkir: number
  biaya_proses_pesanan: number
  biaya_transaksi_spaylater: number
  biaya_affiliate: number
}) {
  const {
    total_harga_produk,
    qty,
    harga_modal_per_item,
    biaya_administrasi,
    biaya_program_hemat_kirim,
    biaya_layanan_promo_xtra_gratis_ongkir,
    biaya_proses_pesanan,
    biaya_transaksi_spaylater,
    biaya_affiliate,
  } = params

  const harga_modal_total = harga_modal_per_item * qty

  const total_biaya_shopee =
    (biaya_administrasi || 0) +
    (biaya_program_hemat_kirim || 0) +
    (biaya_layanan_promo_xtra_gratis_ongkir || 0) +
    (biaya_proses_pesanan || 0) +
    (biaya_transaksi_spaylater || 0) +
    (biaya_affiliate || 0)

  const profit =
    total_harga_produk -
    total_biaya_shopee -
    harga_modal_total

  const margin_persen =
    total_harga_produk > 0
      ? (profit / total_harga_produk) * 100
      : 0

  return {
    harga_modal_total,
    total_biaya_shopee,
    profit,
    margin_persen,
  }
}

// ── Deteksi kolom SKU Induk dari header file Shopee ──────────────

/** Nama kolom SKU Induk yang biasa ada di export Shopee */
export const SHOPEE_SKU_INDUK_PATTERNS = [
  'sku induk',
  'sku_induk',
  'parent sku',
  'parent_sku',
  'sku produk induk',
  'sku_produk_induk',
]

/** Nama kolom lain yang sering ada di export Shopee */
export const SHOPEE_COLUMN_PATTERNS: Record<string, RegExp> = {
  order_id:            /no\.?\s*pesanan|order\s*id|nomor\s*pesanan/i,
  tanggal:             /waktu\s*pesanan|tgl\s*pesanan|tanggal|order\s*date/i,
  completed_at:        /waktu\s*selesai|completed|selesai/i,
  sku_induk:           /sku\s*induk|parent\s*sku/i,
  nama_produk:         /nama\s*produk|product\s*name|judul\s*produk/i,
  nama_variasi:        /nama\s*variasi|variasi|variant/i,
  qty:                 /^jumlah$|^qty$|kuantitas\s*produk/i,
  total_harga_produk:  /total\s*harga\s*produk|harga\s*produk\s*total/i,
  biaya_administrasi:  /biaya\s*administrasi|admin\s*fee/i,
  biaya_program_hemat_kirim: /program\s*hemat\s*kirim|hemat\s*kirim/i,
  biaya_layanan_promo_xtra_gratis_ongkir: /layanan\s*promo.*xtra|gratis\s*ongkir\s*xtra|promo\s*xtra/i,
  biaya_proses_pesanan: /biaya\s*proses\s*pesanan|proses\s*pesanan/i,
  biaya_transaksi_spaylater: /biaya\s*transaksi.*spaylater|spaylater/i,
  biaya_affiliate:     /biaya\s*affiliasi|biaya\s*affiliate|affiliate/i,
}

export function autoDetectShopeeColumns(headers: string[]): Record<string, number> {
  const result: Record<string, number> = {}

  headers.forEach((h, i) => {
    for (const [field, pattern] of Object.entries(SHOPEE_COLUMN_PATTERNS)) {
      if (pattern.test(h) && !(field in result)) {
        result[field] = i
        break
      }
    }
  })

  return result
}

export function detectSkuIndukColumn(headers: string[]): number | null {
  const normalized = headers.map(h => h.toLowerCase().trim())
  for (const pattern of SHOPEE_SKU_INDUK_PATTERNS) {
    const idx = normalized.indexOf(pattern)
    if (idx !== -1) return idx
  }
  return null
}
