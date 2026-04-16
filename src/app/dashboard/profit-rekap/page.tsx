// src/app/dashboard/profit-rekap/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, EmptyState, LoadingSpinner, MarginBar } from '@/components/ui'
import { formatRupiah, formatDate, cn, nDaysAgo, todayStr } from '@/lib/utils'
import { upsertDailyAds, getNetProfitSummary, type NetProfitSummary } from '@/lib/daily-ads'
import {
  getDailyRecap, getMonthlyRecap, getSkuSummary,
  type DailyRecapRow, type MonthlyRecapRow, type SkuSummaryRow,
} from '@/lib/aggregations'
import * as XLSX from 'xlsx'
import { format } from 'date-fns'

// ── safe number helper ────────────────────────────────────────
const n = (v: unknown): number => {
  const x = Number(v ?? 0)
  return isNaN(x) ? 0 : x
}

// ── month label helper: 'YYYY-MM' → 'Jan 2024' ───────────────
function monthLabel(bulan: string): string {
  try {
    return format(new Date(bulan + '-01'), 'MMM yyyy')
  } catch {
    return bulan
  }
}

type ViewTab = 'harian' | 'bulanan' | 'sku'

const EMPTY_KPI: NetProfitSummary = {
  profit_produk: 0, total_iklan: 0, net_profit: 0,
  total_transaksi: 0, total_omzet: 0, total_modal_keluar: 0,
}

// ── KPI Card (per periode) ────────────────────────────────────
function KpiCard({
  period, profit, iklan, net, trx, omzet,
}: {
  period: string
  profit: number
  iklan: number
  net: number
  trx: number
  omzet: number
}) {
  return (
    <div className="card p-5">
      <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-4">
        {period}
      </div>
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-500">Profit Transaksi</span>
          <span className={cn(
            'text-base font-bold tabular-nums',
            profit >= 0 ? 'text-emerald-400' : 'text-red-400'
          )}>
            {formatRupiah(profit)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-500">Biaya Iklan</span>
          <span className="text-base font-bold tabular-nums text-yellow-400">
            {iklan > 0 ? `— ${formatRupiah(iklan)}` : '—'}
          </span>
        </div>
        <div className="h-px bg-white/[0.06]" />
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold text-gray-300">Net Profit</span>
          <span className={cn(
            'text-xl font-bold tabular-nums',
            net >= 0 ? 'text-emerald-400' : 'text-red-400'
          )}>
            {formatRupiah(net)}
          </span>
        </div>
        <div className="pt-1">
          <span className="text-[10px] text-gray-600">
            {trx} transaksi · Omzet {formatRupiah(omzet)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Inline iklan input per baris ──────────────────────────────
function QuickAdsInput({
  tanggal, existingIklan, onSaved,
}: {
  tanggal: string
  existingIklan: number
  onSaved: () => void
}) {
  const supabase = createClient()
  const [val, setVal]       = useState(existingIklan > 0 ? String(existingIklan) : '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  async function save() {
    const amount = parseFloat(val) || 0
    if (amount <= 0) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    await upsertDailyAds(user.id, { tanggal, total_iklan: amount })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    onSaved()
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number" min={0} placeholder="Iklan..."
        className="input text-xs w-28 py-1.5"
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && save()}
      />
      <button
        className={cn('btn-sm text-xs px-2 py-1', saved ? 'btn-secondary text-emerald-400' : 'btn-primary')}
        onClick={save} disabled={saving}
      >
        {saving ? '...' : saved ? '✓' : 'Simpan'}
      </button>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function ProfitRekapPage() {
  const [tab, setTab]           = useState<ViewTab>('harian')
  const [loading, setLoading]   = useState(true)
  const [kpiLoading, setKpiLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(nDaysAgo(29))
  const [dateTo, setDateTo]     = useState(todayStr())

  const [dailyData, setDailyData]     = useState<DailyRecapRow[]>([])
  const [monthlyData, setMonthlyData] = useState<MonthlyRecapRow[]>([])
  const [skuData, setSkuData]         = useState<SkuSummaryRow[]>([])
  const [searchSku, setSearchSku]     = useState('')

  const [todayStat, setTodayStat]   = useState<NetProfitSummary>({ ...EMPTY_KPI })
  const [weekStat, setWeekStat]     = useState<NetProfitSummary>({ ...EMPTY_KPI })
  const [monthStat, setMonthStat]   = useState<NetProfitSummary>({ ...EMPTY_KPI })

  // ── load KPI cards (hari ini / 7 hari / bulan ini) ──────────
  const loadKpi = useCallback(async () => {
    setKpiLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setKpiLoading(false); return }

    const today      = todayStr()
    const weekStart  = nDaysAgo(6)
    const monthStart = today.slice(0, 7) + '-01'

    const [todayP, weekP, monthP] = await Promise.all([
      getNetProfitSummary(user.id, today, today),
      getNetProfitSummary(user.id, weekStart, today),
      getNetProfitSummary(user.id, monthStart, today),
    ])
    setTodayStat(todayP)
    setWeekStat(weekP)
    setMonthStat(monthP)
    setKpiLoading(false)
  }, [])

  // ── load tabel harian (bergantung dateFrom / dateTo) ────────
  const loadDaily = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const rows = await getDailyRecap(user.id, dateFrom, dateTo)
    setDailyData(rows)
    setLoading(false)
  }, [dateFrom, dateTo])

  // ── load bulanan + SKU (sekali saat mount) ──────────────────
  const loadStaticData = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [monthly, sku] = await Promise.all([
      getMonthlyRecap(user.id, 12),
      getSkuSummary(user.id),
    ])
    setMonthlyData(monthly)
    setSkuData(sku)
  }, [])

  useEffect(() => { loadKpi() }, [loadKpi])
  useEffect(() => { loadDaily() }, [loadDaily])
  useEffect(() => { loadStaticData() }, [loadStaticData])

  // Refresh setelah simpan iklan → reload KPI + daily
  function onAdSaved() {
    loadKpi()
    loadDaily()
  }

  // ── filtered + sorted SKU ───────────────────────────────────
  const filteredSku = skuData
    .filter(s =>
      !searchSku ||
      s.sku_induk.toLowerCase().includes(searchSku.toLowerCase()) ||
      s.nama_produk.toLowerCase().includes(searchSku.toLowerCase())
    )

  // ── accumulation untuk footer harian ───────────────────────
  const dailyAk = dailyData.reduce(
    (a, d) => ({
      omzet:  a.omzet  + d.omzet,
      modal:  a.modal  + d.modal,
      shopee: a.shopee + d.biaya_shopee,
      profit: a.profit + d.profit,
      iklan:  a.iklan  + d.iklan,
      net:    a.net    + d.net_profit,
      trx:    a.trx    + d.total_transaksi,
    }),
    { omzet: 0, modal: 0, shopee: 0, profit: 0, iklan: 0, net: 0, trx: 0 }
  )

  // ── export helpers ──────────────────────────────────────────
  function exportDailyXLSX() {
    const rows = dailyData.map(d => ({
      'Tanggal':        formatDate(d.tanggal),
      'Transaksi':      d.total_transaksi,
      'Qty':            d.total_item,
      'Omzet':          d.omzet,
      'Modal':          d.modal,
      'Biaya Shopee':   d.biaya_shopee,
      'Profit Produk':  d.profit,
      'Iklan Harian':   d.iklan,
      'Net Profit':     d.net_profit,
      'Net Margin %':   d.net_margin_persen,
    }))
    _downloadXLSX(rows, 'Rekap Harian', `rekap_profit_harian_${dateFrom}_${dateTo}.xlsx`)
  }

  function exportMonthlyXLSX() {
    const rows = monthlyData.map(m => ({
      'Bulan':          monthLabel(m.bulan),
      'Transaksi':      m.total_transaksi,
      'Omzet':          m.omzet,
      'Modal':          m.modal,
      'Biaya Shopee':   m.biaya_shopee,
      'Profit Produk':  m.profit,
      'Total Iklan':    m.iklan,
      'Net Profit':     m.net_profit,
      'Net Margin %':   m.net_margin_persen,
    }))
    _downloadXLSX(rows, 'Rekap Bulanan', 'rekap_profit_bulanan.xlsx')
  }

  function exportSkuXLSX() {
    const rows = filteredSku.map((s, i) => {
      const margin = s.omzet > 0
        ? parseFloat(((s.profit / s.omzet) * 100).toFixed(2))
        : 0
      return {
        'Rank':             i + 1,
        'SKU Induk':        s.sku_induk,
        'Nama Produk':      s.nama_produk,
        'Total Qty':        s.total_qty,
        'Omzet':            s.omzet,
        'Modal':            s.modal,
        'Biaya Shopee':     s.biaya_shopee,
        'Profit':           s.profit,
        'Margin %':         margin,
        'Total Transaksi':  s.total_transaksi,
        'Terakhir Jual':    formatDate(s.last_sold_date),
      }
    })
    _downloadXLSX(rows, 'Rekap SKU', 'rekap_profit_sku.xlsx')
  }

  function _downloadXLSX(rows: Record<string, unknown>[], sheetName: string, filename: string) {
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
    XLSX.writeFile(wb, filename)
  }

  const TABS: { id: ViewTab; label: string }[] = [
    { id: 'harian',  label: 'Per Hari' },
    { id: 'bulanan', label: 'Per Bulan' },
    { id: 'sku',     label: 'Per SKU Induk' },
  ]

  // ── render ──────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <PageHeader
        title="Rekap Profit & Net Profit"
        subtitle="Profit transaksi − iklan harian = net profit  ·  harian · bulanan · per SKU"
        actions={
          <div className="flex gap-2">
            {tab === 'harian'  && <button className="btn-secondary btn-sm" onClick={exportDailyXLSX}>⬇ Export Harian</button>}
            {tab === 'bulanan' && <button className="btn-secondary btn-sm" onClick={exportMonthlyXLSX}>⬇ Export Bulanan</button>}
            {tab === 'sku'     && <button className="btn-secondary btn-sm" onClick={exportSkuXLSX}>⬇ Export SKU</button>}
          </div>
        }
      />

      {/* ── KPI Cards: Hari Ini · Minggu Ini · Bulan Ini ── */}
      {kpiLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-3 w-24 bg-white/10 rounded mb-4" />
              <div className="space-y-3">
                <div className="h-4 w-full bg-white/10 rounded" />
                <div className="h-4 w-full bg-white/10 rounded" />
                <div className="h-px bg-white/[0.06]" />
                <div className="h-6 w-full bg-white/10 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard
            period="Hari Ini"
            profit={n(todayStat.profit_produk)}
            iklan={n(todayStat.total_iklan)}
            net={n(todayStat.net_profit)}
            trx={n(todayStat.total_transaksi)}
            omzet={n(todayStat.total_omzet)}
          />
          <KpiCard
            period="Minggu Ini (7 Hari)"
            profit={n(weekStat.profit_produk)}
            iklan={n(weekStat.total_iklan)}
            net={n(weekStat.net_profit)}
            trx={n(weekStat.total_transaksi)}
            omzet={n(weekStat.total_omzet)}
          />
          <KpiCard
            period="Bulan Ini"
            profit={n(monthStat.profit_produk)}
            iklan={n(monthStat.total_iklan)}
            net={n(monthStat.net_profit)}
            trx={n(monthStat.total_transaksi)}
            omzet={n(monthStat.total_omzet)}
          />
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05] w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'text-xs font-semibold px-4 py-1.5 rounded-lg transition-all',
              tab === t.id
                ? 'bg-orange-500/20 text-orange-400'
                : 'text-gray-500 hover:text-gray-300'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Date filter (hanya tab Harian) ── */}
      {tab === 'harian' && (
        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <input
            type="date" className="input w-36 text-sm"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          />
          <span className="text-gray-600 text-sm">s/d</span>
          <input
            type="date" className="input w-36 text-sm"
            value={dateTo} onChange={e => setDateTo(e.target.value)}
          />
          {[7, 14, 30].map(num => (
            <button
              key={num} className="btn-secondary btn-sm text-xs"
              onClick={() => { setDateFrom(nDaysAgo(num - 1)); setDateTo(todayStr()) }}
            >
              {num}H
            </button>
          ))}
          <div className="ml-auto text-xs text-gray-600">
            {dailyData.length} hari · {dailyAk.trx} transaksi
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: Per Hari
      ══════════════════════════════════════════════════════ */}
      {tab === 'harian' && (
        <div className="card">
          {loading ? <LoadingSpinner /> : dailyData.length === 0 ? (
            <EmptyState
              icon="📅"
              title="Tidak ada data"
              desc="Import transaksi Shopee terlebih dahulu, atau pilih rentang tanggal yang berbeda"
            />
          ) : (
            <div className="table-wrap">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th className="text-right">Trx</th>
                    <th className="text-right">Omzet</th>
                    <th className="text-right">Modal</th>
                    <th className="text-right">Biaya Shopee</th>
                    <th className="text-right">Profit Produk</th>
                    <th className="text-right">Iklan Harian</th>
                    <th className="text-right">NET PROFIT</th>
                    <th className="w-28">Net Margin</th>
                    <th className="w-48">Input Iklan</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyData.map(d => (
                    <tr key={d.tanggal}>
                      <td className="font-medium text-gray-200 whitespace-nowrap">
                        {formatDate(d.tanggal, 'EEE d/M/yy')}
                      </td>
                      <td className="text-right text-gray-500">{d.total_transaksi}</td>
                      <td className="text-right text-orange-400 tabular-nums">
                        {formatRupiah(d.omzet)}
                      </td>
                      <td className="text-right text-gray-500 tabular-nums">
                        {formatRupiah(d.modal)}
                      </td>
                      <td className="text-right text-red-400/80 tabular-nums">
                        {formatRupiah(d.biaya_shopee)}
                      </td>
                      <td className={cn(
                        'text-right font-semibold tabular-nums',
                        d.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                      )}>
                        {formatRupiah(d.profit)}
                      </td>
                      <td className="text-right text-yellow-400 tabular-nums">
                        {d.iklan > 0
                          ? <span>— {formatRupiah(d.iklan)}</span>
                          : <span className="text-gray-700">—</span>}
                      </td>
                      <td className={cn(
                        'text-right font-bold tabular-nums text-base',
                        d.net_profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                      )}>
                        {formatRupiah(d.net_profit)}
                      </td>
                      <td><MarginBar pct={d.net_margin_persen} /></td>
                      <td>
                        <QuickAdsInput
                          tanggal={d.tanggal}
                          existingIklan={d.iklan}
                          onSaved={onAdSaved}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* Footer totals */}
                {dailyData.length > 1 && (
                  <tfoot>
                    <tr className="border-t-2 border-white/10 font-semibold text-sm">
                      <td className="text-gray-400 py-2">
                        Total ({dailyData.length} hari)
                      </td>
                      <td className="text-right text-gray-400">{dailyAk.trx}</td>
                      <td className="text-right text-orange-400 tabular-nums">
                        {formatRupiah(dailyAk.omzet)}
                      </td>
                      <td className="text-right text-gray-500 tabular-nums">
                        {formatRupiah(dailyAk.modal)}
                      </td>
                      <td className="text-right text-red-400/80 tabular-nums">
                        {formatRupiah(dailyAk.shopee)}
                      </td>
                      <td className={cn(
                        'text-right tabular-nums',
                        dailyAk.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                      )}>
                        {formatRupiah(dailyAk.profit)}
                      </td>
                      <td className="text-right text-yellow-400 tabular-nums">
                        {dailyAk.iklan > 0 ? `— ${formatRupiah(dailyAk.iklan)}` : '—'}
                      </td>
                      <td className={cn(
                        'text-right font-bold tabular-nums text-base',
                        dailyAk.net >= 0 ? 'text-emerald-400' : 'text-red-400'
                      )}>
                        {formatRupiah(dailyAk.net)}
                      </td>
                      <td>
                        {dailyAk.omzet > 0 && (
                          <MarginBar pct={(dailyAk.net / dailyAk.omzet) * 100} />
                        )}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: Per Bulan
      ══════════════════════════════════════════════════════ */}
      {tab === 'bulanan' && (
        <div className="card">
          {monthlyData.length === 0 ? (
            <EmptyState icon="📆" title="Belum ada data bulanan" desc="Import transaksi terlebih dahulu" />
          ) : (
            <div className="table-wrap">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Bulan</th>
                    <th className="text-right">Trx</th>
                    <th className="text-right">Omzet</th>
                    <th className="text-right">Modal</th>
                    <th className="text-right">Biaya Shopee</th>
                    <th className="text-right">Profit Produk</th>
                    <th className="text-right">Total Iklan</th>
                    <th className="text-right">NET PROFIT</th>
                    <th className="w-28">Net Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map(m => (
                    <tr key={m.bulan}>
                      <td className="font-semibold text-gray-200">
                        {monthLabel(m.bulan)}
                      </td>
                      <td className="text-right text-gray-500">{m.total_transaksi}</td>
                      <td className="text-right text-orange-400 tabular-nums">
                        {formatRupiah(m.omzet)}
                      </td>
                      <td className="text-right text-gray-500 tabular-nums">
                        {formatRupiah(m.modal)}
                      </td>
                      <td className="text-right text-red-400/80 tabular-nums">
                        {m.biaya_shopee > 0 ? formatRupiah(m.biaya_shopee) : '—'}
                      </td>
                      <td className={cn(
                        'text-right font-semibold tabular-nums',
                        m.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                      )}>
                        {formatRupiah(m.profit)}
                      </td>
                      <td className="text-right text-yellow-400 tabular-nums">
                        {m.iklan > 0 ? `— ${formatRupiah(m.iklan)}` : '—'}
                      </td>
                      <td className={cn(
                        'text-right font-bold tabular-nums text-base',
                        m.net_profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                      )}>
                        {formatRupiah(m.net_profit)}
                      </td>
                      <td><MarginBar pct={m.net_margin_persen} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: Per SKU Induk
      ══════════════════════════════════════════════════════ */}
      {tab === 'sku' && (
        <div className="space-y-4">
          {/* Search */}
          <div className="card p-3">
            <input
              type="text"
              className="input text-sm"
              placeholder="🔍 Cari SKU Induk atau nama produk..."
              value={searchSku}
              onChange={e => setSearchSku(e.target.value)}
            />
          </div>

          <div className="card">
            {skuData.length === 0 ? (
              <EmptyState icon="🏷" title="Belum ada data SKU" desc="Import transaksi terlebih dahulu" />
            ) : filteredSku.length === 0 ? (
              <EmptyState icon="🔍" title="SKU tidak ditemukan" desc={`Tidak ada SKU dengan kata kunci "${searchSku}"`} />
            ) : (
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>SKU Induk</th>
                      <th>Nama Produk</th>
                      <th className="text-right">Total Qty</th>
                      <th className="text-right">Omzet</th>
                      <th className="text-right">Modal</th>
                      <th className="text-right">Biaya Shopee</th>
                      <th className="text-right">Profit</th>
                      <th className="w-28">Margin</th>
                      <th>Trx</th>
                      <th>Terakhir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSku.map((s, i) => {
                      const margin = s.omzet > 0 ? (s.profit / s.omzet) * 100 : 0
                      return (
                        <tr key={s.sku_induk + i}>
                          <td>
                            <div className={cn(
                              'w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold',
                              i === 0 ? 'bg-yellow-500/15 text-yellow-400' :
                              i === 1 ? 'bg-gray-400/15 text-gray-300' :
                              i === 2 ? 'bg-orange-700/15 text-orange-500' :
                              'bg-white/[0.04] text-gray-600'
                            )}>
                              {i + 1}
                            </div>
                          </td>
                          <td className="font-bold text-xs text-gray-200 font-mono">
                            {s.sku_induk}
                          </td>
                          <td className="max-w-[200px] truncate text-gray-200 text-sm">
                            {s.nama_produk}
                          </td>
                          <td className="text-right font-semibold">{s.total_qty}</td>
                          <td className="text-right text-orange-400 tabular-nums">
                            {formatRupiah(s.omzet)}
                          </td>
                          <td className="text-right text-gray-500 tabular-nums">
                            {formatRupiah(s.modal)}
                          </td>
                          <td className="text-right text-red-400/80 tabular-nums">
                            {s.biaya_shopee > 0 ? formatRupiah(s.biaya_shopee) : '—'}
                          </td>
                          <td className={cn(
                            'text-right font-semibold tabular-nums',
                            s.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                          )}>
                            {formatRupiah(s.profit)}
                          </td>
                          <td><MarginBar pct={margin} /></td>
                          <td className="text-xs text-gray-500">{s.total_transaksi}</td>
                          <td className="text-xs text-gray-600 whitespace-nowrap">
                            {s.last_sold_date ? formatDate(s.last_sold_date, 'd/M/yy') : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
