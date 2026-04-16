// src/components/transactions/TransactionDetailModal.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal, ConfirmDialog } from '@/components/ui'
import { formatRupiah, formatDate, formatDatetime, cn } from '@/lib/utils'
import { hitungProfit } from '@/types'
import type { Transaction } from '@/types'

// ── 6 biaya baru ─────────────────────────────────────────────
const BIAYA_LABELS: { key: keyof Transaction; label: string }[] = [
  { key: 'biaya_administrasi',                         label: 'Biaya Administrasi' },
  { key: 'biaya_program_hemat_biaya_kirim',            label: 'Biaya Program Hemat Biaya Kirim' },
  { key: 'biaya_layanan_promo_xtra_gratis_ongkir_xtra', label: 'Biaya Layanan Promo XTRA+ & Gratis Ongkir XTRA' },
  { key: 'biaya_proses_pesanan',                       label: 'Biaya Proses Pesanan' },
  { key: 'biaya_transaksi_spaylater',                  label: 'Biaya Transaksi (SPayLater)' },
  { key: 'biaya_ams',                                  label: 'Biaya AMS' },
]

export default function TransactionDetailModal({
  transaction, open, onClose, onDeleted,
}: {
  transaction: Transaction | null
  open: boolean
  onClose: () => void
  onDeleted: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const supabase = createClient()
  const router   = useRouter()

  if (!transaction) return null
  const t = transaction

  // calc selalu safe — hitungProfit tidak pernah throw
  const calc = hitungProfit(t)

  async function handleDelete() {
    setDeleting(true)
    // Scoped ke user login: double-check user_id agar tidak bisa hapus milik user lain
    // walau RLS sudah melindungi di level DB
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setDeleting(false); return }
    await supabase.from('transactions').delete()
      .eq('id', t.id)
      .eq('user_id', user.id)   // ← app-level guard
    setDeleting(false)
    setConfirmOpen(false)
    onClose()
    onDeleted()
  }

  const harga_modal_per_item = t.harga_modal_per_item ?? (t as any).harga_modal ?? 0
  const total_harga_produk   = t.total_harga_produk   ?? (t as any).harga_jual  ?? 0

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t.nama_produk ?? 'Detail Transaksi'}
        maxWidth="max-w-3xl"
        footer={
          <div className="flex justify-between items-center">
            <button className="btn-danger btn-sm" onClick={() => setConfirmOpen(true)}>
              🗑 Hapus
            </button>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={onClose}>Tutup</button>
              <button className="btn-primary btn-sm"
                onClick={() => { onClose(); router.push(`/dashboard/transactions/${t.id}/edit`) }}>
                ✏️ Edit
              </button>
            </div>
          </div>
        }
      >
        <div className="p-6 space-y-5">

          {/* ── Status banner ── */}
          <div className={cn(
            'rounded-xl p-4 flex items-center justify-between',
            calc.profit_bersih >= 0
              ? 'bg-emerald-500/8 border border-emerald-500/15'
              : 'bg-red-500/8 border border-red-500/15'
          )}>
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-0.5">
                Profit Bersih
              </div>
              <div className={cn('text-2xl font-bold tabular-nums',
                calc.profit_bersih >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {formatRupiah(calc.profit_bersih)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-0.5">
                Margin
              </div>
              <div className={cn('text-xl font-bold',
                calc.profit_bersih >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {isFinite(calc.margin_persen) ? calc.margin_persen.toFixed(1) : '0.0'}%
              </div>
            </div>
          </div>

          {/* ── Info grid ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Tanggal',    value: formatDate((t as any).tanggal, 'EEEE, d MMMM yyyy') },
              { label: 'Order ID',   value: t.order_id,                          mono: true },
              { label: 'Pembeli',    value: (t as any).nama_pembeli ?? '—' },
              { label: 'SKU Induk',  value: t.sku_induk ?? '—',                  mono: true },
              { label: 'Variasi',    value: (t as any).variasi ?? '—' },
              { label: 'Qty',        value: `${t.qty} pcs` },
              { label: 'Total Harga Produk', value: formatRupiah(total_harga_produk) },
              { label: 'Modal/item', value: formatRupiah(harga_modal_per_item) },
            ].map(item => (
              <div key={item.label} className="bg-white/[0.025] rounded-xl p-3 border border-white/[0.05]">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest font-semibold mb-1">
                  {item.label}
                </div>
                <div className={cn(
                  'text-sm font-medium text-gray-200 truncate',
                  (item as any).mono && 'mono text-xs'
                )}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {/* ── Breakdown biaya + kalkulasi ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Kiri: breakdown semua komponen pengurang */}
            <div className="bg-white/[0.025] rounded-xl p-4 border border-white/[0.06]">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
                Biaya Shopee + Voucher
              </div>
              <div className="space-y-1.5">

                {/* Voucher — dari breakdown */}
                {(() => {
                  const v = calc.breakdown?.voucher_ditanggung_penjual ?? 0
                  return (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Voucher Ditanggung Penjual</span>
                      <span className={cn('tabular-nums', v > 0 ? 'text-red-400 font-medium' : 'text-gray-700')}>
                        {v > 0 ? `− ${formatRupiah(v)}` : '—'}
                      </span>
                    </div>
                  )
                })()}

                {/* 6 biaya Shopee */}
                {BIAYA_LABELS.map(b => {
                  const v = Number((t as any)[b.key] ?? 0)
                  return (
                    <div key={b.key} className="flex justify-between text-xs gap-2">
                      <span className="text-gray-500 shrink-0 truncate max-w-[180px]">{b.label}</span>
                      <span className={cn('tabular-nums shrink-0',
                        v > 0 ? 'text-red-400 font-medium' : 'text-gray-700')}>
                        {v > 0 ? `− ${formatRupiah(v)}` : '—'}
                      </span>
                    </div>
                  )
                })}

                <div className="border-t border-white/[0.08] pt-2 mt-1 flex justify-between">
                  <span className="text-xs font-semibold text-gray-400">Total Biaya</span>
                  <span className="text-sm font-bold text-red-400 tabular-nums">
                    − {formatRupiah(calc.total_biaya_shopee)}
                  </span>
                </div>
              </div>
            </div>

            {/* Kanan: kalkulasi profit */}
            <div className="bg-white/[0.025] rounded-xl p-4 border border-white/[0.06]">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
                Kalkulasi Profit
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Total Harga Produk</span>
                  <span className="text-orange-400 font-medium tabular-nums">
                    {formatRupiah(calc.total_harga_produk)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">
                    Modal Total
                    <span className="text-[10px] text-gray-600 ml-1">
                      ({t.qty}×{formatRupiah(harga_modal_per_item)})
                    </span>
                  </span>
                  <span className="text-red-400 tabular-nums">
                    − {formatRupiah(calc.harga_modal_total)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Total Biaya Shopee</span>
                  <span className="text-red-400 tabular-nums">
                    − {formatRupiah(calc.total_biaya_shopee)}
                  </span>
                </div>

                <div className="border-t border-white/[0.08] pt-3 mt-1">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-200">💰 Profit Bersih</span>
                    <span className={cn('text-2xl font-bold tabular-nums',
                      calc.profit_bersih >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {formatRupiah(calc.profit_bersih)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-600 mt-1">
                    <span>Margin</span>
                    <span className={calc.profit_bersih >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}>
                      {isFinite(calc.margin_persen) ? calc.margin_persen.toFixed(1) : '0.0'}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Catatan */}
          {(t as any).catatan && (
            <div className="bg-white/[0.025] rounded-xl p-3.5 border border-white/[0.05]">
              <div className="text-[9px] text-gray-600 uppercase tracking-widest font-semibold mb-1.5">
                Catatan
              </div>
              <div className="text-sm text-gray-300">{(t as any).catatan}</div>
            </div>
          )}

          {/* Timestamps */}
          <div className="text-[10px] text-gray-700 flex gap-3 flex-wrap">
            <span>Dibuat: {formatDatetime(t.created_at)}</span>
            <span>·</span>
            <span>Diperbarui: {formatDatetime(t.updated_at)}</span>
          </div>

        </div>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Hapus Transaksi?"
        message={`Transaksi ${t.order_id} — ${t.nama_produk ?? ''} akan dihapus permanen.`}
        confirmLabel="Ya, Hapus"
        loading={deleting}
      />
    </>
  )
}
