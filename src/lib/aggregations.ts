// src/lib/aggregations.ts
// ============================================================
// Reusable aggregation helpers — dipakai Dashboard, Rekap Harian,
// Rekap Profit, dan halaman lain yang butuh summary data.
//
// PENTING:
//   - Semua fungsi di sini di-scope ke user_id → aman multi-user
//   - Semua nilai selalu Number() → tidak ada NaN / undefined
//   - PRIMARY: baca dari Supabase VIEW (cepat, 1 query)
//   - FALLBACK: hitung langsung dari tabel mentah jika view belum ada
// ============================================================

import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Type Definitions ─────────────────────────────────────────

export interface TransactionSummary {
  omzet: number
  modal: number
  biaya_shopee: number
  profit: number          // profit transaksi (sebelum iklan)
  iklan: number
  net_profit: number      // profit - iklan
  total_transaksi: number
  total_item: number
}

export interface DailyRecapRow extends TransactionSummary {
  tanggal: string
  net_margin_persen: number
}

export interface MonthlyRecapRow extends TransactionSummary {
  bulan: string             // format: 'YYYY-MM'
  net_margin_persen: number
}

export interface SkuSummaryRow {
  sku_induk: string
  nama_produk: string
  total_qty: number
  omzet: number
  modal: number
  biaya_shopee: number
  profit: number
  total_transaksi: number
  last_sold_date: string
}

// ── Util ─────────────────────────────────────────────────────

/** Parse angka aman — tidak pernah NaN, fallback 0 */
function n(v: unknown): number {
  const x = Number(v ?? 0)
  return isNaN(x) ? 0 : x
}

const EMPTY_SUMMARY: TransactionSummary = {
  omzet: 0,
  modal: 0,
  biaya_shopee: 0,
  profit: 0,
  iklan: 0,
  net_profit: 0,
  total_transaksi: 0,
  total_item: 0,
}

// ── Primary: Baca dari VIEW ───────────────────────────────────

/**
 * Ambil summary transaksi dari view shopee_net_profit_harian.
 * Untuk rentang tanggal tertentu (harian / mingguan / bulanan).
 * FALLBACK: Jika view belum dibuat, hitung dari tabel mentah.
 */
export async function getTransactionSummaryByDateRange(
  userId: string,
  startDate: string,
  endDate: string
): Promise<TransactionSummary> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('shopee_net_profit_harian')
    .select(
      'profit_produk, total_iklan_harian, net_profit_harian, ' +
        'total_transaksi, total_omzet, total_modal_keluar'
    )
    .eq('user_id', userId)
    .gte('tanggal', startDate)
    .lte('tanggal', endDate)

  if (!error && data && data.length > 0) {
    return data.reduce(
      (acc, d) => ({
        omzet:           acc.omzet           + n(d.total_omzet),
        modal:           acc.modal           + n(d.total_modal_keluar),
        biaya_shopee:    acc.biaya_shopee,   // tidak tersedia di view ini
        profit:          acc.profit          + n(d.profit_produk),
        iklan:           acc.iklan           + n(d.total_iklan_harian),
        net_profit:      acc.net_profit      + n(d.net_profit_harian),
        total_transaksi: acc.total_transaksi + n(d.total_transaksi),
        total_item:      acc.total_item,
      }),
      { ...EMPTY_SUMMARY }
    )
  }

  if (error) {
    console.warn('[getTransactionSummaryByDateRange] View error, fallback:', error.message)
  }
  return _fallbackSummary(supabase, userId, startDate, endDate)
}

/**
 * Ambil rekap per hari dari view daily_summary_v2.
 * Dipakai oleh: /dashboard/daily-recap, /dashboard/profit-rekap
 * FALLBACK: Jika view belum dibuat, hitung dari tabel mentah.
 */
export async function getDailyRecap(
  userId: string,
  startDate: string,
  endDate: string
): Promise<DailyRecapRow[]> {
  const supabase = createClient()

  // PRIMARY: baca dari view daily_summary_v2
  const { data, error } = await supabase
    .from('daily_summary_v2')
    .select(
      'tanggal, total_omzet, profit_bersih, total_modal, ' +
        'total_biaya_shopee, total_iklan_harian, total_transaksi, total_item'
    )
    .eq('user_id', userId)
    .gte('tanggal', startDate)
    .lte('tanggal', endDate)
    .order('tanggal', { ascending: false })

  if (!error && data && data.length > 0) {
    return data.map((d) => {
      const profit = n(d.profit_bersih)
      const iklan  = n(d.total_iklan_harian)
      const net_profit = profit - iklan
      const omzet  = n(d.total_omzet)
      return {
        tanggal:          d.tanggal,
        omzet,
        modal:            n(d.total_modal),
        biaya_shopee:     n(d.total_biaya_shopee),
        profit,
        iklan,
        net_profit,
        total_transaksi:  n(d.total_transaksi),
        total_item:       n(d.total_item),
        net_margin_persen: omzet > 0
          ? parseFloat(((net_profit / omzet) * 100).toFixed(2))
          : 0,
      }
    })
  }

  if (error) {
    console.warn('[getDailyRecap] View error, fallback:', error.message)
  }
  return _fallbackDailyRecap(supabase, userId, startDate, endDate)
}

/**
 * Ambil rekap per bulan dari view shopee_net_profit_bulanan.
 * Dipakai oleh: /dashboard/profit-rekap
 * FALLBACK: Jika view belum ada, hitung dari tabel mentah.
 */
export async function getMonthlyRecap(
  userId: string,
  limitMonths = 12
): Promise<MonthlyRecapRow[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('shopee_net_profit_bulanan')
    .select(
      'bulan, profit_produk, total_iklan, net_profit, ' +
        'total_transaksi, total_omzet, total_modal_keluar, total_biaya_shopee'
    )
    .eq('user_id', userId)
    .order('bulan', { ascending: false })
    .limit(limitMonths)

  if (!error && data && data.length > 0) {
    return data.map((d) => {
      const net_profit = n(d.net_profit)
      const omzet      = n(d.total_omzet)
      return {
        bulan:            d.bulan,
        omzet,
        modal:            n(d.total_modal_keluar),
        biaya_shopee:     n(d.total_biaya_shopee ?? 0),
        profit:           n(d.profit_produk),
        iklan:            n(d.total_iklan),
        net_profit,
        total_transaksi:  n(d.total_transaksi),
        total_item:       0,
        net_margin_persen: omzet > 0
          ? parseFloat(((net_profit / omzet) * 100).toFixed(2))
          : 0,
      }
    })
  }

  if (error) console.warn('[getMonthlyRecap] View error, fallback:', error.message)
  return _fallbackMonthlyRecap(supabase, userId, limitMonths)
}

/**
 * Ambil ringkasan profit per SKU Induk dari view shopee_sku_summary.
 * FALLBACK: Hitung langsung dari tabel transactions jika view belum ada.
 */
export async function getSkuSummary(userId: string): Promise<SkuSummaryRow[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('shopee_sku_summary')
    .select(
      'sku_induk, nama_produk, total_qty, total_omzet, total_modal_keluar, ' +
        'total_biaya_shopee, total_profit, total_transaksi, last_sold_date'
    )
    .eq('user_id', userId)
    .order('total_profit', { ascending: false })

  if (!error && data && data.length > 0) {
    return data.map((d) => ({
      sku_induk:       d.sku_induk       ?? '—',
      nama_produk:     d.nama_produk     ?? '—',
      total_qty:       n(d.total_qty),
      omzet:           n(d.total_omzet),
      modal:           n(d.total_modal_keluar),
      biaya_shopee:    n(d.total_biaya_shopee),
      profit:          n(d.total_profit),
      total_transaksi: n(d.total_transaksi),
      last_sold_date:  d.last_sold_date ?? '',
    }))
  }

  if (error) console.warn('[getSkuSummary] View error, fallback:', error.message)
  return _fallbackSkuSummary(supabase, userId)
}

// ── FALLBACK: Kalkulasi Langsung dari Tabel Mentah ───────────

async function _fallbackSummary(
  supabase: SupabaseClient,
  userId: string,
  startDate: string,
  endDate: string
): Promise<TransactionSummary> {
  const [{ data: trx }, { data: ads }] = await Promise.all([
    supabase
      .from('transactions')
      .select(
        'profit, total_harga_produk, harga_modal_total, ' +
          'harga_modal_per_item, qty, total_biaya_shopee'
      )
      .eq('user_id', userId)
      .gte('tanggal', startDate)
      .lte('tanggal', endDate),
    supabase
      .from('daily_ads_cost')
      .select('total_iklan')
      .eq('user_id', userId)
      .gte('tanggal', startDate)
      .lte('tanggal', endDate),
  ])

  const omzet       = (trx ?? []).reduce((s, t) => s + n(t.total_harga_produk), 0)
  const modal       = (trx ?? []).reduce((s, t) => {
    const m = t.harga_modal_total != null
      ? n(t.harga_modal_total)
      : n(t.harga_modal_per_item) * n(t.qty)
    return s + m
  }, 0)
  const biaya_shopee = (trx ?? []).reduce((s, t) => s + n(t.total_biaya_shopee), 0)
  const profit       = (trx ?? []).reduce((s, t) => s + n(t.profit), 0)
  const iklan        = (ads ?? []).reduce((s, a) => s + n(a.total_iklan), 0)

  return {
    omzet,
    modal,
    biaya_shopee,
    profit,
    iklan,
    net_profit:      profit - iklan,
    total_transaksi: (trx ?? []).length,
    total_item:      (trx ?? []).reduce((s, t) => s + n(t.qty), 0),
  }
}

async function _fallbackDailyRecap(
  supabase: SupabaseClient,
  userId: string,
  startDate: string,
  endDate: string
): Promise<DailyRecapRow[]> {
  const [{ data: trx }, { data: ads }] = await Promise.all([
    supabase
      .from('transactions')
      .select(
        'tanggal, profit, total_harga_produk, harga_modal_total, ' +
          'harga_modal_per_item, qty, total_biaya_shopee'
      )
      .eq('user_id', userId)
      .gte('tanggal', startDate)
      .lte('tanggal', endDate),
    supabase
      .from('daily_ads_cost')
      .select('tanggal, total_iklan')
      .eq('user_id', userId)
      .gte('tanggal', startDate)
      .lte('tanggal', endDate),
  ])

  const byDate: Record<string, DailyRecapRow> = {}

  for (const t of trx ?? []) {
    const tgl = t.tanggal as string
    if (!byDate[tgl]) {
      byDate[tgl] = {
        tanggal: tgl,
        omzet: 0, modal: 0, biaya_shopee: 0,
        profit: 0, iklan: 0, net_profit: 0,
        total_transaksi: 0, total_item: 0, net_margin_persen: 0,
      }
    }
    const modal = t.harga_modal_total != null
      ? n(t.harga_modal_total)
      : n(t.harga_modal_per_item) * n(t.qty)

    byDate[tgl].omzet           += n(t.total_harga_produk)
    byDate[tgl].modal           += modal
    byDate[tgl].biaya_shopee    += n(t.total_biaya_shopee)
    byDate[tgl].profit          += n(t.profit)
    byDate[tgl].total_transaksi += 1
    byDate[tgl].total_item      += n(t.qty)
  }

  for (const a of ads ?? []) {
    const tgl = a.tanggal as string
    if (byDate[tgl]) byDate[tgl].iklan += n(a.total_iklan)
  }

  for (const row of Object.values(byDate)) {
    row.net_profit        = row.profit - row.iklan
    row.net_margin_persen = row.omzet > 0
      ? parseFloat(((row.net_profit / row.omzet) * 100).toFixed(2))
      : 0
  }

  return Object.values(byDate).sort((a, b) => b.tanggal.localeCompare(a.tanggal))
}

async function _fallbackMonthlyRecap(
  supabase: SupabaseClient,
  userId: string,
  limitMonths: number
): Promise<MonthlyRecapRow[]> {
  // Hitung startDate: limitMonths bulan yang lalu
  const d = new Date()
  d.setMonth(d.getMonth() - limitMonths)
  const startDate = d.toISOString().slice(0, 7) + '-01'

  const [{ data: trx }, { data: ads }] = await Promise.all([
    supabase
      .from('transactions')
      .select(
        'tanggal, profit, total_harga_produk, harga_modal_total, ' +
          'harga_modal_per_item, qty, total_biaya_shopee'
      )
      .eq('user_id', userId)
      .gte('tanggal', startDate)
      .limit(10000),
    supabase
      .from('daily_ads_cost')
      .select('tanggal, total_iklan')
      .eq('user_id', userId)
      .gte('tanggal', startDate),
  ])

  // Group transactions by month (YYYY-MM)
  const byMonth: Record<string, MonthlyRecapRow> = {}

  for (const t of trx ?? []) {
    const bulan = (t.tanggal as string).slice(0, 7)  // 'YYYY-MM'
    if (!byMonth[bulan]) {
      byMonth[bulan] = {
        bulan, omzet: 0, modal: 0, biaya_shopee: 0,
        profit: 0, iklan: 0, net_profit: 0,
        total_transaksi: 0, total_item: 0, net_margin_persen: 0,
      }
    }
    const modal = t.harga_modal_total != null
      ? n(t.harga_modal_total)
      : n(t.harga_modal_per_item) * n(t.qty)

    byMonth[bulan].omzet           += n(t.total_harga_produk)
    byMonth[bulan].modal           += modal
    byMonth[bulan].biaya_shopee    += n(t.total_biaya_shopee)
    byMonth[bulan].profit          += n(t.profit)
    byMonth[bulan].total_transaksi += 1
    byMonth[bulan].total_item      += n(t.qty)
  }

  // Group ads by month — SUM per bulan (unique hari, bukan per transaksi)
  const adsByDate: Record<string, number> = {}
  for (const a of ads ?? []) {
    const tgl = a.tanggal as string
    // Kalau ada duplikat tanggal (seharusnya tidak), ambil yang terbesar
    adsByDate[tgl] = Math.max(adsByDate[tgl] ?? 0, n(a.total_iklan))
  }
  for (const [tgl, val] of Object.entries(adsByDate)) {
    const bulan = tgl.slice(0, 7)
    if (byMonth[bulan]) byMonth[bulan].iklan += val
  }

  // Hitung net_profit dan margin per bulan
  for (const row of Object.values(byMonth)) {
    row.net_profit        = row.profit - row.iklan
    row.net_margin_persen = row.omzet > 0
      ? parseFloat(((row.net_profit / row.omzet) * 100).toFixed(2))
      : 0
  }

  return Object.values(byMonth)
    .sort((a, b) => b.bulan.localeCompare(a.bulan))
    .slice(0, limitMonths)
}

async function _fallbackSkuSummary(
  supabase: SupabaseClient,
  userId: string
): Promise<SkuSummaryRow[]> {
  const { data: trx } = await supabase
    .from('transactions')
    .select(
      'sku_induk, nama_produk, profit, total_harga_produk, ' +
        'harga_modal_total, harga_modal_per_item, qty, total_biaya_shopee, tanggal'
    )
    .eq('user_id', userId)
    .limit(10000)

  const bySku: Record<string, SkuSummaryRow> = {}

  for (const t of trx ?? []) {
    const key = (t.sku_induk as string) || '(tanpa SKU)'
    if (!bySku[key]) {
      bySku[key] = {
        sku_induk:       t.sku_induk    ?? '—',
        nama_produk:     t.nama_produk  ?? '—',
        total_qty:       0,
        omzet:           0,
        modal:           0,
        biaya_shopee:    0,
        profit:          0,
        total_transaksi: 0,
        last_sold_date:  t.tanggal ?? '',
      }
    }

    const modal = t.harga_modal_total != null
      ? n(t.harga_modal_total)
      : n(t.harga_modal_per_item) * n(t.qty)

    bySku[key].total_qty       += n(t.qty)
    bySku[key].omzet           += n(t.total_harga_produk)
    bySku[key].modal           += modal
    bySku[key].biaya_shopee    += n(t.total_biaya_shopee)
    bySku[key].profit          += n(t.profit)
    bySku[key].total_transaksi += 1

    // Simpan tanggal terbaru
    if ((t.tanggal ?? '') > bySku[key].last_sold_date) {
      bySku[key].last_sold_date = t.tanggal ?? ''
    }
  }

  return Object.values(bySku).sort((a, b) => b.profit - a.profit)
}
