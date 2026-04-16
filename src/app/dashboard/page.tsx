'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  SectionCard,
  LoadingSpinner,
  EmptyState,
} from '@/components/ui'
import { NetProfitChart } from '@/components/charts/DailyChart'
import { cn, formatRupiah, todayStr, nDaysAgo, formatDate } from '@/lib/utils'
import { getNetProfitSummary, type NetProfitSummary } from '@/lib/daily-ads'

// ── Types ─────────────────────────────────────────────────────

interface ChartPoint {
  tanggal: string
  profit_produk: number
  total_iklan_harian: number
  net_profit_harian: number
}

interface RecentTrx {
  order_id: string | null
  nama_produk: string | null
  sku_induk: string | null
  qty: number
  total_harga_produk: number
  profit: number | null
  tanggal: string
}

interface SkuRow {
  sku_induk: string | null
  nama_produk: string | null
  total_qty: number
  total_omzet: number
  total_profit: number
}

// ── Helpers ───────────────────────────────────────────────────

const n = (v: unknown): number => {
  const x = Number(v ?? 0)
  return isNaN(x) ? 0 : x
}

const RANGE_OPTS = [
  { label: '7H', days: 7 },
  { label: '14H', days: 14 },
  { label: '30H', days: 30 },
]

// ── KPI Card ──────────────────────────────────────────────────

function KpiCard({ label, kpi }: { label: string; kpi: NetProfitSummary | null }) {
  const net    = n(kpi?.net_profit)
  const profit = n(kpi?.profit_produk)
  const iklan  = n(kpi?.total_iklan)
  const netPos = net >= 0

  return (
    <div className="card p-5 relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-orange-500/50 to-transparent" />
      <div className="text-[9px] font-bold text-gray-600 uppercase tracking-[0.12em] mb-4">{label}</div>
      <div className="space-y-2.5">
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-500">Profit Transaksi</span>
          <span className={cn('text-sm font-semibold tabular-nums', profit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {formatRupiah(profit)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-500">Biaya Iklan</span>
          <span className={cn('text-sm font-semibold tabular-nums', iklan > 0 ? 'text-yellow-400' : 'text-gray-600')}>
            {iklan > 0 ? `− ${formatRupiah(iklan)}` : '—'}
          </span>
        </div>
        <div className="border-t border-white/[0.06]" />
        <div className="flex justify-between items-center pt-0.5">
          <span className="text-sm font-semibold text-gray-300">Net Profit</span>
          <span className={cn('text-xl font-bold tabular-nums', netPos ? 'text-emerald-400' : 'text-red-400')}>
            {formatRupiah(net)}
          </span>
        </div>
        {n(kpi?.total_transaksi) > 0 && (
          <div className="text-[10px] text-gray-600">
            {kpi!.total_transaksi} transaksi · Omzet {formatRupiah(n(kpi?.total_omzet))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────

export default function DashboardPage() {
  const supabase = createClient()

  const [range, setRange]               = useState(14)
  const [loading, setLoading]           = useState(true)
  const [todayKpi, setTodayKpi]         = useState<NetProfitSummary | null>(null)
  const [weekKpi, setWeekKpi]           = useState<NetProfitSummary | null>(null)
  const [monthKpi, setMonthKpi]         = useState<NetProfitSummary | null>(null)
  const [chartData, setChartData]       = useState<ChartPoint[]>([])
  const [recentTrx, setRecentTrx]       = useState<RecentTrx[]>([])
  const [topSku, setTopSku]             = useState<SkuRow[]>([])
  const [unmatchedCount, setUnmatched]  = useState(0)

  // ── Fallback: chart dari tabel mentah ─────────────────────
  const buildChartFromRaw = useCallback(
    async (userId: string, chartStart: string, today: string): Promise<ChartPoint[]> => {
      const [{ data: trx }, { data: ads }] = await Promise.all([
        supabase
          .from('transactions')
          .select('tanggal, profit')
          .eq('user_id', userId)
          .gte('tanggal', chartStart)
          .lte('tanggal', today),
        supabase
          .from('daily_ads_cost')
          .select('tanggal, total_iklan')
          .eq('user_id', userId)
          .gte('tanggal', chartStart)
          .lte('tanggal', today),
      ])

      const byDate: Record<string, { profit: number; iklan: number }> = {}
      for (const t of trx ?? []) {
        const tgl = t.tanggal as string
        if (!byDate[tgl]) byDate[tgl] = { profit: 0, iklan: 0 }
        byDate[tgl].profit += n(t.profit)
      }
      for (const a of ads ?? []) {
        const tgl = a.tanggal as string
        if (!byDate[tgl]) byDate[tgl] = { profit: 0, iklan: 0 }
        byDate[tgl].iklan += n(a.total_iklan)
      }
      return Object.entries(byDate)
        .map(([tanggal, v]) => ({
          tanggal,
          profit_produk: v.profit,
          total_iklan_harian: v.iklan,
          net_profit_harian: v.profit - v.iklan,
        }))
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal))
    },
    [supabase]
  )

  // ── Fallback: top SKU dari tabel mentah ───────────────────
  const buildSkuFromRaw = useCallback(
    async (userId: string): Promise<SkuRow[]> => {
      const { data: trx } = await supabase
        .from('transactions')
        .select('sku_induk, nama_produk, qty, total_harga_produk, profit')
        .eq('user_id', userId)

      const bySkuMap: Record<string, SkuRow> = {}
      for (const t of trx ?? []) {
        const key = (t.sku_induk as string) || '__no_sku__'
        if (!bySkuMap[key]) {
          bySkuMap[key] = {
            sku_induk: t.sku_induk,
            nama_produk: t.nama_produk,
            total_qty: 0,
            total_omzet: 0,
            total_profit: 0,
          }
        }
        bySkuMap[key].total_qty    += n(t.qty)
        bySkuMap[key].total_omzet  += n(t.total_harga_produk)
        bySkuMap[key].total_profit += n(t.profit)
        // Keep latest nama_produk
        if (t.nama_produk) bySkuMap[key].nama_produk = t.nama_produk
      }
      return Object.values(bySkuMap)
        .sort((a, b) => b.total_profit - a.total_profit)
        .slice(0, 6)
    },
    [supabase]
  )

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const today      = todayStr()
    const weekStart  = nDaysAgo(6)
    const monthStart = today.slice(0, 7) + '-01'
    const chartStart = nDaysAgo(range - 1)

    // ── KPI cards (getNetProfitSummary sudah punya fallback otomatis) ──
    const [todayP, weekP, monthP] = await Promise.all([
      getNetProfitSummary(user.id, today, today),
      getNetProfitSummary(user.id, weekStart, today),
      getNetProfitSummary(user.id, monthStart, today),
    ])

    setTodayKpi(todayP)
    setWeekKpi(weekP)
    setMonthKpi(monthP)

    // ── Chart: coba view, fallback ke raw ─────────────────────
    const { data: chartView, error: chartErr } = await supabase
      .from('shopee_net_profit_harian')
      .select('tanggal, profit_produk, total_iklan_harian, net_profit_harian')
      .eq('user_id', user.id)
      .gte('tanggal', chartStart)
      .lte('tanggal', today)
      .order('tanggal')

    if (!chartErr && chartView && chartView.length > 0) {
      setChartData(chartView as ChartPoint[])
    } else {
      const raw = await buildChartFromRaw(user.id, chartStart, today)
      setChartData(raw)
    }

    // ── Recent transactions: coba view, fallback ke tabel ────
    const { data: recentView, error: recentErr } = await supabase
      .from('shopee_transactions')
      .select('order_id, nama_produk, sku_induk, qty, total_harga_produk, profit, tanggal')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8)

    if (!recentErr && recentView) {
      setRecentTrx(recentView as RecentTrx[])
    } else {
      const { data: recentRaw } = await supabase
        .from('transactions')
        .select('order_id, nama_produk, sku_induk, qty, total_harga_produk, profit, tanggal')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(8)
      setRecentTrx((recentRaw ?? []) as RecentTrx[])
    }

    // ── Top SKU: coba view, fallback ke raw ───────────────────
    const { data: skuView, error: skuErr } = await supabase
      .from('shopee_sku_summary')
      .select('sku_induk, nama_produk, total_qty, total_omzet, total_profit')
      .eq('user_id', user.id)
      .order('total_profit', { ascending: false })
      .limit(6)

    if (!skuErr && skuView && skuView.length > 0) {
      setTopSku(skuView as SkuRow[])
    } else {
      const raw = await buildSkuFromRaw(user.id)
      setTopSku(raw)
    }

    // ── Unmatched modal count ──────────────────────────────────
    const { count: unmatchedView, error: umErr } = await supabase
      .from('shopee_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('unmatched_modal', true)

    if (!umErr) {
      setUnmatched(unmatchedView ?? 0)
    } else {
      const { count: unmatchedRaw } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('unmatched_modal', true)
      setUnmatched(unmatchedRaw ?? 0)
    }

    setLoading(false)
  }, [range, supabase, buildChartFromRaw, buildSkuFromRaw])

  useEffect(() => {
    load()
  }, [load])

  // Akumulasi chart totals
  const akProfit = chartData.reduce((s, d) => s + n(d.profit_produk), 0)
  const akIklan  = chartData.reduce((s, d) => s + n(d.total_iklan_harian), 0)
  const akNet    = chartData.reduce((s, d) => s + n(d.net_profit_harian), 0)

  return (
    <div className="space-y-6">
      {/* Header + Range Selector */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Net Profit = Profit Transaksi − Biaya Iklan Harian</p>
        </div>
        <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05]">
          {RANGE_OPTS.map((o) => (
            <button
              key={o.days}
              onClick={() => setRange(o.days)}
              className={cn(
                'text-[10px] font-semibold px-2.5 py-1 rounded-md transition-all',
                range === o.days
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'text-gray-500 hover:text-gray-300'
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* Unmatched Modal Warning */}
          {unmatchedCount > 0 && (
            <div className="flex items-center justify-between px-4 py-3 bg-yellow-500/8 border border-yellow-500/20 rounded-xl">
              <div className="flex items-center gap-2 text-sm text-yellow-400">
                <span>⚠</span>
                <span>
                  <strong>{unmatchedCount}</strong> transaksi tanpa harga modal — profit belum akurat
                </span>
              </div>
              <Link
                href="/dashboard/unmatched-modal"
                className="text-xs text-orange-400 hover:text-orange-300 font-semibold shrink-0"
              >
                Resolve →
              </Link>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard label="Hari Ini" kpi={todayKpi} />
            <KpiCard label="Minggu Ini (7H)" kpi={weekKpi} />
            <KpiCard label="Bulan Ini" kpi={monthKpi} />
          </div>

          {/* Chart */}
          <SectionCard>
            <div className="px-5 py-4 border-b border-white/[0.05] flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-200">
                Net Profit vs Iklan — {range} Hari Terakhir
              </span>
              <Link
                href="/dashboard/iklan-harian"
                className="text-[11px] text-orange-400 hover:text-orange-300"
              >
                Kelola Iklan →
              </Link>
            </div>

            {/* Akumulasi mini stats */}
            <div className="grid grid-cols-3 divide-x divide-white/[0.05] border-b border-white/[0.05]">
              {[
                { label: 'Ak. Profit Produk', val: akProfit, cls: akProfit >= 0 ? 'text-emerald-400' : 'text-red-400' },
                { label: 'Ak. Biaya Iklan',   val: akIklan,  cls: 'text-yellow-400' },
                { label: 'Ak. Net Profit',    val: akNet,    cls: akNet >= 0 ? 'text-emerald-400' : 'text-red-400' },
              ].map((item) => (
                <div key={item.label} className="px-5 py-3">
                  <div className="text-[9px] text-gray-600 uppercase tracking-widest font-semibold">{item.label}</div>
                  <div className={cn('text-sm font-bold mt-0.5 tabular-nums', item.cls)}>
                    {formatRupiah(item.val)}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-5">
              {chartData.length === 0 ? (
                <EmptyState
                  icon="📊"
                  title="Belum ada data grafik"
                  desc="Import transaksi Shopee dan tambahkan biaya iklan harian"
                />
              ) : (
                <>
                  <div className="flex flex-wrap gap-4 mb-4 text-[11px] text-gray-500">
                    {[
                      { cls: 'bg-emerald-500/30', label: 'Profit Produk' },
                      { cls: 'bg-yellow-500/50', label: 'Iklan (pengurang)' },
                      { cls: 'bg-emerald-500 h-0.5 w-6 self-center', label: 'Net Profit' },
                    ].map((l) => (
                      <div key={l.label} className="flex items-center gap-1.5">
                        <div className={cn('w-3 h-3 rounded-sm shrink-0', l.cls)} />
                        <span>{l.label}</span>
                      </div>
                    ))}
                  </div>
                  <NetProfitChart data={chartData} />
                </>
              )}
            </div>
          </SectionCard>

          {/* Bottom grid: SKU + Recent Trx */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* SKU Profit Tertinggi */}
            <SectionCard
              title="🏷 SKU Profit Tertinggi"
              action={
                <Link
                  href="/dashboard/profit-rekap"
                  className="text-[11px] text-orange-400 hover:text-orange-300"
                >
                  Lihat semua →
                </Link>
              }
            >
              {topSku.length === 0 ? (
                <EmptyState icon="🏷" title="Belum ada data SKU" />
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {topSku.map((s, i) => (
                    <div
                      key={(s.sku_induk ?? '') + i}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div
                        className={cn(
                          'w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold shrink-0',
                          i === 0 ? 'bg-yellow-500/15 text-yellow-400'
                          : i === 1 ? 'bg-gray-400/15 text-gray-300'
                          : i === 2 ? 'bg-orange-700/15 text-orange-500'
                          : 'bg-white/[0.04] text-gray-600'
                        )}
                      >
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="mono text-[10px] text-gray-500">{s.sku_induk ?? '—'}</div>
                        <div className="text-sm text-gray-200 font-medium truncate">{s.nama_produk ?? '—'}</div>
                        <div className="text-[10px] text-gray-600">
                          {s.total_qty} pcs · {formatRupiah(s.total_omzet, true)}
                        </div>
                      </div>
                      <div className={cn('text-sm font-bold shrink-0', s.total_profit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {formatRupiah(s.total_profit, true)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Transaksi Terbaru */}
            <SectionCard
              title="📋 Transaksi Terbaru"
              action={
                <Link
                  href="/dashboard/transactions"
                  className="text-[11px] text-orange-400 hover:text-orange-300"
                >
                  Lihat semua →
                </Link>
              }
            >
              {recentTrx.length === 0 ? (
                <EmptyState
                  icon="📋"
                  title="Belum ada transaksi"
                  action={
                    <Link href="/dashboard/shopee-import" className="btn-primary btn-sm">
                      Import Shopee
                    </Link>
                  }
                />
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {recentTrx.map((t) => (
                    <div
                      key={(t.order_id ?? '') + (t.nama_produk ?? '')}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-200 font-medium truncate">
                          {t.nama_produk ?? '—'}
                        </div>
                        <div className="text-[10px] text-gray-600 flex items-center gap-1.5 mt-0.5">
                          <span className="mono">{(t.order_id ?? '').slice(-10)}</span>
                          <span>·</span>
                          <span>{formatDate(t.tanggal, 'd MMM')}</span>
                          <span>·</span>
                          <span>{t.qty} pcs</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={cn(
                            'text-sm font-semibold tabular-nums',
                            n(t.profit) >= 0 ? 'text-emerald-400' : 'text-red-400'
                          )}
                        >
                          {formatRupiah(n(t.profit), true)}
                        </div>
                        <div className="text-[10px] text-gray-600 tabular-nums">
                          {formatRupiah(n(t.total_harga_produk), true)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          {/* Quick Links */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { href: '/dashboard/daily-recap',   icon: '📅', label: 'Rekap Harian' },
              { href: '/dashboard/profit-rekap',  icon: '📈', label: 'Rekap Profit' },
              { href: '/dashboard/harga-modal',   icon: '💰', label: 'Master Harga Modal' },
              { href: '/dashboard/iklan-harian',  icon: '📢', label: 'Kelola Iklan' },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="card p-4 flex items-center gap-3 hover:bg-white/[0.04] transition-colors group"
              >
                <span className="text-xl">{link.icon}</span>
                <span className="text-sm text-gray-400 group-hover:text-gray-200 transition-colors font-medium">
                  {link.label}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
