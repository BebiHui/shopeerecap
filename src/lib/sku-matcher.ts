// src/lib/sku-matcher.ts
// Logika matching SKU — digunakan saat import Shopee
// Satu fungsi, konsisten, bisa dipakai server-side maupun client-side

import type { MasterSku, SkuMatchResult } from '@/types'

/**
 * Buat lookup map SKU → MasterSku untuk performa O(1).
 * Panggil sekali sebelum loop import.
 */
export function buildSkuMap(masterSkus: MasterSku[]): Map<string, MasterSku> {
  const map = new Map<string, MasterSku>()
  for (const m of masterSkus) {
    if (m.is_active) {
      // Key lowercase untuk case-insensitive matching
      map.set(m.sku.toLowerCase().trim(), m)
      // Juga index by sku_induk (secondary lookup)
      if (m.sku_induk) {
        const key = `__induk__${m.sku_induk.toLowerCase().trim()}`
        if (!map.has(key)) map.set(key, m)  // jangan override exact match
      }
    }
  }
  return map
}

/**
 * Cocokkan SKU dari transaksi Shopee ke master SKU.
 *
 * Prioritas:
 *  1. Exact match: sku → master_sku.sku
 *  2. Fallback: sku_induk → master_sku.sku_induk
 *
 * @returns SkuMatchResult dengan harga_modal = 0 jika tidak ditemukan
 */
export function matchSku(
  skuFromFile: string | null | undefined,
  skuIndukFromFile: string | null | undefined,
  skuMap: Map<string, MasterSku>
): SkuMatchResult {
  const skuClean      = (skuFromFile ?? '').trim()
  const skuIndukClean = (skuIndukFromFile ?? '').trim()

  // Prioritas 1: exact SKU match
  if (skuClean) {
    const found = skuMap.get(skuClean.toLowerCase())
    if (found) {
      return {
        matched: true,
        harga_modal: found.harga_modal,
        nama_produk: found.nama_produk,
        nama_variasi: found.nama_variasi ?? undefined,
        kategori: found.kategori ?? undefined,
      }
    }
  }

  // Prioritas 2: fallback ke sku_induk
  if (skuIndukClean) {
    const found = skuMap.get(`__induk__${skuIndukClean.toLowerCase()}`)
    if (found) {
      return {
        matched: true,
        harga_modal: found.harga_modal,
        nama_produk: found.nama_produk,
        nama_variasi: found.nama_variasi ?? undefined,
        kategori: found.kategori ?? undefined,
      }
    }
  }

  // Tidak ditemukan
  return { matched: false, harga_modal: 0 }
}

/**
 * Hitung derived fields setelah SKU match.
 * Rumus konsisten dengan hitungProfit() di types/index.ts
 */
export function hitungModalFields(
  qty: number,
  harga_modal: number,
  total_kotor: number,
  diskon_produk: number,
  voucher_shopee: number,
  biaya_admin: number,
  biaya_layanan: number,
  biaya_program: number,
  biaya_affiliate: number,
  ongkir_seller: number,
  biaya_iklan: number,
  total_diterima_manual: number | null
) {
  const total_modal         = qty * harga_modal
  const seller_burden_total = biaya_admin + biaya_layanan + biaya_program
                            + biaya_affiliate + ongkir_seller + voucher_shopee
  const total_payment       = (total_diterima_manual != null && total_diterima_manual > 0)
                            ? total_diterima_manual
                            : total_kotor - diskon_produk - seller_burden_total
  const total_operational   = seller_burden_total + biaya_iklan
  const profit_before_ads   = total_payment - total_modal - seller_burden_total
  const profit_net          = total_payment - total_modal - total_operational

  return {
    total_modal,
    seller_burden_total,
    total_payment,
    total_operational_cost: total_operational,
    profit_before_ads,
    profit_net,
  }
}

/**
 * Kolom Shopee export yang biasanya berisi SKU.
 * Urut berdasarkan prioritas (paling spesifik dulu).
 */
export const SHOPEE_SKU_COLUMNS = [
  'nomor referensi sku',
  'nomor_referensi_sku',
  'sku referensi',
  'sku_referensi',
  'sku induk',
  'sku_induk',
  'sku',
  'product sku',
  'product_sku',
  'item sku',
  'item_sku',
  'kode sku',
  'kode_sku',
] as const

export const SHOPEE_SKU_INDUK_COLUMNS = [
  'sku induk',
  'sku_induk',
  'parent sku',
  'parent_sku',
] as const

/**
 * Auto-detect kolom SKU dari header file Shopee
 */
export function detectSkuColumn(headers: string[]): number | null {
  const normalized = headers.map(h => h.toLowerCase().replace(/\s+/g, '_').trim())
  for (const candidate of SHOPEE_SKU_COLUMNS) {
    const idx = normalized.indexOf(candidate.replace(/\s/g, '_'))
    if (idx !== -1) return idx
  }
  return null
}

export function detectSkuIndukColumn(headers: string[]): number | null {
  const normalized = headers.map(h => h.toLowerCase().replace(/\s+/g, '_').trim())
  for (const candidate of SHOPEE_SKU_INDUK_COLUMNS) {
    const idx = normalized.indexOf(candidate.replace(/\s/g, '_'))
    if (idx !== -1) return idx
  }
  return null
}
