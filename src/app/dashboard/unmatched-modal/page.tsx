// src/app/dashboard/unmatched-modal/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, EmptyState, LoadingSpinner, SectionCard, Alert } from '@/components/ui'
import { formatRupiah, formatDate, cn } from '@/lib/utils'
import type { MasterHargaModal } from '@/types'

interface UnmatchedTrx {
  id: string
  order_id: string | null
  sku_induk: string | null
  nama_produk: string | null
  qty: number
  total_harga_produk: number
  harga_modal_per_item: number
  unmatched_modal: boolean
  tanggal: string
  created_at: string
}

export default function UnmatchedModalPage() {
  const supabase = createClient()
  const [items, setItems]           = useState<UnmatchedTrx[]>([])
  const [loading, setLoading]       = useState(true)
  const [master, setMaster]         = useState<MasterHargaModal[]>([])
  const [resolveMap, setResolveMap] = useState<Record<string, string>>({})
  const [saving, setSaving]         = useState<string | null>(null)
  const [status, setStatus]         = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [filter, setFilter]         = useState<'pending' | 'all'>('pending')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: trx }, { data: hm }] = await Promise.all([
      // Baca langsung dari transactions — field unmatched_modal yang diset saat import
      supabase
        .from('transactions')
        .select('id, order_id, sku_induk, nama_produk, qty, total_harga_produk, harga_modal_per_item, unmatched_modal, tanggal, created_at')
        .eq('user_id', user.id)
        .eq('unmatched_modal', true)
        .order('created_at', { ascending: false }),
      supabase
        .from('master_harga_modal')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('sku_induk'),
    ])

    setItems(trx ?? [])
    setMaster(hm ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function resolveItem(item: UnmatchedTrx) {
    const chosenSku = resolveMap[item.id]
    if (!chosenSku) return
    setSaving(item.id)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(null); return }

    const hmRow     = master.find(m => m.sku_induk === chosenSku)
    const hargaModal = hmRow?.harga_modal ?? 0

    // Update transaksi: set harga modal + clear flag unmatched
    const { error } = await supabase
      .from('transactions')
      .update({
        sku_induk:            chosenSku,
        harga_modal_per_item: hargaModal,
        harga_modal_total:    hargaModal * item.qty,
        unmatched_modal:      false,
        // Recalculate profit: total_harga_produk - harga_modal_total - biaya_shopee
        // Disimpan sebagai field profit supaya dashboard langsung akurat
      })
      .eq('id', item.id)
      .eq('user_id', user.id)

    if (error) {
      setStatus({ type: 'error', msg: `Gagal: ${error.message}` })
      setSaving(null)
      return
    }

    setSaving(null)
    setStatus({
      type: 'success',
      msg: `✓ ${item.nama_produk ?? item.sku_induk} → SKU Induk: ${chosenSku} (modal Rp ${hargaModal.toLocaleString('id-ID')}/pcs)`,
    })
    setTimeout(() => setStatus(null), 4000)
    load()
  }

  const total   = items.length
  const pending = items.filter(i => i.unmatched_modal).length  // semua yang di sini masih unmatched
  // Setelah resolve, transaksi hilang dari list (unmatched_modal = false → tidak masuk query)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transaksi Unmatched Modal"
        subtitle="Transaksi import yang SKU Induk-nya tidak ditemukan di Master Harga Modal"
      />

      {status && <Alert type={status.type} message={status.msg} onClose={() => setStatus(null)} />}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Total Unmatched', value: total,   color: 'text-white' },
          { label: 'Belum Di-resolve', value: pending, color: pending > 0 ? 'text-red-400' : 'text-emerald-400' },
          { label: 'Master SKU Tersedia', value: master.length, color: 'text-blue-400' },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-gray-500">{s.label}</span>
            <span className={cn('text-xl font-bold tabular-nums', s.color)}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        {loading ? <LoadingSpinner /> : items.length === 0 ? (
          <EmptyState
            icon="✅"
            title="Semua transaksi sudah di-resolve!"
            desc="Tidak ada transaksi tanpa harga modal"
          />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Order ID</th>
                  <th>SKU Induk</th>
                  <th>Nama Produk</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Total Harga</th>
                  <th>Resolve ke SKU Induk</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td className="text-xs text-gray-500">{formatDate(item.tanggal, 'd/M/yy')}</td>
                    <td className="mono text-xs text-gray-400">{item.order_id?.slice(-12) ?? '—'}</td>
                    <td>
                      <div className="mono text-xs text-red-400">{item.sku_induk || '(kosong)'}</div>
                    </td>
                    <td className="max-w-[160px] truncate text-gray-200">{item.nama_produk ?? '—'}</td>
                    <td className="text-right">{item.qty}</td>
                    <td className="text-right text-orange-400 tabular-nums">{formatRupiah(item.total_harga_produk)}</td>
                    <td>
                      <select
                        className="input text-xs w-52"
                        value={resolveMap[item.id] ?? ''}
                        onChange={e => setResolveMap(m => ({ ...m, [item.id]: e.target.value }))}
                      >
                        <option value="">— Pilih SKU Induk —</option>
                        {master.map(m => (
                          <option key={m.sku_induk} value={m.sku_induk}>
                            {m.sku_induk} | {m.nama_produk} | {formatRupiah(m.harga_modal)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className="btn-primary btn-xs"
                        disabled={!resolveMap[item.id] || saving === item.id}
                        onClick={() => resolveItem(item)}
                      >
                        {saving === item.id ? '...' : 'Apply'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Guide */}
      <SectionCard title="💡 Panduan">
        <div className="p-5 text-sm text-gray-400 space-y-2 leading-relaxed">
          <p>Transaksi di sini adalah yang SKU Induk-nya tidak ditemukan di <strong className="text-gray-300">Master Harga Modal</strong> saat import.</p>
          <p>Akibatnya: <code className="text-orange-400">harga_modal_per_item = 0</code>, sehingga profit dihitung tanpa memperhitungkan modal.</p>
          <p><strong className="text-gray-300">Cara resolve:</strong></p>
          <ol className="list-decimal list-inside space-y-1 ml-2 text-xs">
            <li>Pilih SKU Induk yang tepat dari dropdown</li>
            <li>Klik <strong className="text-gray-300">Apply</strong></li>
            <li>Harga modal akan diupdate, transaksi hilang dari list ini, dan profit di dashboard langsung akurat</li>
          </ol>
          <p className="text-xs text-gray-600 mt-2">
            Tip terbaik: isi <strong className="text-gray-400">Master Harga Modal</strong> lengkap sebelum import Shopee, agar tidak ada unmatched.
          </p>
        </div>
      </SectionCard>
    </div>
  )
}
