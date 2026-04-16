// src/app/dashboard/daily-recap/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, StatCard, EmptyState, LoadingSpinner, Alert, SectionCard } from '@/components/ui'
import { formatRupiah, formatDateLong, cn, nDaysAgo, todayStr } from '@/lib/utils'
import { exportRekapHarianXLSX } from '@/lib/export'
import { getDailyRecap } from '@/lib/aggregations'

// ─── safe number helper ────────────────────────────────────────────────────────
const n = (v: unknown): number => {
  const x = Number(v ?? 0)
  return isNaN(x) ? 0 : x
}

// ─── Unified row shape (superset of all sources) ──────────────────────────────
interface DailySummaryRow {
  user_id: string
  tanggal: string
  total_transaksi: number
  total_item: number
  total_omzet: number
  total_modal: number
  total_biaya_shopee: number
  total_biaya_administrasi?: number
  total_biaya_hemat_kirim?: number
  total_biaya_xtra?: number
  total_biaya_proses?: number
  total_biaya_spaylater?: number
  total_biaya_ams?: number
  profit_bersih: number
  total_iklan_harian?: number
}

export default function DailyRecapPage() {
  const supabase = createClient()
  const [summaries, setSummaries]   = useState<DailySummaryRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [dateFrom, setDateFrom]     = useState(nDaysAgo(29))
  const [dateTo, setDateTo]         = useState(todayStr())
  const [adInputs, setAdInputs]     = useState({ tanggal: todayStr(), total: '', ket: '' })
  const [savingAd, setSavingAd]     = useState(false)
  const [adMsg, setAdMsg]           = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'view_v2' | 'view_v1' | 'fallback'>('view_v2')

  // ─── load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // 1) Try daily_summary_v2 (new view with 6 biaya breakdown)
    const { data: v2, error: e2 } = await supabase
      .from('daily_summary_v2')
      .select('*')
      .eq('user_id', user.id)
      .gte('tanggal', dateFrom)
      .lte('tanggal', dateTo)
      .order('tanggal', { ascending: false })

    if (!e2 && v2 && v2.length > 0) {
      setSummaries(v2 as DailySummaryRow[])
      setDataSource('view_v2')
      setLoading(false)
      return
    }

    // 2) Try daily_summary (old view, no 6-biaya breakdown)
    const { data: v1, error: e1 } = await supabase
      .from('daily_summary')
      .select('*')
      .eq('user_id', user.id)
      .gte('tanggal', dateFrom)
      .lte('tanggal', dateTo)
      .order('tanggal', { ascending: false })

    if (!e1 && v1 && v1.length > 0) {
      setSummaries(v1 as DailySummaryRow[])
      setDataSource('view_v1')
      setLoading(false)
      return
    }

    // 3) Fallback: build from raw transactions + daily_ads_cost via aggregation helper
    try {
      const rows = await getDailyRecap(user.id, dateFrom, dateTo)
      // getDailyRecap returns DailyRecapRow (omzet/profit/modal/...) — adapt to DailySummaryRow shape
      const adapted: DailySummaryRow[] = rows.map(r => ({
        user_id: user.id,
        tanggal:             r.tanggal,
        total_transaksi:     r.total_transaksi,
        total_item:          r.total_item,
        total_omzet:         r.omzet,
        total_modal:         r.modal,
        total_biaya_shopee:  r.biaya_shopee,
        profit_bersih:       r.profit,
        total_iklan_harian:  r.iklan,
      }))
      setSummaries(adapted)
      setDataSource('fallback')
    } catch {
      setSummaries([])
    }

    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  // ─── save ad cost ──────────────────────────────────────────────────────────
  async function saveAd() {
    if (!adInputs.total) return
    setSavingAd(true)
    setAdMsg(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSavingAd(false); return }

    const { error } = await supabase.from('daily_ads_cost').upsert(
      {
        user_id: user.id,
        tanggal: adInputs.tanggal,
        total_iklan: parseFloat(adInputs.total) || 0,
        keterangan: adInputs.ket || null,
      },
      { onConflict: 'user_id,tanggal' }
    )
    setSavingAd(false)

    if (error) {
      setAdMsg({ type: 'error', msg: error.message })
      return
    }
    setAdMsg({ type: 'success', msg: `✓ Biaya iklan ${adInputs.tanggal} disimpan!` })
    setAdInputs(a => ({ ...a, total: '', ket: '' }))
    load()
    setTimeout(() => setAdMsg(null), 3000)
  }

  // ─── accumulation ─────────────────────────────────────────────────────────
  const ak = summaries.reduce(
    (a, d) => ({
      omzet:  a.omzet  + n(d.total_omzet),
      profit: a.profit + n(d.profit_bersih),
      modal:  a.modal  + n(d.total_modal),
      shopee: a.shopee + n(d.total_biaya_shopee),
      iklan:  a.iklan  + n(d.total_iklan_harian),
      trx:    a.trx    + n(d.total_transaksi),
      item:   a.item   + n(d.total_item),
    }),
    { omzet: 0, profit: 0, modal: 0, shopee: 0, iklan: 0, trx: 0, item: 0 }
  )

  const netProfit = ak.profit - ak.iklan

  // ─── render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <PageHeader
        title="Rekap Harian"
        subtitle="Ringkasan profit per hari dengan 6 biaya Shopee baru"
        actions={
          <button
            className="btn-secondary btn-sm"
            onClick={() => exportRekapHarianXLSX(summaries as any)}
          >
            ⬇ Export Excel
          </button>
        }
      />

      {/* ── Filter ── */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <input
          type="date"
          className="input w-36 text-sm"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
        />
        <span className="text-gray-600 text-sm">s/d</span>
        <input
          type="date"
          className="input w-36 text-sm"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
        />
        {[7, 14, 30].map(num => (
          <button
            key={num}
            className="btn-secondary btn-sm text-xs"
            onClick={() => { setDateFrom(nDaysAgo(num - 1)); setDateTo(todayStr()) }}
          >
            {num}H
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {dataSource !== 'view_v2' && (
            <span className="text-[10px] text-yellow-500 bg-yellow-500/10 rounded px-2 py-0.5">
              {dataSource === 'fallback' ? '⚠ fallback mode' : '⚠ view lama'}
            </span>
          )}
          <span className="text-xs text-gray-600">
            {summaries.length} hari · {ak.trx} transaksi · {ak.item} item
          </span>
        </div>
      </div>

      {/* ── Akumulasi cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Ak. Omzet"       value={ak.omzet}  icon="💰" color="orange" isRupiah compact={false} />
        <StatCard label="Ak. Modal"        value={ak.modal}  icon="🏭" color="blue"   isRupiah compact={false} />
        <StatCard label="Ak. Biaya Shopee" value={ak.shopee} icon="✂️" color="red"    isRupiah compact={false} />
        <StatCard label="Ak. Iklan"        value={ak.iklan}  icon="📢" color="yellow" isRupiah compact={false} />
        <StatCard
          label="Ak. Profit"
          value={ak.profit}
          icon="📈"
          color={ak.profit >= 0 ? 'green' : 'red'}
          isRupiah
          compact={false}
        />
        <StatCard
          label="Net Profit"
          value={netProfit}
          icon="💎"
          color={netProfit >= 0 ? 'green' : 'red'}
          isRupiah
          compact={false}
          sub="Profit − Iklan"
        />
      </div>

      {/* ── Input Iklan Harian ── */}
      <SectionCard title="📢 Input Biaya Iklan Harian">
        {adMsg && (
          <div className="px-5 pt-4">
            <Alert type={adMsg.type} message={adMsg.msg} onClose={() => setAdMsg(null)} />
          </div>
        )}
        <div className="p-5 pt-3 flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Tanggal</label>
            <input
              type="date"
              className="input w-36 text-sm"
              value={adInputs.tanggal}
              onChange={e => setAdInputs({ ...adInputs, tanggal: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Total Biaya Iklan (Rp)</label>
            <input
              type="number"
              className="input w-44 text-sm"
              placeholder="50000"
              value={adInputs.total}
              onChange={e => setAdInputs({ ...adInputs, total: e.target.value })}
            />
          </div>
          <div className="flex-1 min-w-44">
            <label className="label">Keterangan</label>
            <input
              type="text"
              className="input text-sm"
              placeholder="Shopee Ads, Meta Ads, dll"
              value={adInputs.ket}
              onChange={e => setAdInputs({ ...adInputs, ket: e.target.value })}
            />
          </div>
          <button
            className="btn-primary btn-sm"
            onClick={saveAd}
            disabled={savingAd || !adInputs.total}
          >
            {savingAd ? 'Menyimpan...' : '💾 Simpan'}
          </button>
        </div>
      </SectionCard>

      {/* ── Table ── */}
      <div className="card">
        {loading ? (
          <LoadingSpinner />
        ) : summaries.length === 0 ? (
          <EmptyState icon="📅" title="Tidak ada data" desc="Pilih rentang tanggal yang berbeda" />
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
                  <th className="text-right">Profit</th>
                  <th className="text-right">Iklan</th>
                  <th className="text-right">Net Profit</th>
                  <th className="text-right">Margin</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {summaries.map(s => {
                  const netP   = n(s.profit_bersih) - n(s.total_iklan_harian)
                  const margin = n(s.total_omzet) > 0
                    ? (netP / n(s.total_omzet)) * 100
                    : 0
                  const isExp = expandedRow === s.tanggal

                  return (
                    <>
                      <tr
                        key={s.tanggal}
                        className="cursor-pointer"
                        onClick={() => setExpandedRow(isExp ? null : s.tanggal)}
                      >
                        <td className="font-medium text-gray-200">{formatDateLong(s.tanggal)}</td>
                        <td className="text-right text-gray-400">{n(s.total_transaksi)}</td>
                        <td className="text-right text-orange-400 tabular-nums">
                          {formatRupiah(n(s.total_omzet))}
                        </td>
                        <td className="text-right text-gray-500 tabular-nums">
                          {formatRupiah(n(s.total_modal))}
                        </td>
                        <td className="text-right text-red-400 tabular-nums">
                          {formatRupiah(n(s.total_biaya_shopee))}
                        </td>
                        <td className={cn(
                          'text-right font-semibold tabular-nums',
                          n(s.profit_bersih) >= 0 ? 'text-emerald-400' : 'text-red-400'
                        )}>
                          {formatRupiah(n(s.profit_bersih))}
                        </td>
                        <td className="text-right text-yellow-400 tabular-nums">
                          {n(s.total_iklan_harian) > 0
                            ? formatRupiah(n(s.total_iklan_harian))
                            : '—'}
                        </td>
                        <td className={cn(
                          'text-right font-bold tabular-nums',
                          netP >= 0 ? 'text-emerald-400' : 'text-red-400'
                        )}>
                          {formatRupiah(netP)}
                        </td>
                        <td className="text-right">
                          <span className={cn(
                            'badge text-[10px]',
                            margin >= 0 ? 'badge-green' : 'badge-red'
                          )}>
                            {margin.toFixed(1)}%
                          </span>
                        </td>
                        <td className="text-gray-600 text-xs">{isExp ? '▲' : '▼'}</td>
                      </tr>

                      {/* Expandable: breakdown 6 biaya Shopee */}
                      {isExp && (
                        <tr key={`${s.tanggal}-exp`}>
                          <td colSpan={10} className="bg-white/[0.015] border-b border-white/[0.05]">
                            <div className="px-6 py-4">
                              <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-3">
                                Breakdown 6 Biaya Shopee
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                {[
                                  { label: 'Administrasi',   value: s.total_biaya_administrasi },
                                  { label: 'Hemat Kirim',    value: s.total_biaya_hemat_kirim  },
                                  { label: 'XTRA+',          value: s.total_biaya_xtra         },
                                  { label: 'Proses Pesanan', value: s.total_biaya_proses       },
                                  { label: 'SPayLater',      value: s.total_biaya_spaylater    },
                                  { label: 'AMS',            value: s.total_biaya_ams          },
                                ].map(item => (
                                  <div
                                    key={item.label}
                                    className="bg-white/[0.025] rounded-xl p-3 border border-white/[0.05]"
                                  >
                                    <div className="text-[9px] text-gray-600 uppercase tracking-widest font-semibold mb-0.5">
                                      {item.label}
                                    </div>
                                    <div className={cn(
                                      'text-sm font-semibold tabular-nums',
                                      n(item.value) > 0 ? 'text-red-400' : 'text-gray-700'
                                    )}>
                                      {n(item.value) > 0 ? formatRupiah(n(item.value)) : '—'}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {/* Extra: iklan for that day */}
                              {n(s.total_iklan_harian) > 0 && (
                                <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center gap-2 text-xs text-yellow-500/80">
                                  <span className="text-[9px] uppercase tracking-widest font-semibold">Iklan hari ini:</span>
                                  <span className="tabular-nums font-semibold">
                                    {formatRupiah(n(s.total_iklan_harian))}
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>

              {/* Footer totals */}
              {summaries.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-white/10 font-semibold text-sm">
                    <td className="text-gray-400 py-2">Total ({summaries.length} hari)</td>
                    <td className="text-right text-gray-400">{ak.trx}</td>
                    <td className="text-right text-orange-400 tabular-nums">{formatRupiah(ak.omzet)}</td>
                    <td className="text-right text-gray-500 tabular-nums">{formatRupiah(ak.modal)}</td>
                    <td className="text-right text-red-400 tabular-nums">{formatRupiah(ak.shopee)}</td>
                    <td className={cn(
                      'text-right tabular-nums',
                      ak.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                    )}>
                      {formatRupiah(ak.profit)}
                    </td>
                    <td className="text-right text-yellow-400 tabular-nums">
                      {ak.iklan > 0 ? formatRupiah(ak.iklan) : '—'}
                    </td>
                    <td className={cn(
                      'text-right font-bold tabular-nums',
                      netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                    )}>
                      {formatRupiah(netProfit)}
                    </td>
                    <td className="text-right">
                      {ak.omzet > 0 && (
                        <span className={cn(
                          'badge text-[10px]',
                          (netProfit / ak.omzet) >= 0 ? 'badge-green' : 'badge-red'
                        )}>
                          {((netProfit / ak.omzet) * 100).toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
