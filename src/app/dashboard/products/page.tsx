// src/app/dashboard/products/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, EmptyState, LoadingSpinner, StatCard, SectionCard, MarginBar } from '@/components/ui'
import { formatRupiah, formatDate, cn } from '@/lib/utils'
import type { ProductSummary } from '@/types'
import { exportProdukXLSX } from '@/lib/export'

type SortKey = 'profit' | 'qty' | 'omzet' | 'margin'

export default function ProductsPage() {
  const supabase = createClient()
  const [products, setProducts]   = useState<ProductSummary[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [sort, setSort]           = useState<SortKey>('profit')
  const [tab, setTab]             = useState<'table' | 'cards'>('table')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('product_summary').select('*').eq('user_id', user.id)
    if (data) setProducts(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = products
    .filter(p => !search || p.nama_produk.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'profit') return b.total_profit - a.total_profit
      if (sort === 'qty')    return b.total_qty - a.total_qty
      if (sort === 'omzet')  return b.total_omzet - a.total_omzet
      // margin
      const mA = a.total_omzet > 0 ? a.total_profit / a.total_omzet : 0
      const mB = b.total_omzet > 0 ? b.total_profit / b.total_omzet : 0
      return mB - mA
    })

  const totals = products.reduce((a, p) => ({
    profit: a.profit + p.total_profit,
    omzet:  a.omzet  + p.total_omzet,
    qty:    a.qty    + p.total_qty,
    modal:  a.modal  + p.total_modal,
  }), { profit: 0, omzet: 0, qty: 0, modal: 0 })

  const SORT_OPTS: { id: SortKey; label: string }[] = [
    { id: 'profit', label: 'Profit' },
    { id: 'qty',    label: 'Qty Terjual' },
    { id: 'omzet',  label: 'Omzet' },
    { id: 'margin', label: 'Margin %' },
  ]

  const rankStyle = (i: number) =>
    i === 0 ? 'bg-yellow-500/15 text-yellow-400' :
    i === 1 ? 'bg-gray-400/15 text-gray-300' :
    i === 2 ? 'bg-orange-700/15 text-orange-500' :
    'bg-white/[0.04] text-gray-600'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analisa Produk"
        subtitle={`${products.length} produk · performa total`}
        actions={
          <button className="btn-secondary btn-sm" onClick={() => exportProdukXLSX(filtered)}>
            ⬇ Export Excel
          </button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Profit"       value={totals.profit} icon="📈" color={totals.profit >= 0 ? 'green' : 'red'} isRupiah compact />
        <StatCard label="Total Omzet"        value={totals.omzet}  icon="💰" color="orange" isRupiah compact />
        <StatCard label="Total Item Terjual" value={totals.qty}    icon="📦" color="blue"   sub="pcs" />
        <StatCard label="Total Modal"        value={totals.modal}  icon="🏭" color="purple" isRupiah compact />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <input type="text" className="input w-56 text-sm" placeholder="🔍 Cari produk..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05]">
          {SORT_OPTS.map(o => (
            <button key={o.id} onClick={() => setSort(o.id)}
              className={cn('text-[10px] font-semibold px-3 py-1.5 rounded-lg transition-all',
                sort === o.id ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300')}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05]">
          {(['table', 'cards'] as const).map(v => (
            <button key={v} onClick={() => setTab(v)}
              className={cn('text-[10px] font-semibold px-3 py-1.5 rounded-lg transition-all capitalize',
                tab === v ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300')}>
              {v === 'table' ? '≡ Tabel' : '⊞ Kartu'}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-600 ml-auto">{filtered.length} produk</span>
      </div>

      {loading ? <LoadingSpinner /> : filtered.length === 0 ? (
        <EmptyState icon="📦" title="Tidak ada produk ditemukan" />
      ) : tab === 'table' ? (
        /* ── TABLE VIEW ── */
        <div className="card">
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Produk</th>
                  <th>SKU</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Omzet</th>
                  <th className="text-right">Modal</th>
                  <th className="text-right">Profit</th>
                  <th className="text-right">Avg / pcs</th>
                  <th>Margin</th>
                  <th>Terakhir Jual</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const margin   = p.total_omzet > 0 ? (p.total_profit / p.total_omzet) * 100 : 0
                  const avgProfit = p.total_qty > 0 ? p.total_profit / p.total_qty : 0
                  return (
                    <tr key={p.nama_produk}>
                      <td>
                        <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold', rankStyle(i))}>
                          {i + 1}
                        </div>
                      </td>
                      <td className="font-medium text-gray-200 max-w-[200px] truncate">{p.nama_produk}</td>
                      <td className="mono text-[11px] text-gray-600">{p.sku ?? '—'}</td>
                      <td className="text-right">{p.total_qty} pcs</td>
                      <td className="text-right text-orange-400 tabular-nums">{formatRupiah(p.total_omzet)}</td>
                      <td className="text-right text-gray-500 tabular-nums">{formatRupiah(p.total_modal)}</td>
                      <td className={cn('text-right font-semibold tabular-nums', p.total_profit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {formatRupiah(p.total_profit)}
                      </td>
                      <td className={cn('text-right tabular-nums', avgProfit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {formatRupiah(avgProfit)}
                      </td>
                      <td><MarginBar pct={margin} /></td>
                      <td className="text-xs text-gray-600">{formatDate(p.last_sold_date, 'd MMM yy')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── CARDS VIEW ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p, i) => {
            const margin   = p.total_omzet > 0 ? (p.total_profit / p.total_omzet) * 100 : 0
            const avgProfit = p.total_qty > 0 ? p.total_profit / p.total_qty : 0
            return (
              <div key={p.nama_produk} className="card-hover p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold', rankStyle(i))}>
                    {i + 1}
                  </div>
                  <span className={cn('badge text-[10px]', margin >= 0 ? 'badge-green' : 'badge-red')}>
                    {margin.toFixed(1)}%
                  </span>
                </div>
                <div className="font-semibold text-gray-200 mb-0.5 leading-tight">{p.nama_produk}</div>
                {p.sku && <div className="mono text-[10px] text-gray-600 mb-3">{p.sku}</div>}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <div className="text-[9px] text-gray-600 uppercase tracking-widest font-semibold mb-0.5">Profit</div>
                    <div className={cn('text-base font-bold tabular-nums', p.total_profit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {formatRupiah(p.total_profit, true)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-600 uppercase tracking-widest font-semibold mb-0.5">Omzet</div>
                    <div className="text-base font-bold text-orange-400 tabular-nums">{formatRupiah(p.total_omzet, true)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-600 uppercase tracking-widest font-semibold mb-0.5">Qty Terjual</div>
                    <div className="text-sm font-semibold text-gray-300">{p.total_qty} pcs</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-600 uppercase tracking-widest font-semibold mb-0.5">Avg Profit/pcs</div>
                    <div className={cn('text-sm font-semibold tabular-nums', avgProfit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {formatRupiah(avgProfit, true)}
                    </div>
                  </div>
                </div>
                <MarginBar pct={margin} className="mt-3" />
                <div className="text-[10px] text-gray-700 mt-2">Terakhir: {formatDate(p.last_sold_date, 'd MMM yyyy')}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
