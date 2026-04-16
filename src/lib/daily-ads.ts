// src/lib/daily-ads.ts
// Helper functions untuk daily_ads_cost & net profit
// Semua query di-scope ke user_id — aman per user

import { createClient } from '@/lib/supabase/client'

// ── CRUD daily_ads_cost ───────────────────────────────────────

/**
 * Upsert iklan harian.
 * Jika tanggal sama sudah ada → UPDATE (tidak duplicate insert).
 * Constraint DB: UNIQUE(user_id, tanggal)
 */
export async function upsertDailyAds(
  userId: string,
  data: { tanggal: string; total_iklan: number; catatan?: string | null }
) {
  const supabase = createClient()
  const { data: result, error } = await supabase
    .from('daily_ads_cost')
    .upsert(
      {
        user_id: userId,
        tanggal: data.tanggal,
        total_iklan: data.total_iklan,
        catatan: data.catatan?.trim() || null,
      },
      { onConflict: 'user_id,tanggal' }
    )
    .select('*')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: result, error: null }
}

/** Get iklan harian untuk satu tanggal */
export async function getDailyAds(userId: string, tanggal: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('daily_ads_cost')
    .select('*')
    .eq('user_id', userId)
    .eq('tanggal', tanggal)
    .maybeSingle()
  return data
}

/** List iklan harian dalam rentang tanggal, order terbaru di atas */
export async function listDailyAds(userId: string, from?: string, to?: string) {
  const supabase = createClient()
  let q = supabase
    .from('daily_ads_cost')
    .select('*')
    .eq('user_id', userId)
    .order('tanggal', { ascending: false })

  if (from) q = q.gte('tanggal', from)
  if (to) q = q.lte('tanggal', to)

  const { data } = await q.limit(365)
  return data ?? []
}

/** Hapus iklan harian by ID (internal, tidak di-export) */
async function deleteDailyAds(userId: string, id: string) {
  const supabase = createClient()
  const { error } = await supabase
    .from('daily_ads_cost')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  return error?.message ?? null
}

// ── Net Profit Summary ────────────────────────────────────────

export interface NetProfitSummary {
  profit_produk: number
  total_iklan: number
  net_profit: number
  total_transaksi: number
  total_omzet: number
  total_modal_keluar: number
}

const EMPTY_SUMMARY: NetProfitSummary = {
  profit_produk: 0,
  total_iklan: 0,
  net_profit: 0,
  total_transaksi: 0,
  total_omzet: 0,
  total_modal_keluar: 0,
}

/**
 * Ambil net profit summary dari view shopee_net_profit_harian.
 * Net profit = profit transaksi - iklan harian.
 * Satu query, tidak double count — view sudah handle join.
 *
 * FALLBACK OTOMATIS: Jika view belum ada / error, hitung langsung
 * dari tabel `transactions` + `daily_ads_cost`.
 */
export async function getNetProfitSummary(
  userId: string,
  from: string,
  to: string
): Promise<NetProfitSummary> {
  const supabase = createClient()

  // ── PRIMARY: baca dari view shopee_net_profit_harian ─────────
  const { data, error } = await supabase
    .from('shopee_net_profit_harian')
    .select(
      'profit_produk, total_iklan_harian, net_profit_harian, ' +
        'total_transaksi, total_omzet, total_modal_keluar'
    )
    .eq('user_id', userId)
    .gte('tanggal', from)
    .lte('tanggal', to)

  if (!error && data && data.length > 0) {
    // Reduce sekali — tidak ada query tambahan
    return data.reduce(
      (acc, d) => ({
        profit_produk: acc.profit_produk + Number(d.profit_produk ?? 0),
        total_iklan: acc.total_iklan + Number(d.total_iklan_harian ?? 0),
        net_profit: acc.net_profit + Number(d.net_profit_harian ?? 0),
        total_transaksi: acc.total_transaksi + Number(d.total_transaksi ?? 0),
        total_omzet: acc.total_omzet + Number(d.total_omzet ?? 0),
        total_modal_keluar: acc.total_modal_keluar + Number(d.total_modal_keluar ?? 0),
      }),
      { ...EMPTY_SUMMARY }
    )
  }

  // ── FALLBACK: View tidak ada / belum dibuat / error ──────────
  // Hitung langsung dari tabel mentah transactions + daily_ads_cost
  if (error) {
    console.warn(
      '[getNetProfitSummary] View shopee_net_profit_harian error, pakai fallback:',
      error.message,
      '→ Jalankan FIX_VIEWS_SUPABASE.sql di SQL Editor Supabase!'
    )
  }

  const [{ data: trx }, { data: ads }] = await Promise.all([
    supabase
      .from('transactions')
      .select(
        'profit, total_harga_produk, harga_modal_total, harga_modal_per_item, qty'
      )
      .eq('user_id', userId)
      .gte('tanggal', from)
      .lte('tanggal', to),
    supabase
      .from('daily_ads_cost')
      .select('total_iklan')
      .eq('user_id', userId)
      .gte('tanggal', from)
      .lte('tanggal', to),
  ])

  const n = (v: unknown) => {
    const x = Number(v ?? 0)
    return isNaN(x) ? 0 : x
  }

  const profit_produk = (trx ?? []).reduce((s, t) => s + n(t.profit), 0)
  const total_omzet = (trx ?? []).reduce((s, t) => s + n(t.total_harga_produk), 0)
  const total_modal_keluar = (trx ?? []).reduce((s, t) => {
    // Gunakan harga_modal_total jika ada, fallback kalkulasi manual
    const modal = t.harga_modal_total != null
      ? n(t.harga_modal_total)
      : n(t.harga_modal_per_item) * n(t.qty)
    return s + modal
  }, 0)
  const total_transaksi = (trx ?? []).length
  const total_iklan = (ads ?? []).reduce((s, a) => s + n(a.total_iklan), 0)
  const net_profit = profit_produk - total_iklan

  return {
    profit_produk,
    total_iklan,
    net_profit,
    total_transaksi,
    total_omzet,
    total_modal_keluar,
  }
}

// ── SKU Lookup ────────────────────────────────────────────────

/**
 * Lookup harga modal dari master_harga_modal berdasarkan sku_induk.
 * Scoped ke user_id — aman.
 * Case-insensitive exact match (ilike dengan trim).
 */
export async function lookupHargaModalBySku(userId: string, skuInduk: string) {
  const trimmed = skuInduk.trim()
  if (!trimmed) return null

  const supabase = createClient()
  const { data } = await supabase
    .from('master_harga_modal')
    .select('harga_modal, nama_produk, nama_variasi')
    .eq('user_id', userId)
    .eq('is_active', true)
    .ilike('sku_induk', trimmed)
    .maybeSingle()

  return data ?? null
}
