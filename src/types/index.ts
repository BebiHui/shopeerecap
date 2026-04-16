// src/types/index.ts — v8

// ── Auth & Profile ────────────────────────────────────────────
export interface Profile {
  id: string
  store_name: string
  owner_name: string | null
  phone: string | null
  created_at: string
  updated_at: string
}

// ── Product (master produk lama — tetap dipertahankan) ────────
export interface Product {
  id: string
  user_id: string
  name: string
  sku: string | null
  default_price: number
  default_modal: number
  category: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// ── Master Harga Modal ────────────────────────────────────────
export interface MasterHargaModal {
  id: string
  user_id: string
  sku_induk: string
  nama_produk: string
  nama_variasi: string | null
  harga_modal: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MasterHargaModalFormData {
  sku_induk: string
  nama_produk: string
  nama_variasi: string
  harga_modal: number
  is_active: boolean
}

export interface HargaModalHistory {
  id: string
  user_id: string
  sku_induk: string
  harga_modal_lama: number
  harga_modal_baru: number
  changed_at: string
}

// ── Transaction — tabel utama ─────────────────────────────────
export interface Transaction {
  id: string
  user_id: string

  // Dari file Shopee
  order_id: string
  status_pesanan: string | null
  no_resi: string | null
  opsi_pengiriman: string | null
  waktu_pesanan_dibuat: string | null
  metode_pembayaran: string | null
  sku_induk: string | null
  nama_produk: string
  qty: number
  total_harga_produk: number
  voucher_ditanggung_penjual: number

  // Harga modal snapshot (diisi saat import)
  harga_modal_per_item: number
  harga_modal_total: number          // snapshot: harga_modal_per_item × qty

  // ── 6 Biaya Shopee (diisi manual setelah import) ─────────
  biaya_administrasi: number
  biaya_program_hemat_biaya_kirim: number
  biaya_layanan_promo_xtra_gratis_ongkir_xtra: number
  biaya_proses_pesanan: number
  biaya_transaksi_spaylater: number
  biaya_ams: number

  // Flag matching
  unmatched_modal: boolean

  // Kolom lama (backward compat — tidak dipakai di UI/kalkulasi baru)
  tanggal?: string
  harga_jual?: number
  harga_modal?: number
  nama_pembeli?: string | null
  variasi?: string | null
  catatan?: string | null

  created_at: string
  updated_at: string
}

// ── Form data transaksi MANUAL ────────────────────────────────
export interface TransactionFormData {
  // Dasar
  tanggal: string
  order_id: string
  nama_pembeli: string
  sku_induk: string
  nama_produk: string
  variasi: string
  qty: number

  // Revenue & modal
  total_harga_produk: number        // harga jual total (sudah final)
  voucher_ditanggung_penjual: number
  harga_modal_per_item: number      // harga modal per item

  // 6 biaya Shopee
  biaya_administrasi: number
  biaya_program_hemat_biaya_kirim: number
  biaya_layanan_promo_xtra_gratis_ongkir_xtra: number
  biaya_proses_pesanan: number
  biaya_transaksi_spaylater: number
  biaya_ams: number

  catatan: string
}

// ── Hasil kalkulasi profit ────────────────────────────────────
export interface ProfitCalc {
  // Input yang dipakai
  total_harga_produk:         number  // dari field form langsung
  harga_modal_total:          number  // harga_modal_per_item × qty
  total_biaya_shopee:         number  // voucher + 6 biaya

  // Output
  profit_bersih:  number
  margin_persen:  number

  // Breakdown setiap komponen pengurang — tidak pernah undefined
  breakdown: {
    voucher_ditanggung_penjual:               number
    biaya_administrasi:                       number
    biaya_program_hemat_biaya_kirim:          number
    biaya_layanan_promo_xtra_gratis_ongkir_xtra: number
    biaya_proses_pesanan:                     number
    biaya_transaksi_spaylater:                number
    biaya_ams:                                number
  }
}

/**
 * SATU-SATUNYA fungsi kalkulasi profit — dipakai di seluruh aplikasi.
 *
 * Formula:
 *   harga_modal_total  = harga_modal_per_item × qty
 *
 *   total_biaya_shopee = voucher_ditanggung_penjual
 *                      + biaya_administrasi
 *                      + biaya_program_hemat_biaya_kirim
 *                      + biaya_layanan_promo_xtra_gratis_ongkir_xtra
 *                      + biaya_proses_pesanan
 *                      + biaya_transaksi_spaylater
 *                      + biaya_ams
 *
 *   profit_bersih      = total_harga_produk
 *                      - harga_modal_total
 *                      - total_biaya_shopee
 *
 * Catatan: total_harga_produk dari Shopee sudah FINAL (sudah include qty).
 * harga_modal_total yang perlu dikali qty secara eksplisit.
 *
 * Fungsi SELALU return object valid — tidak pernah throw atau return undefined.
 */
export function hitungProfit(t: Partial<TransactionFormData & Transaction>): ProfitCalc {
  // Normalisasi semua input — Number(x ?? 0) aman untuk undefined/null/string
  const qty                = Number(t.qty                          ?? 0) || 0
  const total_harga_produk = Number(t.total_harga_produk          ?? 0) || 0
  const harga_modal_per_item = Number(t.harga_modal_per_item      ?? 0) || 0

  const voucher            = Number(t.voucher_ditanggung_penjual   ?? 0) || 0
  const b_admin            = Number(t.biaya_administrasi           ?? 0) || 0
  const b_hemat_kirim      = Number(t.biaya_program_hemat_biaya_kirim ?? 0) || 0
  const b_xtra             = Number(t.biaya_layanan_promo_xtra_gratis_ongkir_xtra ?? 0) || 0
  const b_proses           = Number(t.biaya_proses_pesanan         ?? 0) || 0
  const b_spaylater        = Number(t.biaya_transaksi_spaylater    ?? 0) || 0
  const b_ams              = Number(t.biaya_ams                    ?? 0) || 0

  // Derived
  const harga_modal_total = harga_modal_per_item * qty

  const total_biaya_shopee =
    voucher + b_admin + b_hemat_kirim + b_xtra + b_proses + b_spaylater + b_ams

  const profit_bersih = total_harga_produk - harga_modal_total - total_biaya_shopee

  const margin_persen = total_harga_produk > 0
    ? (profit_bersih / total_harga_produk) * 100
    : 0

  return {
    total_harga_produk,
    harga_modal_total,
    total_biaya_shopee,
    profit_bersih,
    margin_persen,
    // Breakdown: setiap komponen pengurang — breakdown SELALU ada
    breakdown: {
      voucher_ditanggung_penjual:               voucher,
      biaya_administrasi:                       b_admin,
      biaya_program_hemat_biaya_kirim:          b_hemat_kirim,
      biaya_layanan_promo_xtra_gratis_ongkir_xtra: b_xtra,
      biaya_proses_pesanan:                     b_proses,
      biaya_transaksi_spaylater:                b_spaylater,
      biaya_ams:                                b_ams,
    },
  }
}

// ── Daily Ads Cost ────────────────────────────────────────────
export interface DailyAdsCost {
  id: string
  user_id: string
  tanggal: string
  total_iklan: number
  catatan: string | null
  created_at: string
  updated_at: string
}

export interface DailyAdsCostFormData {
  tanggal: string
  total_iklan: number
  catatan: string
}

// ── View types ────────────────────────────────────────────────
export interface DailyNetProfit {
  user_id: string
  tanggal: string
  total_transaksi: number
  total_qty: number
  total_omzet: number
  total_modal: number
  total_voucher: number
  total_biaya_administrasi: number
  total_biaya_hemat_kirim: number
  total_biaya_xtra: number
  total_biaya_proses: number
  total_biaya_spaylater: number
  total_biaya_ams: number
  total_biaya_shopee: number
  profit_transaksi: number
  total_iklan_harian: number
  catatan_iklan: string
  net_profit_harian: number
  total_unmatched: number
  match_rate_pct: number
}

export interface SkuSummary {
  user_id: string
  sku_induk: string
  nama_produk: string
  harga_modal_master: number | null
  total_qty: number
  total_omzet: number
  total_modal: number
  total_voucher: number
  total_biaya_shopee: number
  total_profit: number
  total_transaksi: number
  last_sold_date: string
  trx_unmatched: number
}

export interface PeriodeSummary {
  profit_transaksi: number
  total_iklan: number
  net_profit: number
  total_transaksi: number
  total_omzet: number
  total_modal: number
  total_biaya_shopee: number
}

// ── Import types ──────────────────────────────────────────────
export interface ImportResult {
  total_rows: number
  success: number
  skipped: number
  matched_modal: number
  unmatched_modal: number
  match_rate: number
  total_modal_terhitung: number
  errors: string[]
}

// ── Unmatched Modal ───────────────────────────────────────────
export interface UnmatchedModalItem {
  id: string
  user_id: string
  import_id: string | null
  shopee_trx_id: string | null
  raw_order_id: string | null
  raw_sku_induk: string | null
  nama_produk: string | null
  qty: number
  total_harga_produk: number
  resolved: boolean
  resolved_sku_induk: string | null
  resolved_at: string | null
  created_at: string
}
