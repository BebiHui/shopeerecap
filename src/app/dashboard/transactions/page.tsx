// src/app/dashboard/transactions/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, EmptyState, LoadingSpinner } from '@/components/ui'
import TransactionDetailModal from '@/components/transactions/TransactionDetailModal'
import { formatRupiah, formatDate, cn } from '@/lib/utils'
import { hitungProfit } from '@/types'
import type { Transaction } from '@/types'
import { exportTransaksiXLSX } from '@/lib/export'
import Link from 'next/link'

// Label singkat untuk 6 biaya
const BIAYA_LABELS: { field: keyof Transaction; label: string; short: string }[] = [
  { field: 'biaya_administrasi',                       label: 'Biaya Administrasi',                         short: 'Adm'       },
  { field: 'biaya_program_hemat_biaya_kirim',          label: 'Biaya Program Hemat Biaya Kirim',            short: 'Hemat Kirim'},
  { field: 'biaya_layanan_promo_xtra_gratis_ongkir_xtra', label: 'Biaya Layanan Promo XTRA+ & Gratis Ongkir', short: 'XTRA+'  },
  { field: 'biaya_proses_pesanan',                     label: 'Biaya Proses Pesanan',                       short: 'Proses'    },
  { field: 'biaya_transaksi_spaylater',                label: 'Biaya Transaksi (SPayLater)',                 short: 'SPayLater' },
  { field: 'biaya_ams',                                label: 'Biaya AMS',                                  short: 'AMS'       },
]

export default function TransactionsPage() {
  const supabase = createClient()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<Transaction | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [search, setSearch]           = useState('')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [produkFilter, setProdukFilter] = useState('')
  const [allProducts, setAllProducts] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    let q = supabase.from('transactions')
      .select('*')
      .eq('user_id', user.id)           // scoped ke user login
      .order('tanggal', { ascending: false })
      .order('created_at', { ascending: false })

    if (dateFrom)     q = q.gte('tanggal', dateFrom)
    if (dateTo)       q = q.lte('tanggal', dateTo)
    if (produkFilter) q = q.eq('nama_produk', produkFilter)
    if (search)       q = q.or(
      `order_id.ilike.%${search}%,nama_pembeli.ilike.%${search}%,nama_produk.ilike.%${search}%`
    )

    const { data } = await q.limit(500)
    if (data) {
      setTransactions(data as Transaction[])
      setAllProducts([...new Set(data.map(t => t.nama_produk))].sort())
    }
    setLoading(false)
  }, [search, dateFrom, dateTo, produkFilter])

  useEffect(() => { load() }, [load])

  // Summary totals — memakai hitungProfit dengan field baru
  const totals = transactions.reduce((acc, t) => {
    const c = hitungProfit(t)
    return {
      omzet:  acc.omzet  + c.total_harga_produk,
      modal:  acc.modal  + c.harga_modal_total,
      biaya:  acc.biaya  + c.total_biaya_shopee,
      profit: acc.profit + c.profit_bersih,
    }
  }, { omzet: 0, modal: 0, biaya: 0, profit: 0 })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Daftar Transaksi"
        subtitle={`${transactions.length} transaksi`}
        actions={
          <>
            <button className="btn-secondary btn-sm"
              onClick={() => exportTransaksiXLSX(transactions)}>
              ⬇ Export Excel
            </button>
            <Link href="/dashboard/transactions/new" className="btn-primary btn-sm">
              + Tambah
            </Link>
          </>
        }
      />

      {/* ── Filter ── */}
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <input type="text" className="input text-xs col-span-2 md:col-span-1"
            placeholder="🔍 Cari order, produk, pembeli..."
            value={search} onChange={e => setSearch(e.target.value)} />
          <input type="date" className="input text-xs" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)} />
          <input type="date" className="input text-xs" value={dateTo}
            onChange={e => setDateTo(e.target.value)} />
          <select className="input text-xs" value={produkFilter}
            onChange={e => setProdukFilter(e.target.value)}>
            <option value="">Semua Produk</option>
            {allProducts.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="btn-secondary btn-sm text-xs"
            onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setProdukFilter('') }}>
            Reset
          </button>
        </div>
      </div>

      {/* ── Summary strip — 4 metrik utama ── */}
      {transactions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Harga Produk', value: totals.omzet,  cls: 'text-orange-400' },
            { label: 'Total Modal',         value: totals.modal,  cls: 'text-blue-400'   },
            { label: 'Total Biaya Shopee',  value: totals.biaya,  cls: 'text-red-400'    },
            { label: 'Total Profit Bersih', value: totals.profit, cls: totals.profit >= 0 ? 'text-emerald-400' : 'text-red-400' },
          ].map(item => (
            <div key={item.label} className="card px-4 py-3">
              <div className="text-[9px] text-gray-600 uppercase tracking-widest font-semibold">
                {item.label}
              </div>
              <div className={cn('text-sm font-bold mt-0.5 tabular-nums', item.cls)}>
                {formatRupiah(item.value)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      <div className="card">
        {loading ? (
          <LoadingSpinner />
        ) : transactions.length === 0 ? (
          <EmptyState icon="📭" title="Tidak ada transaksi"
            desc="Ubah filter atau tambah transaksi baru"
            action={
              <Link href="/dashboard/transactions/new" className="btn-primary btn-sm">
                + Tambah Transaksi
              </Link>
            } />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Order ID</th>
                  <th>Pembeli</th>
                  <th>Produk</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Total Harga</th>
                  <th className="text-right">Modal</th>
                  <th className="text-right">Total Biaya</th>
                  <th className="text-right">Profit</th>
                  <th className="text-right">Margin</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(t => {
                  const c       = hitungProfit(t)
                  const isExp   = expandedId === t.id
                  const hasNone = c.total_biaya_shopee === 0

                  return (
                    <>
                      <tr key={t.id}
                        className={cn('cursor-pointer', isExp && 'bg-white/[0.02]')}
                        onClick={() => { setSelected(t); setModalOpen(true) }}>
                        <td className="text-gray-500 text-xs">{formatDate((t as any).tanggal, 'd/M/yy')}</td>
                        <td className="mono text-[11px] text-gray-500">{t.order_id.slice(-12)}</td>
                        <td className="text-gray-400 text-xs max-w-[100px] truncate">
                          {(t as any).nama_pembeli ?? '—'}
                        </td>
                        <td className="max-w-[160px] truncate font-medium text-gray-200">
                          {t.nama_produk}
                        </td>
                        <td className="text-right text-gray-400">{t.qty}</td>
                        <td className="text-right text-orange-400 tabular-nums">
                          {formatRupiah(c.total_harga_produk, true)}
                        </td>
                        <td className="text-right text-gray-500 tabular-nums">
                          {formatRupiah(c.harga_modal_total, true)}
                        </td>
                        <td className="text-right tabular-nums">
                          <div className="flex items-center justify-end gap-1">
                            <span className={hasNone ? 'text-gray-700' : 'text-red-400'}>
                              {hasNone ? '—' : formatRupiah(c.total_biaya_shopee, true)}
                            </span>
                            {!hasNone && (
                              <button
                                className="text-gray-600 hover:text-gray-400 text-[10px] transition-colors"
                                title="Lihat breakdown biaya"
                                onClick={e => { e.stopPropagation(); setExpandedId(isExp ? null : t.id) }}
                              >
                                {isExp ? '▲' : '▼'}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className={cn('text-right font-semibold tabular-nums',
                          c.profit_bersih >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {formatRupiah(c.profit_bersih, true)}
                        </td>
                        <td className="text-right">
                          <span className={cn('badge text-[10px]',
                            c.margin_persen >= 0 ? 'badge-green' : 'badge-red')}>
                            {isFinite(c.margin_persen) ? c.margin_persen.toFixed(1) : '0.0'}%
                          </span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <Link href={`/dashboard/transactions/${t.id}/edit`}
                            className="btn-ghost btn-xs px-2 py-1.5 text-[11px]">✏️</Link>
                        </td>
                      </tr>

                      {/* ── Expandable breakdown 6 biaya ── */}
                      {isExp && (
                        <tr key={`${t.id}-breakdown`}>
                          <td colSpan={11} className="bg-white/[0.015] border-b border-white/[0.05] !py-0">
                            <div className="px-6 py-3">
                              <div className="text-[9px] text-gray-600 uppercase tracking-widest font-semibold mb-2">
                                Breakdown 6 Biaya Shopee
                              </div>
                              <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                                {BIAYA_LABELS.map(b => {
                                  const v = (t[b.field] as number) ?? 0
                                  return (
                                    <div key={b.field} className="flex items-center gap-2 text-xs">
                                      <span className="text-gray-600">{b.label}:</span>
                                      <span className={cn('tabular-nums font-semibold',
                                        v > 0 ? 'text-red-400' : 'text-gray-700')}>
                                        {v > 0 ? formatRupiah(v) : '—'}
                                      </span>
                                    </div>
                                  )
                                })}
                                <div className="flex items-center gap-2 text-xs border-l border-white/[0.08] pl-4">
                                  <span className="text-gray-500 font-semibold">Total Biaya:</span>
                                  <span className="text-red-400 font-bold tabular-nums">
                                    {formatRupiah(c.total_biaya_shopee)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TransactionDetailModal
        transaction={selected}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onDeleted={load}
      />
    </div>
  )
}
