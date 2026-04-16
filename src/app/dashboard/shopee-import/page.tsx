// src/app/dashboard/shopee-import/page.tsx
'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, Alert, SectionCard } from '@/components/ui'
import { parseNumber, todayStr, formatRupiah, cn } from '@/lib/utils'
import {
  buildHargaModalMap, matchHargaModal, hitungProfitShopee,
  autoDetectShopeeColumns, detectSkuIndukColumn
} from '@/lib/harga-modal-matcher'
import type { MasterHargaModal, ShopeeImportSummary } from '@/types'
import * as XLSX from 'xlsx'

// ── Kolom yang perlu di-map dari file Shopee ──────────────────────
const FIELD_OPTIONS = [
  { value: '',                    label: '— Abaikan —' },
  { value: 'order_id',            label: 'No. Pesanan / Order ID *' },
  { value: 'tanggal',             label: 'Waktu Pesanan / Tanggal *' },
  { value: 'completed_at',        label: 'Waktu Selesai' },
  { value: 'sku_induk',           label: 'SKU Induk ← KEY MATCHING *' },
  { value: 'nama_produk',         label: 'Nama Produk' },
  { value: 'nama_variasi',        label: 'Nama Variasi' },
  { value: 'qty',                 label: 'Jumlah / Qty *' },
  { value: 'total_harga_produk',  label: 'Total Harga Produk ← REVENUE *' },
  { value: 'biaya_administrasi',  label: 'Biaya Administrasi' },
  { value: 'biaya_program_hemat_kirim',              label: 'Biaya Program Hemat Kirim' },
  { value: 'biaya_layanan_promo_xtra_gratis_ongkir', label: 'Biaya Layanan Promo Xtra / Gratis Ongkir Xtra' },
  { value: 'biaya_proses_pesanan',label: 'Biaya Proses Pesanan' },
  { value: 'biaya_transaksi_spaylater', label: 'Biaya Transaksi (SPayLater)' },
  { value: 'biaya_affiliate',     label: 'Biaya Affiliate' },
  { value: 'catatan',             label: 'Catatan' },
]

const NUM_FIELDS = new Set([
  'qty', 'total_harga_produk',
  'biaya_administrasi', 'biaya_program_hemat_kirim',
  'biaya_layanan_promo_xtra_gratis_ongkir', 'biaya_proses_pesanan',
  'biaya_transaksi_spaylater', 'biaya_affiliate',
])

export default function ShopeeImportPage() {
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)

  const [filename, setFilename]  = useState('')
  const [headers, setHeaders]    = useState<string[]>([])
  const [preview, setPreview]    = useState<string[][]>([])
  const [rawRows, setRawRows]    = useState<string[][]>([])
  const [mapping, setMapping]    = useState<Record<number, string>>({})
  const [skuIndukColIdx, setSkuIndukColIdx] = useState<number | null>(null)

  const [importing, setImporting] = useState(false)
  const [result, setResult]      = useState<ShopeeImportSummary | null>(null)
  const [alert, setAlert]        = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    setResult(null); setAlert(null)
    setFilename(file.name)

    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer),
          { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const parsed = XLSX.utils.sheet_to_json<string[]>(ws,
          { header: 1, raw: false, dateNF: 'yyyy-mm-dd' })

        if (parsed.length < 2) {
          setAlert({ type: 'error', msg: 'File kosong atau format tidak valid.' })
          return
        }

        const hdrs = (parsed[0] as string[]).map(String)
        const rows = (parsed.slice(1) as string[][]).filter(r => r.some(Boolean))

        setHeaders(hdrs)
        setPreview(rows.slice(0, 6))
        setRawRows(rows)

        // Auto-detect mapping kolom
        const detected = autoDetectShopeeColumns(hdrs)
        const autoMap: Record<number, string> = {}
        hdrs.forEach((_, i) => {
          for (const [field, colIdx] of Object.entries(detected)) {
            if (colIdx === i) autoMap[i] = field
          }
        })
        setMapping(autoMap)

        // Detect SKU Induk col
        const skuIdx = detectSkuIndukColumn(hdrs)
          ?? (detected['sku_induk'] !== undefined ? detected['sku_induk'] : null)
        setSkuIndukColIdx(skuIdx)

        setAlert({
          type: 'info',
          msg: `File dibaca: ${rows.length} baris. SKU Induk: ${skuIdx !== null ? `"${hdrs[skuIdx]}"` : 'belum terdeteksi — pilih manual'}.`
        })
      } catch {
        setAlert({ type: 'error', msg: 'Gagal membaca file.' })
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleImport() {
    setImporting(true); setResult(null); setAlert(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setAlert({ type: 'error', msg: 'Sesi habis.' }); setImporting(false); return }

    // Load semua master harga modal — buat map SEKALI
    const { data: masterData } = await supabase
      .from('master_harga_modal')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
    const hargaModalMap = buildHargaModalMap((masterData ?? []) as MasterHargaModal[])

    // Buat import log
    const { data: importLog } = await supabase.from('imports').insert({
      user_id: user.id, filename,
      total_rows: rawRows.length, status: 'pending',
    }).select('id').single()
    const importId = importLog?.id ?? null

    let success = 0, skipped = 0, matchedModal = 0, unmatchedModal = 0
    let totalModalTerhitung = 0, totalProfitTerhitung = 0
    const errors: string[] = []
    const unmatchedItems: Record<string, unknown>[] = []

    const BATCH = 50
    for (let bi = 0; bi < rawRows.length; bi += BATCH) {
      const batch = rawRows.slice(bi, bi + BATCH)
      const records: Record<string, unknown>[] = []

      for (let ri = 0; ri < batch.length; ri++) {
        const row     = batch[ri]
        const lineNum = bi + ri + 2

        // Map kolom ke field
        const rec: Record<string, unknown> = { user_id: user.id }
        Object.entries(mapping).forEach(([ci, field]) => {
          if (!field) return
          const val = String(row[parseInt(ci)] ?? '').trim()
          rec[field] = NUM_FIELDS.has(field) ? parseNumber(val) : (val || null)
        })

        // Default tanggal
        if (!rec.tanggal) rec.tanggal = todayStr()

        // Validasi wajib
        if (!rec.order_id) {
          errors.push(`Baris ${lineNum}: order_id kosong — dilewati`)
          continue
        }
        if (!rec.qty) rec.qty = 1

        // ── MATCHING SKU INDUK ── (KEY MATCHING UTAMA)
        // Ambil dari kolom yang di-map, atau fallback ke auto-detect
        let skuIndukFromRow = String(rec.sku_induk ?? '').trim()
        if (!skuIndukFromRow && skuIndukColIdx !== null) {
          skuIndukFromRow = String(row[skuIndukColIdx] ?? '').trim()
        }

        rec.sku_induk = skuIndukFromRow || null

        const matchResult = matchHargaModal(skuIndukFromRow, hargaModalMap)

        if (matchResult.matched) {
          matchedModal++
          rec.harga_modal_per_item = matchResult.harga_modal_per_item
          rec.unmatched_modal      = false

          // Update nama_produk dari master jika tidak ada dari file
          if (!rec.nama_produk && matchResult.nama_produk_master) {
            rec.nama_produk = matchResult.nama_produk_master
          }

          // Hitung derived fields
          const derived = hitungProfitShopee({
            total_harga_produk:                     Number(rec.total_harga_produk ?? 0),
            qty:                                    Number(rec.qty),
            harga_modal_per_item:                   matchResult.harga_modal_per_item,
            biaya_administrasi:                     Number(rec.biaya_administrasi ?? 0),
            biaya_program_hemat_kirim:              Number(rec.biaya_program_hemat_kirim ?? 0),
            biaya_layanan_promo_xtra_gratis_ongkir: Number(rec.biaya_layanan_promo_xtra_gratis_ongkir ?? 0),
            biaya_proses_pesanan:                   Number(rec.biaya_proses_pesanan ?? 0),
            biaya_transaksi_spaylater:              Number(rec.biaya_transaksi_spaylater ?? 0),
            biaya_affiliate:                        Number(rec.biaya_affiliate ?? 0),
          })

          totalModalTerhitung   += derived.harga_modal_total
          totalProfitTerhitung  += derived.profit
          // Catatan: generated columns di DB sudah hitung ini otomatis
          // kita store harga_modal_per_item, sisanya DB generate
        } else {
          unmatchedModal++
          rec.harga_modal_per_item = 0
          rec.unmatched_modal      = true

          unmatchedItems.push({
            user_id:            user.id,
            import_id:          importId,
            raw_order_id:       rec.order_id,
            raw_sku_induk:      skuIndukFromRow || null,
            nama_produk:        rec.nama_produk ?? null,
            nama_variasi:       rec.nama_variasi ?? null,
            qty:                rec.qty,
            total_harga_produk: rec.total_harga_produk ?? 0,
          })
        }

        records.push(rec)
      }

      if (!records.length) continue

      const { error } = await supabase
        .from('shopee_transactions')
        .upsert(records as any[], {
          onConflict: 'user_id,order_id,nama_produk',
          ignoreDuplicates: false,
        })

      if (error) errors.push(`Batch ${Math.floor(bi / BATCH) + 1}: ${error.message}`)
      else success += records.length
    }

    // Insert unmatched items
    if (unmatchedItems.length > 0) {
      await supabase.from('unmatched_modal_items')
        .insert(unmatchedItems as any[])
    }

    // Update import log
    if (importId) {
      await supabase.from('imports').update({
        total_rows: rawRows.length, success_rows: success,
        skipped_rows: skipped, error_rows: errors.length,
        status: errors.length === 0 ? 'done' : 'error',
        error_log: errors.slice(0, 20).map(e => ({ msg: e })),
      }).eq('id', importId)
    }

    const res: ShopeeImportSummary = {
      total_rows: rawRows.length, success, skipped,
      matched_modal: matchedModal, unmatched_modal: unmatchedModal,
      match_rate: rawRows.length > 0 ? (matchedModal / rawRows.length) * 100 : 0,
      total_modal_terhitung: totalModalTerhitung,
      total_profit_terhitung: totalProfitTerhitung,
      errors: errors.slice(0, 20),
    }
    setResult(res)
    setImporting(false)
    setAlert({
      type: errors.length === 0 ? 'success' : 'info',
      msg: `Import selesai: ${success} transaksi, ${matchedModal} SKU Induk matched (${res.match_rate.toFixed(1)}%).`
    })
  }

  const matchRatePct = result?.match_rate ?? 0
  const matchColor   = matchRatePct >= 90 ? 'text-emerald-400' : matchRatePct >= 60 ? 'text-yellow-400' : 'text-red-400'
  const matchBarCls  = matchRatePct >= 90 ? 'bg-emerald-500' : matchRatePct >= 60 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import Transaksi Shopee"
        subtitle="Upload file export Shopee — sistem otomatis matching SKU Induk ke Harga Modal"
      />

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}

      {/* Formula info */}
      <div className="bg-blue-500/6 border border-blue-500/15 rounded-2xl p-5">
        <div className="text-sm font-semibold text-blue-300 mb-3">📐 Formula Profit yang Digunakan</div>
        <div className="font-mono text-xs text-blue-200/70 leading-8 space-y-0.5">
          <div><span className="text-emerald-400">Profit</span> = <span className="text-orange-400">Total Harga Produk</span></div>
          <div className="pl-8">− ( Biaya Administrasi + Biaya Program Hemat Kirim</div>
          <div className="pl-10">+ Biaya Layanan Promo Xtra &amp; Gratis Ongkir Xtra</div>
          <div className="pl-10">+ Biaya Proses Pesanan + Biaya Transaksi SPayLater + Biaya Affiliate )</div>
          <div className="pl-8">− <span className="text-red-400">Harga Modal Total</span>  <span className="text-gray-600">( = Harga Modal/item × Qty )</span></div>
        </div>
        <div className="mt-3 text-[11px] text-blue-400/60 flex flex-wrap gap-4">
          <span>✓ Total Harga Produk dari Shopee sudah final (sudah × qty)</span>
          <span>✓ Harga Modal dikali qty oleh sistem</span>
          <span>✓ Key matching: SKU Induk saja</span>
        </div>
      </div>

      {/* Upload zone */}
      <div className="card p-6">
        <div className="border-2 border-dashed border-white/[0.08] hover:border-orange-500/40 rounded-2xl p-10 text-center cursor-pointer transition-all group"
          onClick={() => fileRef.current?.click()}>
          <div className="text-5xl mb-3 group-hover:scale-105 transition-transform">🛒</div>
          <div className="text-gray-300 font-semibold mb-1">
            {filename || 'Klik untuk pilih file export Shopee'}
          </div>
          <div className="text-gray-600 text-sm">Format: .xlsx, .xls, .csv</div>
        </div>
        <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleFile} />
      </div>

      {/* SKU Induk column selector */}
      {headers.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-sm font-semibold text-gray-200">Kolom SKU Induk</div>
            <div className="badge badge-orange text-[10px]">KEY MATCHING</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              {skuIndukColIdx !== null ? (
                <div className="flex items-center gap-2 p-3 bg-emerald-500/8 border border-emerald-500/20 rounded-xl">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <div>
                    <div className="text-sm text-emerald-400 font-semibold">"{headers[skuIndukColIdx]}"</div>
                    <div className="text-[10px] text-gray-600">Kolom {skuIndukColIdx + 1} — terdeteksi otomatis</div>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-red-500/8 border border-red-500/20 rounded-xl text-sm text-red-400">
                  ⚠ Kolom SKU Induk belum terdeteksi — pilih manual di kanan
                </div>
              )}
            </div>
            <div>
              <label className="label">Pilih / Ganti Kolom SKU Induk</label>
              <select className="input text-sm"
                value={skuIndukColIdx ?? ''}
                onChange={e => {
                  const idx = e.target.value === '' ? null : parseInt(e.target.value)
                  setSkuIndukColIdx(idx)
                  if (idx !== null) setMapping(m => ({ ...m, [idx]: 'sku_induk' }))
                }}>
                <option value="">— Pilih kolom —</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>Kol.{i + 1}: {h}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Column mapping */}
      {headers.length > 0 && (
        <SectionCard title="🗂️ Mapping Kolom">
          <div className="p-5">
            <p className="text-xs text-gray-500 mb-4">
              Petakan kolom dari file Shopee ke field sistem.
              Kolom <span className="text-orange-400 font-semibold">SKU Induk</span> adalah kunci matching harga modal.
              Kolom <span className="text-blue-400 font-semibold">Total Harga Produk</span> dipakai langsung sebagai revenue (tidak dikali qty lagi).
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {headers.map((h, i) => (
                <div key={i}>
                  <label className="label flex items-center gap-1.5 flex-wrap">
                    {h}
                    {mapping[i] === 'sku_induk' && <span className="badge badge-orange text-[9px]">SKU Induk</span>}
                    {mapping[i] === 'total_harga_produk' && <span className="badge badge-blue text-[9px]">Revenue</span>}
                  </label>
                  <select
                    className={cn('input text-xs',
                      mapping[i] === 'sku_induk' && 'border-orange-500/40',
                      mapping[i] === 'total_harga_produk' && 'border-blue-500/40'
                    )}
                    value={mapping[i] ?? ''}
                    onChange={e => {
                      const newMapping = { ...mapping, [i]: e.target.value }
                      setMapping(newMapping)
                      if (e.target.value === 'sku_induk') setSkuIndukColIdx(i)
                    }}>
                    {FIELD_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <SectionCard title={`Preview — ${preview.length} baris pertama dari ${rawRows.length} total`}>
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className={cn(
                      i === skuIndukColIdx && 'bg-orange-500/10 text-orange-400',
                      mapping[i] === 'total_harga_produk' && 'bg-blue-500/10 text-blue-400'
                    )}>
                      {h}
                      {mapping[i] && (
                        <div className={cn('text-[9px] font-normal tracking-normal normal-case mt-0.5',
                          mapping[i] === 'sku_induk' ? 'text-orange-400' :
                          mapping[i] === 'total_harga_produk' ? 'text-blue-400' : 'text-gray-600')}>
                          → {mapping[i]}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, ri) => (
                  <tr key={ri}>
                    {headers.map((_, ci) => (
                      <td key={ci} className={cn('text-xs',
                        ci === skuIndukColIdx && 'text-orange-400 font-mono font-semibold',
                        mapping[ci] === 'total_harga_produk' && 'text-blue-400 font-semibold tabular-nums'
                      )}>
                        {row[ci] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 pb-5 pt-4 flex items-center justify-between">
            <div className="text-xs text-gray-600">
              {skuIndukColIdx === null && (
                <span className="text-yellow-400">⚠ Kolom SKU Induk belum dipilih — harga modal tidak bisa di-match</span>
              )}
            </div>
            <button className="btn-primary" onClick={handleImport} disabled={importing}>
              {importing ? '⏳ Mengimport & Matching Harga Modal...' : `✅ Import ${rawRows.length} Baris`}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Result */}
      {result && (
        <SectionCard title="📊 Hasil Import">
          <div className="p-5 space-y-5">
            {/* Main counts */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total Baris', v: result.total_rows, cls: 'text-white' },
                { label: 'Berhasil Import', v: result.success, cls: 'text-emerald-400' },
                { label: 'SKU Match', v: result.matched_modal, cls: 'text-emerald-400' },
                { label: 'SKU Unmatched', v: result.unmatched_modal, cls: 'text-red-400' },
              ].map(item => (
                <div key={item.label} className="bg-white/[0.025] rounded-xl p-4 text-center border border-white/[0.05]">
                  <div className={cn('text-2xl font-bold tabular-nums', item.cls)}>{item.v}</div>
                  <div className="text-xs text-gray-500 mt-1">{item.label}</div>
                </div>
              ))}
            </div>

            {/* Match rate */}
            <div className="bg-white/[0.02] rounded-xl p-4 border border-white/[0.05]">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Match Rate SKU Induk</div>
                <div className={cn('text-2xl font-bold tabular-nums', matchColor)}>
                  {result.match_rate.toFixed(1)}%
                </div>
              </div>
              <div className="h-3 bg-white/[0.06] rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', matchBarCls)}
                  style={{ width: `${result.match_rate}%` }} />
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-0.5">Total Modal Terhitung</div>
                  <div className="text-lg font-bold text-red-400 tabular-nums">
                    {formatRupiah(result.total_modal_terhitung, true)}
                  </div>
                  <div className="text-[10px] text-gray-600">dari {result.matched_modal} transaksi matched</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-0.5">Estimasi Total Profit</div>
                  <div className={cn('text-lg font-bold tabular-nums',
                    result.total_profit_terhitung >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {formatRupiah(result.total_profit_terhitung, true)}
                  </div>
                  <div className="text-[10px] text-gray-600">hanya dari transaksi matched</div>
                </div>
              </div>
            </div>

            {result.unmatched_modal > 0 && (
              <div className="flex items-center justify-between bg-yellow-500/8 border border-yellow-500/20 rounded-xl px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-yellow-400">
                    {result.unmatched_modal} transaksi tanpa harga modal
                  </div>
                  <div className="text-xs text-yellow-400/70 mt-0.5">
                    Profitnya dihitung dengan harga modal = 0. Bisa diperbaiki di halaman Unmatched.
                  </div>
                </div>
                <a href="/dashboard/unmatched-modal"
                  className="btn-secondary btn-sm shrink-0 text-yellow-400 border-yellow-500/30">
                  Resolve →
                </a>
              </div>
            )}

            {result.errors.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2 font-medium">Detail Error ({result.errors.length}):</div>
                <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-3 space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red-400 mono">{e}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  )
}
