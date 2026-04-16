// src/app/dashboard/sku-unmatched/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, EmptyState, LoadingSpinner, SectionCard, Alert } from '@/components/ui'
import { formatRupiah, formatDate, cn } from '@/lib/utils'
import type { UnmatchedImportItem, MasterSku } from '@/types'

export default function SkuUnmatchedPage() {
  const supabase = createClient()
  const [items, setItems]   = useState<UnmatchedImportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [masterSkus, setMasterSkus] = useState<MasterSku[]>([])
  const [resolveMap, setResolveMap] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [filterResolved, setFilterResolved] = useState<'all' | 'pending' | 'resolved'>('pending')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: unmatched }, { data: skus }] = await Promise.all([
      supabase.from('unmatched_import_items').select('*')
        .eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('master_sku').select('id,sku,nama_produk,harga_modal')
        .eq('user_id', user.id).eq('is_active', true).order('sku'),
    ])
    setItems(unmatched ?? [])
    setMasterSkus(skus ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function resolveItem(item: UnmatchedImportItem) {
    const chosenSku = resolveMap[item.id]
    if (!chosenSku) return

    setSaving(item.id)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 1. Tandai sebagai resolved — scoped ke user login
    await supabase.from('unmatched_import_items').update({
      resolved: true,
      resolved_sku: chosenSku,
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    }).eq('id', item.id).eq('user_id', user.id)

    // 2. Cari harga modal dari master
    const masterSku = masterSkus.find(m => m.sku === chosenSku)
    const harga_modal = masterSku?.harga_modal ?? 0

    // 3. Update transaksi yang matching order_id + nama_produk
    if (item.raw_order_id && harga_modal > 0) {
      const qty = item.qty || 1
      await supabase.from('transactions').update({
        harga_modal:   harga_modal,
        sku:           chosenSku,
        unmatched_sku: false,
      })
      .eq('user_id', user.id)
      .eq('order_id', item.raw_order_id)
    }

    setSaving(null)
    setStatus({ type: 'success', msg: `✓ ${item.nama_produk ?? item.raw_sku} di-resolve ke SKU ${chosenSku}` })
    setTimeout(() => setStatus(null), 3000)
    load()
  }

  const filtered = items.filter(i => {
    if (filterResolved === 'pending')  return !i.resolved
    if (filterResolved === 'resolved') return  i.resolved
    return true
  })

  const pending  = items.filter(i => !i.resolved).length
  const resolved = items.filter(i =>  i.resolved).length
  const total    = items.length
  const matchRate = total > 0 ? ((resolved / total) * 100).toFixed(1) : '0'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Unmatched SKU"
        subtitle="Transaksi import yang SKU-nya tidak ditemukan di master"
      />

      {status && <Alert type={status.type} message={status.msg} onClose={() => setStatus(null)} />}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Unmatched', value: total, color: 'text-white' },
          { label: 'Belum Resolved', value: pending, color: 'text-red-400' },
          { label: 'Sudah Resolved', value: resolved, color: 'text-emerald-400' },
          { label: 'Resolve Rate', value: `${matchRate}%`, color: total > 0 && resolved === total ? 'text-emerald-400' : 'text-yellow-400' },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-gray-500">{s.label}</span>
            <span className={cn('text-xl font-bold tabular-nums', s.color)}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05] w-fit">
        {(['all','pending','resolved'] as const).map(v => (
          <button key={v} onClick={() => setFilterResolved(v)}
            className={cn('text-[10px] font-semibold px-3 py-1.5 rounded-lg transition-all',
              filterResolved === v ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300')}>
            {v === 'all' ? 'Semua' : v === 'pending' ? '⚠ Pending' : '✓ Resolved'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        {loading ? <LoadingSpinner /> : filtered.length === 0 ? (
          <EmptyState icon="✅" title={filterResolved === 'pending' ? 'Semua SKU sudah di-resolve!' : 'Tidak ada data'}
            desc={filterResolved === 'pending' ? 'Tidak ada transaksi dengan SKU unmatched' : ''} />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Tanggal Import</th>
                  <th>Order ID</th>
                  <th>SKU di File</th>
                  <th>Nama Produk</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  <th>Resolve ke SKU</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id}>
                    <td className="text-xs text-gray-500">{formatDate(item.created_at, 'd/M/yy HH:mm')}</td>
                    <td className="mono text-xs text-gray-400">{item.raw_order_id ?? '—'}</td>
                    <td>
                      <div className="mono text-xs text-red-400">{item.raw_sku || '(kosong)'}</div>
                      {item.raw_sku_induk && (
                        <div className="mono text-[10px] text-gray-600">induk: {item.raw_sku_induk}</div>
                      )}
                    </td>
                    <td className="max-w-[160px] truncate text-gray-200">{item.nama_produk ?? '—'}</td>
                    <td className="text-right">{item.qty}</td>
                    <td className="text-right text-orange-400">{formatRupiah(item.total_payment)}</td>
                    <td>
                      {item.resolved ? (
                        <div>
                          <span className="badge badge-green text-[10px]">✓ Resolved</span>
                          <div className="mono text-[10px] text-emerald-400 mt-0.5">{item.resolved_sku}</div>
                        </div>
                      ) : (
                        <span className="badge badge-red text-[10px]">⚠ Pending</span>
                      )}
                    </td>
                    <td>
                      {!item.resolved && (
                        <select
                          className="input text-xs w-44"
                          value={resolveMap[item.id] ?? ''}
                          onChange={e => setResolveMap(m => ({ ...m, [item.id]: e.target.value }))}>
                          <option value="">— Pilih SKU —</option>
                          {masterSkus.map(m => (
                            <option key={m.sku} value={m.sku}>
                              {m.sku} — {m.nama_produk} (Rp {m.harga_modal.toLocaleString('id-ID')})
                            </option>
                          ))}
                        </select>
                      )}
                      {item.resolved && item.resolved_sku && (
                        <span className="mono text-xs text-gray-500">{item.resolved_sku}</span>
                      )}
                    </td>
                    <td>
                      {!item.resolved && (
                        <button
                          className="btn-primary btn-xs"
                          disabled={!resolveMap[item.id] || saving === item.id}
                          onClick={() => resolveItem(item)}>
                          {saving === item.id ? '...' : 'Apply'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Guide */}
      <SectionCard title="💡 Cara Menggunakan">
        <div className="p-5 text-sm text-gray-400 space-y-2 leading-relaxed">
          <p>Halaman ini menampilkan transaksi Shopee yang diimport namun SKU-nya tidak ditemukan di Master SKU.</p>
          <p><span className="text-orange-400 font-medium">Langkah penyelesaian:</span></p>
          <ol className="list-decimal list-inside space-y-1.5 ml-2">
            <li>Pilih SKU yang tepat dari dropdown di kolom <strong className="text-gray-300">"Resolve ke SKU"</strong></li>
            <li>Klik tombol <strong className="text-gray-300">Apply</strong></li>
            <li>Sistem akan mengupdate transaksi terkait dengan harga modal dari master SKU yang dipilih</li>
          </ol>
          <p className="text-gray-600 text-xs mt-3">
            Tips: Pastikan master SKU sudah lengkap sebelum import data Shopee untuk mengurangi unmatched.
            Prioritas matching: <strong className="text-gray-400">Nomor Referensi SKU → SKU Induk</strong>
          </p>
        </div>
      </SectionCard>
    </div>
  )
}
