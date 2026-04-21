// src/lib/shopee-import.ts
// Parser + business logic untuk import transaksi harian Shopee.
// Tidak ada dependency UI — bisa dipakai di server maupun client.

import * as XLSX from 'xlsx'
import {
  calculateDefaultShopeeCosts,
  calculateImportProfit,
} from '@/lib/shopee-costs'

// ── Tipe data hasil parse ─────────────────────────────────────

export interface ShopeeRow {
  order_id: string
  status_pesanan: string | null
  no_resi: string | null
  opsi_pengiriman: string | null
  waktu_pesanan_dibuat: string | null
  metode_pembayaran: string | null
  sku_induk: string | null
  nama_produk: string | null
  qty: number
  total_harga_produk: number
  voucher_ditanggung_penjual: number
  /** baris asli dari file untuk debugging */
  _row_index: number
}

export interface ImportSummary {
  total_rows: number
  inserted: number
  duplicates: number  // order_id sudah ada di DB — dilewati, TIDAK diupdate
  matched_modal: number
  unmatched_modal: number
  skipped: number     // baris invalid / order_id kosong saat parsing
  errors: string[]    // max 20 error messages
}

// ── Peta nama kolom Shopee → field internal ───────────────────

const COLUMN_MAP: Record<string, keyof ShopeeRow> = {
  'no. pesanan': 'order_id',
  'no pesanan': 'order_id',
  'nomor pesanan': 'order_id',
  'order id': 'order_id',
  'order_id': 'order_id',

  'status pesanan': 'status_pesanan',
  'status_pesanan': 'status_pesanan',
  'status': 'status_pesanan',

  'no. resi': 'no_resi',
  'no resi': 'no_resi',
  'nomor resi': 'no_resi',
  'resi': 'no_resi',
  'no_resi': 'no_resi',

  'opsi pengiriman': 'opsi_pengiriman',
  'opsi_pengiriman': 'opsi_pengiriman',
  'jasa pengiriman': 'opsi_pengiriman',
  'pengiriman': 'opsi_pengiriman',

  'waktu pesanan dibuat': 'waktu_pesanan_dibuat',
  'waktu_pesanan_dibuat': 'waktu_pesanan_dibuat',
  'tanggal pesanan': 'waktu_pesanan_dibuat',
  'waktu transaksi': 'waktu_pesanan_dibuat',
  'order date': 'waktu_pesanan_dibuat',

  'metode pembayaran': 'metode_pembayaran',
  'metode_pembayaran': 'metode_pembayaran',
  'payment method': 'metode_pembayaran',

  'sku induk': 'sku_induk',
  'sku_induk': 'sku_induk',
  'parent sku': 'sku_induk',
  'sku': 'sku_induk',

  'nama produk': 'nama_produk',
  'nama_produk': 'nama_produk',
  'product name': 'nama_produk',
  'produk': 'nama_produk',

  'jumlah': 'qty',
  'qty': 'qty',
  'kuantitas': 'qty',
  'quantity': 'qty',

  'total harga produk': 'total_harga_produk',
  'total_harga_produk': 'total_harga_produk',
  'total harga': 'total_harga_produk',
  'harga produk': 'total_harga_produk',

  // Kolom format baru Shopee — diperlakukan sama dengan "Total Harga Produk"
  'harga setelah diskon': 'total_harga_produk',
  'harga_setelah_diskon': 'total_harga_produk',

  'voucher ditanggung penjual': 'voucher_ditanggung_penjual',
  'voucher_ditanggung_penjual': 'voucher_ditanggung_penjual',
  'voucher penjual': 'voucher_ditanggung_penjual',
  'diskon penjual': 'voucher_ditanggung_penjual',
}

// ── Helper tanggal ────────────────────────────────────────────

/**
 * Ambil tanggal YYYY-MM-DD dari kolom "Waktu Pesanan Dibuat" Shopee.
 *
 * Format yang didukung (semua dari export Shopee):
 *   1. YYYY-MM-DD HH:mm:ss  → "2024-01-15 10:30:00"
 *   2. YYYY-MM-DD           → "2024-01-15"
 *   3. DD/MM/YYYY HH:mm     → "15/01/2024 10:30"
 *   4. DD/MM/YYYY           → "15/01/2024"
 *
 * Selalu mengembalikan string "YYYY-MM-DD" atau null jika tidak bisa diparse.
 * Tidak pernah fallback ke tanggal hari ini.
 */
function parseTanggalOnly(value: string | null | undefined): string | null {
  if (!value) return null

  const raw = String(value).trim()
  if (!raw) return null

  // ── 1. Sudah dalam format ISO: YYYY-MM-DD (± waktu) ──────────
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch
    // Validasi rentang sederhana
    const y = parseInt(yyyy, 10)
    const m = parseInt(mm, 10)
    const d = parseInt(dd, 10)
    if (y >= 2010 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${yyyy}-${mm}-${dd}`
    }
  }

  // ── 2. Format DD/MM/YYYY (± spasi + waktu) ───────────────────
  const dmyMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (dmyMatch) {
    const [, dd, mm, yyyy] = dmyMatch
    const y = parseInt(yyyy, 10)
    const m = parseInt(mm, 10)
    const d = parseInt(dd, 10)
    if (y >= 2010 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
    }
  }

  // ── 3. Last-resort: JS Date parse ────────────────────────────
  //    Hanya dipakai jika dua format di atas tidak cocok.
  const parsed = new Date(raw)
  if (!isNaN(parsed.getTime())) {
    const iso = parsed.toISOString().slice(0, 10)  // "YYYY-MM-DD"
    // Sanity check tahun
    const y = parseInt(iso.slice(0, 4), 10)
    if (y >= 2010 && y <= 2100) return iso
  }

  return null
}

// ── Parse file → array ShopeeRow ─────────────────────────────

export function parseShopeeFile(
  buffer: ArrayBuffer,
  filename: string
): { rows: ShopeeRow[]; errors: string[]; headers: string[] } {
  const wb = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    raw: false,
    dateNF: 'yyyy-mm-dd hh:mm:ss',
    cellDates: false,
  })

  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
  }) as string[][]

  if (raw.length < 2) {
    return {
      rows: [],
      errors: ['File kosong atau tidak ada data setelah header.'],
      headers: [],
    }
  }

  const headerRow = (raw[0] ?? []).map((h) => String(h ?? '').toLowerCase().trim())
  const errors: string[] = []
  const rows: ShopeeRow[] = []

  const colIndex: Record<number, keyof ShopeeRow> = {}
  headerRow.forEach((h, i) => {
    const mapped = COLUMN_MAP[h]
    if (mapped) colIndex[i] = mapped
  })

  const hasOrderId = Object.values(colIndex).includes('order_id')
  if (!hasOrderId) {
    errors.push('Kolom "No. Pesanan" tidak ditemukan. Periksa nama header file.')
    return { rows: [], errors, headers: headerRow }
  }

  for (let ri = 1; ri < raw.length; ri++) {
    const cells = raw[ri] ?? []

    if (cells.every((c) => !c || String(c).trim() === '')) continue

    const rec: Partial<ShopeeRow> = { _row_index: ri + 1 }

    Object.entries(colIndex).forEach(([ci, field]) => {
      const rawVal = String(cells[parseInt(ci)] ?? '').trim()

      if (
        field === 'qty' ||
        field === 'total_harga_produk' ||
        field === 'voucher_ditanggung_penjual'
      ) {
        const cleaned = rawVal.replace(/\./g, '').replace(/,/g, '.')
        ;(rec as any)[field] = parseFloat(cleaned) || 0
      } else {
        ;(rec as any)[field] = rawVal || null
      }
    })

    const orderId = (rec.order_id ?? '').trim()
    if (!orderId) {
      errors.push(`Baris ${ri + 1}: "No. Pesanan" kosong — dilewati`)
      continue
    }

    rows.push({
      order_id: orderId,
      status_pesanan: rec.status_pesanan ?? null,
      no_resi: rec.no_resi ?? null,
      opsi_pengiriman: rec.opsi_pengiriman ?? null,
      waktu_pesanan_dibuat: rec.waktu_pesanan_dibuat ?? null,
      metode_pembayaran: rec.metode_pembayaran ?? null,
      sku_induk: rec.sku_induk ?? null,
      nama_produk: rec.nama_produk ?? null,
      qty: Math.max(1, rec.qty ?? 1),
      total_harga_produk: rec.total_harga_produk ?? 0,
      voucher_ditanggung_penjual: rec.voucher_ditanggung_penjual ?? 0,
      _row_index: ri + 1,
    })
  }

  return { rows, errors: errors.slice(0, 20), headers: headerRow }
}

// ── Build transaction payload ─────────────────────────────────

export interface MasterModalMap {
  get(skuInduk: string): { harga_modal: number; nama_produk: string } | undefined
}

export function buildTransactionPayload(
  row: ShopeeRow,
  userId: string,
  modalMap: Map<string, { harga_modal: number; nama_produk: string }>
) {
  // ── 1. Matching harga modal ─────────────────────────────────
  const skuKey = (row.sku_induk ?? '').toLowerCase().trim()
  const master = skuKey ? modalMap.get(skuKey) : undefined

  const harga_modal_per_item = master?.harga_modal ?? 0
  const unmatched_modal      = !master

  // ── 2. Total harga produk = harga per unit × qty ───────────
  //    File Shopee menyimpan "Total Harga Produk" sebagai HARGA PER UNIT.
  //    Kita perlu kalikan dengan qty untuk mendapat total revenue yang benar.
  //    Contoh: qty=2, harga/unit=125.965 → total_harga_produk = 251.930
  const total_harga_produk = row.total_harga_produk * row.qty

  // ── 3. Hitung biaya Shopee default secara otomatis ──────────
  //    Berdasarkan total_harga_produk (sudah × qty), voucher, dan metode pembayaran.
  //    Jika metode pembayaran mengandung "SPayLater", biaya_transaksi_spaylater
  //    dihitung otomatis sebesar 2.5% × total_harga_produk.
  const costs = calculateDefaultShopeeCosts(
    total_harga_produk,
    row.voucher_ditanggung_penjual,
    row.metode_pembayaran
  )

  // ── 4. Hitung profit awal ───────────────────────────────────
  //    profit = total_harga_produk - harga_modal_total - total_biaya_shopee
  const { harga_modal_total, profit } = calculateImportProfit(
    total_harga_produk,
    row.qty,
    harga_modal_per_item,
    costs
  )

  return {
    user_id:   userId,
    order_id:  row.order_id,
    tanggal:   parseTanggalOnly(row.waktu_pesanan_dibuat),

    // Metadata dari file Shopee
    status_pesanan:       row.status_pesanan,
    no_resi:              row.no_resi,
    opsi_pengiriman:      row.opsi_pengiriman,
    waktu_pesanan_dibuat: row.waktu_pesanan_dibuat,
    metode_pembayaran:    row.metode_pembayaran,
    sku_induk:            row.sku_induk,
    nama_produk:          row.nama_produk ?? master?.nama_produk ?? null,
    qty:                  row.qty,

    // Revenue (total sudah × qty)
    total_harga_produk,
    voucher_ditanggung_penjual: row.voucher_ditanggung_penjual,

    // Harga modal
    harga_modal_per_item,
    harga_modal_total,
    unmatched_modal,

    // ── Biaya Shopee (dihitung otomatis) ─────────────────────
    //    User bisa override manual setelah import jika nilai
    //    aktual dari Shopee berbeda.
    biaya_administrasi:                          costs.biaya_administrasi,
    biaya_program_hemat_biaya_kirim:             costs.biaya_program_hemat_biaya_kirim,
    biaya_layanan_promo_xtra_gratis_ongkir_xtra: costs.biaya_layanan_promo_xtra_gratis_ongkir_xtra,
    biaya_proses_pesanan:                        costs.biaya_proses_pesanan,
    biaya_transaksi_spaylater:                   costs.biaya_transaksi_spaylater,
    biaya_ams:                                   costs.biaya_ams,

    total_biaya_shopee: costs.total_biaya_shopee,
    profit,
  }
}