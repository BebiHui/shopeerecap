// src/app/dashboard/sku-summary/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, EmptyState, LoadingSpinner, StatCard, SectionCard, MarginBar } from '@/components/ui'
import { formatRupiah, formatDate, cn, nDaysAgo, todayStr } from '@/lib/utils'
import type { SkuModalSummary } from '@/types'
import { exportSkuModalSummaryXLSX } from '@/lib/sku-export'

type SortKey = 'modal' | 'qty' | 'profit' | 'margin'

export default function SkuSummaryPage() {
  const supabase = createClient()
  const [data, setData]       = useState<SkuModalSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [sort, setSort]       = useState<SortKey>('modal')
  const [dateFrom, setDateFrom] = useState(nDaysAgo(29))
  const [dateTo, setDateTo]   = useState(todayStr())
  const [filterKat, setFilterKat] = useState('')
  const [allKategori, setAllKategori] = useState<string[]>([])

  // Rekap modal per kategori
  const [modalPerKat, setModalPerKat] = useState<{ kategori: string; total_modal_keluar: number; total_qty: number }[]>([])
  // Unmatched rate
  const [matchStats, setMatchStats] = useState({ total: 0, matched: 0, unmatched: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: summary }, { data: katData }, { data: trxData }] = await Promise.all([
      supabase.from('sku_modal_summary').select('*').eq('user_id', user.id),
      supabase.from('modal_per_kategori').select('*').eq('user_id', user.id),
      supabase.from('transactions').select('unmatched_sku')
        .eq('user_id', user.id)
        .gte('tanggal', dateFrom).lte('tanggal', dateTo),
    ])

    if (summary) {
      setData(summary)
      setAllKategori([...new Set(summary.map(s => s.kategori).filter(Boolean) as string[])].sort())
    }
    if (katData) setModalPerKat(katData as any[])
    if (trxData) {
      const total     = trxData.length
      const unmatched = trxData.filter(t => t.unmatched_sku).length
      setMatchStats({ total, matched: total - unmatched, unmatched })
    }
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const filtered = data
    .filter(d => {
      if (filterKat && d.kategori !== filterKat) return false
      if (search) {
        const q = search.toLowerCase()
        return d.sku.toLowerCase().includes(q) || d.nama_produk.toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => {
      if (sort === 'modal')  return b.total_modal_keluar - a.total_modal_keluar
      if (sort === 'qty')    return b.total_qty - a.total_qty
      if (sort === 'profit') return b.total_profit - a.total_profit
      const mA = a.total_omzet > 0 ? a.total_profit / a.total_omzet : 0
      const mB = b.total_omzet > 0 ? b.total_profit / b.total_omzet : 0
      return mB - mA
    })

  const totals = data.reduce((acc, d) => ({
    modal:  acc.modal  + d.total_modal_keluar,
    qty:    acc.qty    + d.total_qty,
    profit: acc.profit + d.total_profit,
    omzet:  acc.omzet  + d.total_omzet,
  }), { modal: 0, qty: 0, profit: 0, omzet: 0 })

  const matchRate = matchStats.total > 0
    ? (matchStats.matched / matchStats.total * 100)
    : 0

  const SORT_OPTS: { id: SortKey; label: string }[] = [
    { id: 'modal',  label: 'Modal Keluar' },
    { id: 'qty',    label: 'Qty Keluar' },
    { id: 'profit', label: 'Profit' },
    { id: 'margin', label: 'Margin %' },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rekap Modal Keluar per SKU"
        subtitle="Analisa harga modal keluar berdasarkan SKU & periode"
        actions={
          <button className="btn-secondary btn-sm" onClick={() => exportSkuModalSummaryXLSX(filtered)}>
            ⬇ Export Excel
          </button>
        }
      />

      {/* Date filter */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <input type="date" className="input w-36 text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span className="text-gray-600 text-sm">s/d</span>
        <input type="date" className="input w-36 text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        {[7, 30, 90].map(n => (
          <button key={n} className="btn-secondary btn-sm text-xs" onClick={() => { setDateFrom(nDaysAgo(n - 1)); setDateTo(todayStr()) }}>
            {n}H
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Modal Keluar" value={totals.modal}  icon="💸" color="red"    isRupiah compact />
        <StatCard label="Total Qty Keluar"   value={totals.qty}    icon="📦" color="blue"   sub="pcs" />
        <StatCard label="Total Profit"       value={totals.profit} icon="📈" color={totals.profit >= 0 ? 'green' : 'red'} isRupiah compact />
        <StatCard label="Match Rate SKU"     value={`${matchRate.toFixed(1)}%`} icon="🎯"
          color={matchRate >= 90 ? 'green' : matchRate >= 60 ? 'yellow' : 'red'}
          sub={`${matchStats.unmatched} unmatched`} />
      </div>

      {/* Modal per kategori */}
      {modalPerKat.length > 0 && (
        <SectionCard title="📊 Modal Keluar per Kategori">
          <div className="p-5 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {modalPerKat.slice(0, 8).map(k => (
              <div key={k.kategori} className="bg-white/[0.025] rounded-xl p-4 border border-white/[0.05]">
                <div className="text-xs text-gray-500 font-medium mb-1 truncate">{k.kategori}</div>
                <div className="text-base font-bold text-red-400 tabular-nums">{formatRupiah(k.total_modal_keluar, true)}</div>
                <div className="text-[10px] text-gray-600 mt-0.5">{k.total_qty} pcs</div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <input type="text" className="input w-56 text-sm" placeholder="🔍 Cari SKU atau produk..."
          value={search} onChange={e => setSearch(e.target.value)} />
        {allKategori.length > 0 && (
          <select className="input text-xs w-36" value={filterKat} onChange={e => setFilterKat(e.target.value)}>
            <option value="">Semua Kategori</option>
            {allKategori.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
        <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05]">
          {SORT_OPTS.map(o => (
            <button key={o.id} onClick={() => setSort(o.id)}
              className={cn('text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-all',
                sort === o.id ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300')}>
              {o.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-gray-600">{filtered.length} SKU</span>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? <LoadingSpinner /> : filtered.length === 0 ? (
          <EmptyState icon="📊" title="Belum ada data"
            desc="Import transaksi dan pastikan master SKU sudah diisi" />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Produk</th>
                  <th>Kategori</th>
                  <th className="text-right">Modal/item</th>
                  <th className="text-right">Qty Keluar</th>
                  <th className="text-right">Total Modal Keluar</th>
                  <th className="text-right">Total Omzet</th>
                  <th className="text-right">Total Profit</th>
                  <th>Margin</th>
                  <th className="text-right">Unmatched</th>
                  <th>Terakhir</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d, i) => {
                  const margin = d.total_omzet > 0 ? (d.total_profit / d.total_omzet) * 100 : 0
                  return (
                    <tr key={d.sku}>
                      <td>
                        <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold',
                          i === 0 ? 'bg-yellow-500/15 text-yellow-400' :
                          i === 1 ? 'bg-gray-400/15 text-gray-300' :
                          i === 2 ? 'bg-orange-700/15 text-orange-500' : 'bg-white/[0.04] text-gray-600')}>
                          {i + 1}
                        </div>
                      </td>
                      <td className="mono text-xs font-semibold text-gray-200">{d.sku}</td>
                      <td className="max-w-[160px] truncate">
                        <div className="text-sm text-gray-200">{d.nama_produk}</div>
                        {d.nama_variasi && <div className="text-[10px] text-gray-600">{d.nama_variasi}</div>}
                      </td>
                      <td>{d.kategori ? <span className="badge badge-blue text-[10px]">{d.kategori}</span> : '—'}</td>
                      <td className="text-right text-gray-400 tabular-nums">{formatRupiah(d.modal_master_saat_ini)}</td>
                      <td className="text-right font-semibold">{d.total_qty} pcs</td>
                      <td className="text-right text-red-400 font-semibold tabular-nums">{formatRupiah(d.total_modal_keluar)}</td>
                      <td className="text-right text-orange-400 tabular-nums">{formatRupiah(d.total_omzet)}</td>
                      <td className={cn('text-right font-semibold tabular-nums', d.total_profit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {formatRupiah(d.total_profit)}
                      </td>
                      <td><MarginBar pct={margin} /></td>
                      <td className="text-right">
                        {d.trx_unmatched > 0
                          ? <span className="badge badge-red text-[10px]">{d.trx_unmatched}</span>
                          : <span className="text-gray-700 text-xs">—</span>}
                      </td>
                      <td className="text-xs text-gray-600">{formatDate(d.last_sold_date, 'd/M/yy')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
