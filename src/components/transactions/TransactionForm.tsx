// src/components/transactions/TransactionForm.tsx
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { hitungProfit } from '@/types'
import type { TransactionFormData, ProfitCalc } from '@/types'
import { formatRupiah, todayStr, parseNumber, cn } from '@/lib/utils'
import { Alert } from '@/components/ui'
import { lookupHargaModalBySku } from '@/lib/daily-ads'
import { useRouter } from 'next/navigation'

// ─────────────────────────────────────────────────────────────────────────────
// Konstanta
// ─────────────────────────────────────────────────────────────────────────────

/** Nilai default form — nama field identik dengan TransactionFormData */
const EMPTY: TransactionFormData = {
  tanggal:                               todayStr(),
  order_id:                              '',
  nama_pembeli:                          '',
  sku_induk:                             '',
  nama_produk:                           '',
  variasi:                               '',
  qty:                                   1,
  total_harga_produk:                    0,
  voucher_ditanggung_penjual:            0,
  harga_modal_per_item:                  0,
  biaya_administrasi:                    0,
  biaya_program_hemat_biaya_kirim:       0,
  biaya_layanan_promo_xtra_gratis_ongkir_xtra: 0,
  biaya_proses_pesanan:                  0,
  biaya_transaksi_spaylater:             0,
  biaya_ams:                             0,
  catatan:                               '',
}

/** Fallback calc aman — dipakai saat hitungProfit belum bisa dijalankan */
const CALC_EMPTY: ProfitCalc = {
  total_harga_produk:  0,
  harga_modal_total:   0,
  total_biaya_shopee:  0,
  profit_bersih:       0,
  margin_persen:       0,
  breakdown: {
    voucher_ditanggung_penjual:               0,
    biaya_administrasi:                       0,
    biaya_program_hemat_biaya_kirim:          0,
    biaya_layanan_promo_xtra_gratis_ongkir_xtra: 0,
    biaya_proses_pesanan:                     0,
    biaya_transaksi_spaylater:                0,
    biaya_ams:                                0,
  },
}

/** 6 biaya Shopee — urutan dan label sesuai permintaan */
const BIAYA_FIELDS: ReadonlyArray<{
  field: keyof TransactionFormData
  label: string
}> = [
  { field: 'biaya_administrasi',                         label: 'Biaya Administrasi' },
  { field: 'biaya_program_hemat_biaya_kirim',            label: 'Biaya Program Hemat Biaya Kirim' },
  { field: 'biaya_layanan_promo_xtra_gratis_ongkir_xtra', label: 'Biaya Layanan Promo XTRA+ & Gratis Ongkir XTRA' },
  { field: 'biaya_proses_pesanan',                       label: 'Biaya Proses Pesanan' },
  { field: 'biaya_transaksi_spaylater',                  label: 'Biaya Transaksi (SPayLater)' },
  { field: 'biaya_ams',                                  label: 'Biaya AMS' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Helper: hitung profit dengan fallback aman
// ─────────────────────────────────────────────────────────────────────────────

function safeHitungProfit(form: TransactionFormData): ProfitCalc {
  try {
    const result = hitungProfit(form)
    // Pastikan breakdown tidak undefined
    if (!result || !result.breakdown) return CALC_EMPTY
    return result
  } catch {
    return CALC_EMPTY
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

type SkuStatus = 'idle' | 'loading' | 'found' | 'not_found'

interface SkuLookupResult {
  harga_modal: number
  nama_produk: string
  nama_variasi: string | null
}

function Field({
  label, required, hint, children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && (
          <span className="normal-case text-gray-600 font-normal ml-1 tracking-normal">
            ({hint})
          </span>
        )}
      </label>
      {children}
    </div>
  )
}

function NumField({
  label, required, hint, value, onChange,
}: {
  label: string
  required?: boolean
  hint?: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <input
        type="number"
        min={0}
        className="input"
        placeholder="0"
        value={value || ''}
        onChange={e => onChange(parseNumber(e.target.value))}
      />
    </Field>
  )
}

function SkuBadge({
  status, found, manualOverride, onRestore,
}: {
  status: SkuStatus
  found: SkuLookupResult | null
  manualOverride: boolean
  onRestore: () => void
}) {
  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 mt-1.5 px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-50" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500/60" />
        </span>
        <span className="text-[11px] text-gray-400">Mencari di master harga modal…</span>
      </div>
    )
  }

  if (status === 'found' && found) {
    return (
      <div className="mt-1.5 px-3 py-2 bg-emerald-500/8 border border-emerald-500/20 rounded-lg">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400 font-bold text-xs">✓</span>
            <span className="text-[11px] text-emerald-400 font-medium">SKU ditemukan</span>
          </div>
          {manualOverride && (
            <button
              type="button"
              onClick={onRestore}
              className="text-[10px] text-emerald-500/70 hover:text-emerald-400 underline transition-colors"
            >
              Pakai master ({formatRupiah(found.harga_modal)})
            </button>
          )}
        </div>
        <div className="text-[10px] text-emerald-400/60 mt-0.5">
          {found.nama_produk ?? ''}
          {found.nama_variasi ? <span className="ml-1">· {found.nama_variasi}</span> : null}
          {' '}· Modal: <strong>{formatRupiah(found.harga_modal)}</strong>
          {manualOverride && <span className="text-yellow-400/70 ml-1">· Override manual</span>}
        </div>
      </div>
    )
  }

  if (status === 'not_found') {
    return (
      <div className="flex items-center gap-2 mt-1.5 px-3 py-2 bg-yellow-500/6 border border-yellow-500/15 rounded-lg">
        <span className="text-yellow-400 text-xs shrink-0">⚠</span>
        <span className="text-[11px] text-yellow-400">
          SKU tidak ditemukan di master harga modal — isi harga modal secara manual
        </span>
      </div>
    )
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

interface TransactionFormProps {
  editId?: string
}

export default function TransactionForm({ editId }: TransactionFormProps) {
  const supabase = createClient()
  const router   = useRouter()

  // ── State ──────────────────────────────────────────────────────────────────
  const [form, setForm]             = useState<TransactionFormData>({ ...EMPTY })
  const [loading, setLoading]       = useState(false)
  const [loadingData, setLoadingData] = useState(!!editId)
  const [loadError, setLoadError]   = useState<string | null>(null)
  const [submitStatus, setSubmitStatus] = useState<{
    type: 'success' | 'error'; msg: string
  } | null>(null)
  const [dupCheck, setDupCheck]     = useState<null | 'checking' | 'ok' | 'dup'>(null)

  // SKU auto-fill
  const [skuStatus, setSkuStatus]           = useState<SkuStatus>('idle')
  const [skuFound, setSkuFound]             = useState<SkuLookupResult | null>(null)
  const [manualOverride, setManualOverride] = useState(false)

  const debounceTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastLookedUpSku = useRef('')
  const userIdRef       = useRef<string | null>(null)

  // Kalkulasi profit — selalu safe, tidak pernah crash
  const calc: ProfitCalc = safeHitungProfit(form)

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      userIdRef.current = data.user?.id ?? null
    })

    if (editId) {
      loadExisting(editId)
    } else {
      setForm({ ...EMPTY, tanggal: todayStr() })
      setLoadingData(false)
    }
  }, [editId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch & map data dari DB ke form ──────────────────────────────────────
  async function loadExisting(id: string) {
    setLoadingData(true)
    setLoadError(null)

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) {
      setLoadError('Gagal memuat data transaksi. Pastikan ID valid dan Anda punya akses.')
      setLoadingData(false)
      return
    }

    // Mapping DB → form state
    // Setiap field pakai fallback aman: field baru ?? field lama ?? default
    setForm({
      tanggal:      (data.tanggal ?? todayStr()) as string,
      order_id:     String(data.order_id ?? ''),
      nama_pembeli: String(data.nama_pembeli ?? ''),

      // Produk
      // Fallback: sku_induk (baru) → sku (lama)
      sku_induk:    String(data.sku_induk ?? data.sku ?? ''),
      nama_produk:  String(data.nama_produk ?? ''),
      variasi:      String(data.variasi ?? ''),
      qty:          Number(data.qty) || 1,

      // Revenue
      // Fallback: total_harga_produk (baru) → harga_jual (lama)
      total_harga_produk:         Number(data.total_harga_produk ?? data.harga_jual ?? 0),
      voucher_ditanggung_penjual: Number(data.voucher_ditanggung_penjual ?? 0),

      // Harga modal
      // Fallback: harga_modal_per_item (baru) → harga_modal (lama)
      harga_modal_per_item: Number(
        data.harga_modal_per_item ?? data.harga_modal ?? 0
      ),

      // 6 biaya Shopee
      // Fallback ke field lama untuk data transaksi manual sebelumnya
      biaya_administrasi:
        Number(data.biaya_administrasi ?? data.biaya_admin ?? 0),
      biaya_program_hemat_biaya_kirim:
        Number(data.biaya_program_hemat_biaya_kirim ?? data.biaya_program ?? 0),
      biaya_layanan_promo_xtra_gratis_ongkir_xtra:
        Number(data.biaya_layanan_promo_xtra_gratis_ongkir_xtra ?? data.biaya_layanan ?? 0),
      biaya_proses_pesanan:
        Number(data.biaya_proses_pesanan ?? 0),
      biaya_transaksi_spaylater:
        Number(data.biaya_transaksi_spaylater ?? data.biaya_affiliate ?? 0),
      biaya_ams:
        Number(data.biaya_ams ?? 0),

      catatan: String(data.catatan ?? ''),
    })

    setLoadingData(false)
  }

  // ── SKU auto-fill ──────────────────────────────────────────────────────────
  const performSkuLookup = useCallback(async (sku: string) => {
    const trimmed = sku.trim()

    if (!trimmed) {
      setSkuStatus('idle')
      setSkuFound(null)
      return
    }

    // Jangan re-query SKU yang sama
    if (trimmed === lastLookedUpSku.current && skuStatus === 'found') return

    const userId = userIdRef.current
    if (!userId) return

    setSkuStatus('loading')
    lastLookedUpSku.current = trimmed

    const result = await lookupHargaModalBySku(userId, trimmed)

    if (result) {
      setSkuStatus('found')
      setSkuFound(result)
      // Auto-fill hanya jika belum di-override manual
      setForm(prev => ({
        ...prev,
        harga_modal_per_item: manualOverride
          ? prev.harga_modal_per_item
          : (result.harga_modal ?? 0),
        // Auto-fill nama produk hanya jika masih kosong
        nama_produk: prev.nama_produk.trim()
          ? prev.nama_produk
          : (result.nama_produk ?? ''),
      }))
    } else {
      setSkuStatus('not_found')
      setSkuFound(null)
    }
  }, [manualOverride, skuStatus])

  function scheduleLookup(sku: string) {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    if (!sku.trim()) {
      setSkuStatus('idle')
      setSkuFound(null)
      lastLookedUpSku.current = ''
      return
    }
    debounceTimer.current = setTimeout(() => performSkuLookup(sku), 400)
  }

  function handleSkuChange(val: string) {
    setForm(prev => ({ ...prev, sku_induk: val }))
    setManualOverride(false)
    lastLookedUpSku.current = ''
    scheduleLookup(val)
  }

  function handleSkuBlur() {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    performSkuLookup(form.sku_induk)
  }

  function handleModalChange(val: string) {
    setForm(prev => ({ ...prev, harga_modal_per_item: parseNumber(val) }))
    if (skuStatus === 'found') setManualOverride(true)
  }

  function handleRestoreMaster() {
    if (!skuFound) return
    setForm(prev => ({ ...prev, harga_modal_per_item: skuFound!.harga_modal ?? 0 }))
    setManualOverride(false)
  }

  // ── Duplicate check ────────────────────────────────────────────────────────
  const checkDuplicate = useCallback(async () => {
    if (!form.order_id.trim() || editId) {
      setDupCheck(null)
      return
    }
    setDupCheck('checking')
    const userId = userIdRef.current
    if (!userId) return

    const { data } = await supabase
      .from('transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('order_id', form.order_id.trim())
      .maybeSingle()

    setDupCheck(data ? 'dup' : 'ok')
  }, [form.order_id, editId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(checkDuplicate, 600)
    return () => clearTimeout(t)
  }, [checkDuplicate])

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (dupCheck === 'dup' && !editId) {
      setSubmitStatus({ type: 'error', msg: 'Order ID sudah ada di database.' })
      return
    }

    setLoading(true)
    setSubmitStatus(null)

    const userId = userIdRef.current
    if (!userId) {
      setSubmitStatus({ type: 'error', msg: 'Sesi habis — silakan login ulang.' })
      setLoading(false)
      return
    }

    // Hitung derived fields sebelum simpan
    const c = safeHitungProfit(form)

    const payload = {
      user_id:      userId,
      tanggal:      form.tanggal,
      order_id:     form.order_id.trim(),
      nama_pembeli: form.nama_pembeli.trim() || null,

      // Field baru (nama sinkron dengan DB)
      sku_induk:    form.sku_induk.trim() || null,
      nama_produk:  form.nama_produk.trim(),
      variasi:      form.variasi.trim() || null,
      qty:          form.qty,

      total_harga_produk:         form.total_harga_produk,
      voucher_ditanggung_penjual: form.voucher_ditanggung_penjual,
      harga_modal_per_item:       form.harga_modal_per_item,

      // Derived: harga_modal_total dihitung dan disimpan
      harga_modal_total: c.harga_modal_total,

      // 6 biaya
      biaya_administrasi:                         form.biaya_administrasi,
      biaya_program_hemat_biaya_kirim:             form.biaya_program_hemat_biaya_kirim,
      biaya_layanan_promo_xtra_gratis_ongkir_xtra: form.biaya_layanan_promo_xtra_gratis_ongkir_xtra,
      biaya_proses_pesanan:                        form.biaya_proses_pesanan,
      biaya_transaksi_spaylater:                   form.biaya_transaksi_spaylater,
      biaya_ams:                                   form.biaya_ams,

      // Derived: total_biaya_shopee & profit
      total_biaya_shopee: c.total_biaya_shopee,
      profit:             c.profit_bersih,

      // Flag matching modal
      unmatched_modal: !form.sku_induk.trim() || skuStatus === 'not_found',

      catatan: form.catatan.trim() || null,
    }

    const { error } = editId
      // Scoped ke user login: double-check user_id agar tidak bisa edit milik user lain
      ? await supabase.from('transactions').update(payload).eq('id', editId).eq('user_id', userId)
      : await supabase.from('transactions').insert(payload)

    setLoading(false)

    if (error) {
      setSubmitStatus({
        type: 'error',
        msg: error.code === '23505'
          ? 'Order ID sudah ada (duplikat).'
          : (error.message ?? 'Terjadi kesalahan saat menyimpan.'),
      })
      return
    }

    setSubmitStatus({
      type: 'success',
      msg: editId ? '✓ Transaksi berhasil diperbarui.' : '✓ Transaksi berhasil disimpan.',
    })

    if (!editId) {
      // Reset form, pertahankan tanggal
      setForm({ ...EMPTY, tanggal: form.tanggal })
      setSkuStatus('idle')
      setSkuFound(null)
      setManualOverride(false)
      setDupCheck(null)
      lastLookedUpSku.current = ''
    }

    setTimeout(() => router.push('/dashboard/transactions'), 1200)
  }

  // ── Loading state saat fetch data edit ────────────────────────────────────
  if (loadingData) {
    return (
      <div className="max-w-4xl">
        <div className="card p-10 flex items-center justify-center gap-3 text-gray-500">
          <span className="w-5 h-5 border-2 border-gray-700 border-t-orange-500 rounded-full animate-spin shrink-0" />
          <span className="text-sm">Memuat data transaksi…</span>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="max-w-4xl">
        <div className="card p-6 border border-red-500/20 bg-red-500/5">
          <div className="text-sm text-red-400 font-medium">{loadError}</div>
          <button
            className="btn-secondary btn-sm mt-4"
            onClick={() => editId && loadExisting(editId)}
          >
            Coba lagi
          </button>
        </div>
      </div>
    )
  }

  // ── Render form ────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-4xl">
      {submitStatus && (
        <Alert
          type={submitStatus.type}
          message={submitStatus.msg}
          onClose={() => setSubmitStatus(null)}
        />
      )}

      {/* ── 1. Informasi Dasar ── */}
      <div className="card p-5">
        <div className="section-title">📋 Informasi Dasar</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          <Field label="Tanggal" required>
            <input
              type="date"
              className="input"
              value={form.tanggal}
              onChange={e => setForm(prev => ({ ...prev, tanggal: e.target.value }))}
              required
            />
          </Field>

          <Field label="Nomor Order" required>
            <div className="relative">
              <input
                type="text"
                className={cn(
                  'input pr-8',
                  dupCheck === 'dup' && 'border-red-500/50 focus:ring-red-500/30'
                )}
                placeholder="250408XXXXXX"
                value={form.order_id}
                onChange={e => setForm(prev => ({ ...prev, order_id: e.target.value }))}
                required
              />
              {dupCheck && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm pointer-events-none">
                  {dupCheck === 'checking' && <span className="text-gray-500 text-xs">…</span>}
                  {dupCheck === 'ok'       && <span className="text-emerald-400">✓</span>}
                  {dupCheck === 'dup'      && <span className="text-red-400">✕</span>}
                </div>
              )}
            </div>
            {dupCheck === 'dup' && (
              <p className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
                <span>⚠</span> Order ID sudah ada di database
              </p>
            )}
          </Field>

          <Field label="Nama Pembeli">
            <input
              type="text"
              className="input"
              placeholder="Opsional"
              value={form.nama_pembeli}
              onChange={e => setForm(prev => ({ ...prev, nama_pembeli: e.target.value }))}
            />
          </Field>

        </div>
      </div>

      {/* ── 2. Detail Produk ── */}
      <div className="card p-5">
        <div className="section-title">📦 Detail Produk</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          <div className="sm:col-span-2">
            <Field label="Nama Produk" required>
              <input
                type="text"
                className="input"
                placeholder="Nama produk"
                value={form.nama_produk}
                onChange={e => setForm(prev => ({ ...prev, nama_produk: e.target.value }))}
                required
              />
            </Field>
          </div>

          {/* SKU Induk — key matching harga modal */}
          <div>
            <label className="label">
              SKU Induk
              <span className="ml-1.5 normal-case text-[10px] text-orange-400/70 font-normal tracking-normal">
                ← key matching harga modal
              </span>
            </label>
            <input
              type="text"
              className={cn(
                'input transition-colors',
                skuStatus === 'found'     && 'border-emerald-500/40',
                skuStatus === 'not_found' && 'border-yellow-500/30',
              )}
              placeholder="SKU-IND-001"
              value={form.sku_induk}
              onChange={e => handleSkuChange(e.target.value)}
              onBlur={handleSkuBlur}
            />
            <SkuBadge
              status={skuStatus}
              found={skuFound}
              manualOverride={manualOverride}
              onRestore={handleRestoreMaster}
            />
          </div>

          <Field label="Variasi">
            <input
              type="text"
              className="input"
              placeholder="Merah / 1L / dll (opsional)"
              value={form.variasi}
              onChange={e => setForm(prev => ({ ...prev, variasi: e.target.value }))}
            />
          </Field>

          <NumField
            label="Qty"
            required
            value={form.qty}
            onChange={v => setForm(prev => ({ ...prev, qty: Math.max(1, Math.round(v) || 1) }))}
          />

          <NumField
            label="Total Harga Produk (Rp)"
            required
            hint="nilai final dari Shopee"
            value={form.total_harga_produk}
            onChange={v => setForm(prev => ({ ...prev, total_harga_produk: v }))}
          />

          <NumField
            label="Voucher Ditanggung Penjual (Rp)"
            hint="mengurangi profit"
            value={form.voucher_ditanggung_penjual}
            onChange={v => setForm(prev => ({ ...prev, voucher_ditanggung_penjual: v }))}
          />

          {/* Harga Modal per Item — auto-fill dari SKU */}
          <div>
            <label className="label">
              Harga Modal / item (Rp)
              <span className="text-red-500 ml-0.5">*</span>
            </label>
            <div className="relative">
              <input
                type="number"
                min={0}
                className={cn(
                  'input transition-colors',
                  skuStatus === 'found' && !manualOverride
                    && 'border-emerald-500/30 bg-emerald-500/[0.03] pr-8'
                )}
                placeholder="80000"
                value={form.harga_modal_per_item || ''}
                onChange={e => handleModalChange(e.target.value)}
                required
              />
              {skuStatus === 'found' && !manualOverride && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  <span className="text-emerald-400 text-xs" title="Auto-fill dari master harga modal">
                    ⚡
                  </span>
                </div>
              )}
            </div>
            {skuStatus === 'found' && !manualOverride && (
              <div className="text-[10px] text-emerald-400/60 mt-1">
                ⚡ Auto-fill dari master · ubah nilai untuk override
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── 3. Biaya Shopee ── */}
      <div className="card p-5">
        <div className="section-title">✂️ Biaya Shopee</div>
        <p className="text-[11px] text-gray-600 mb-4">
          Isi setelah mendapat data dari laporan Shopee. Saat import harian, biaya dihitung otomatis
          (8.25% admin + 10% layanan + Rp1.250 proses). Override di sini jika nilai aktual berbeda.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {BIAYA_FIELDS.map(({ field, label }) => (
            <NumField
              key={field}
              label={label}
              value={form[field] as number}
              onChange={v => setForm(prev => ({ ...prev, [field]: v }))}
            />
          ))}
        </div>

        {/* Total biaya indicator */}
        {calc.total_biaya_shopee > 0 && (
          <div className="mt-3 flex justify-between items-center px-3 py-2
            bg-red-500/6 border border-red-500/10 rounded-xl">
            <span className="text-sm text-gray-500">Total Biaya Shopee</span>
            <span className="text-sm text-red-400 font-semibold tabular-nums">
              − {formatRupiah(calc.total_biaya_shopee)}
            </span>
          </div>
        )}
      </div>

      {/* ── 4. Kalkulasi Real-time ── */}
      <div className="card p-5">
        <div className="section-title">🧮 Kalkulasi Profit</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Ringkasan */}
          {/* ── Ringkasan ── */}
          <div className="bg-white/[0.025] rounded-xl p-4 border border-white/[0.06]">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Ringkasan
            </div>
            <div className="space-y-2">
              {([
                {
                  label: 'Total Harga Produk',
                  value: calc.total_harga_produk,
                  cls:   'text-orange-400',
                  neg:   false,
                },
                {
                  label: `Modal Total (${form.qty} × ${formatRupiah(form.harga_modal_per_item)})`,
                  value: calc.harga_modal_total,
                  cls:   'text-red-400',
                  neg:   true,
                },
                {
                  label: 'Total Biaya Shopee (termasuk voucher)',
                  value: calc.total_biaya_shopee,
                  cls:   'text-red-400',
                  neg:   true,
                },
              ] as const).map(row => (
                <div key={row.label} className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">{row.label}</span>
                  <span className={cn('tabular-nums font-medium', row.cls)}>
                    {row.neg && row.value > 0 ? '− ' : ''}
                    {formatRupiah(Math.abs(row.value))}
                  </span>
                </div>
              ))}

              <div className="border-t border-white/[0.08] pt-2 mt-1 flex justify-between items-center">
                <span className="text-sm font-semibold text-gray-200">💰 Profit Bersih</span>
                <span className={cn(
                  'text-xl font-bold tabular-nums',
                  calc.profit_bersih >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {formatRupiah(calc.profit_bersih)}
                </span>
              </div>
            </div>
          </div>

          {/* ── Breakdown detail semua komponen pengurang ── */}
          <div className="bg-white/[0.025] rounded-xl p-4 border border-white/[0.06]">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Detail Biaya (Voucher + 6 Biaya Shopee)
            </div>
            <div className="space-y-1.5">
              {/* Voucher ditanggung penjual — dari breakdown, bukan root calc */}
              {(() => {
                const v = calc.breakdown?.voucher_ditanggung_penjual ?? 0
                return (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Voucher Ditanggung Penjual</span>
                    <span className={cn('tabular-nums ml-2 shrink-0', v > 0 ? 'text-red-400' : 'text-gray-700')}>
                      {v > 0 ? `− ${formatRupiah(v)}` : '—'}
                    </span>
                  </div>
                )
              })()}

              {/* 6 biaya Shopee */}
              {BIAYA_FIELDS.map(({ field, label }) => {
                const v: number = calc.breakdown?.[field as keyof typeof calc.breakdown] ?? 0
                return (
                  <div key={field} className="flex justify-between text-xs">
                    <span className="text-gray-500 truncate max-w-[200px]">{label}</span>
                    <span className={cn('tabular-nums ml-2 shrink-0', v > 0 ? 'text-red-400' : 'text-gray-700')}>
                      {v > 0 ? `− ${formatRupiah(v)}` : '—'}
                    </span>
                  </div>
                )
              })}

              <div className="border-t border-white/[0.08] pt-1.5 flex justify-between text-xs font-semibold">
                <span className="text-gray-400">Total</span>
                <span className="text-red-400 tabular-nums">
                  − {formatRupiah(calc.total_biaya_shopee)}
                </span>
              </div>
            </div>

            {/* Margin bar */}
            <div className="mt-4">
              <div className="flex justify-between text-[10px] text-gray-600 mb-1">
                <span>Margin Profit</span>
                <span className={calc.profit_bersih >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {isFinite(calc.margin_persen) ? calc.margin_persen.toFixed(1) : '0.0'}%
                </span>
              </div>
              <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    calc.profit_bersih >= 0 ? 'bg-emerald-500' : 'bg-red-500'
                  )}
                  style={{
                    width: `${Math.min(Math.abs(
                      isFinite(calc.margin_persen) ? calc.margin_persen : 0
                    ), 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

        </div>

        {/* Catatan */}
        <div className="mt-4">
          <Field label="Catatan">
            <textarea
              className="input min-h-[60px] resize-none"
              placeholder="Catatan tambahan (opsional)…"
              value={form.catatan}
              onChange={e => setForm(prev => ({ ...prev, catatan: e.target.value }))}
            />
          </Field>
        </div>
      </div>

      {/* ── Tombol Aksi ── */}
      <div className="flex gap-3 justify-end pb-6">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.back()}
          disabled={loading}
        >
          Batal
        </button>
        <button
          type="submit"
          className="btn-primary"
          disabled={loading || (dupCheck === 'dup' && !editId)}
        >
          {loading
            ? <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Menyimpan…
              </span>
            : editId ? '💾 Update Transaksi' : '💾 Simpan Transaksi'
          }
        </button>
      </div>
    </form>
  )
}
