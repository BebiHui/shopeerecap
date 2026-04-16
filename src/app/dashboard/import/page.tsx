// src/app/dashboard/import/page.tsx
'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, Alert, SectionCard } from '@/components/ui'
import { downloadImportTemplate } from '@/lib/export'
import { parseNumber, todayStr, formatRupiah, cn } from '@/lib/utils'
import { buildSkuMap, matchSku, hitungModalFields, detectSkuColumn, detectSkuIndukColumn } from '@/lib/sku-matcher'
import type { MasterSku, ShopeeImportResult } from '@/types'
import * as XLSX from 'xlsx'

// ── Field options untuk mapping kolom (non-Shopee custom import) ──
const FIELD_OPTIONS = [
  { value: '', label: '— Abaikan —' },
  { value: 'tanggal',              label: 'Tanggal' },
  { value: 'order_id',             label: 'Order ID *' },
  { value: 'nama_pembeli',         label: 'Nama Pembeli' },
  { value: 'nama_produk',          label: 'Nama Produk *' },
  { value: 'sku',                  label: 'SKU (Referensi) *' },
  { value: 'sku_induk',            label: 'SKU Induk' },
  { value: 'variasi',              label: 'Variasi' },
  { value: 'qty',                  label: 'Qty *' },
  { value: 'harga_jual',           label: 'Harga Jual/item' },
  { value: 'diskon_produk',        label: 'Diskon Produk' },
  { value: 'voucher_shopee',       label: 'Voucher Shopee' },
  { value: 'biaya_admin',          label: 'Biaya Admin' },
  { value: 'biaya_layanan',        label: 'Biaya Layanan' },
  { value: 'biaya_program',        label: 'Biaya Program' },
  { value: 'biaya_affiliate',      label: 'Biaya Affiliate' },
  { value: 'ongkir_seller',        label: 'Ongkir Seller' },
  { value: 'biaya_iklan',          label: 'Biaya Iklan' },
  { value: 'total_diterima_manual',label: 'Total Diterima (override)' },
  { value: 'catatan',              label: 'Catatan' },
]

const NUM_FIELDS = new Set([
  'qty','harga_jual','harga_modal','diskon_produk','voucher_shopee',
  'biaya_admin','biaya_layanan','biaya_program','biaya_affiliate',
  'ongkir_seller','biaya_iklan','total_diterima_manual',
])

function autoMap(header: string): string {
  const h = header.toLowerCase().replace(/[\s\-\/]+/g, '_').replace(/[^a-z0-9_]/g, '')
  const patterns: [RegExp, string][] = [
    [/tanggal|tgl|date|waktu_pesanan|waktu_transaksi/, 'tanggal'],
    [/no_pesanan|no\.pesanan|order_id|nomor_pesanan|order_no/, 'order_id'],
    [/pembeli|buyer|pelanggan|username/, 'nama_pembeli'],
    [/nama_produk|nama_barang|product_name|nama_item|judul/, 'nama_produk'],
    [/nomor_referensi_sku|referensi_sku|sku_ref|no_ref_sku/, 'sku'],
    [/sku_induk|parent_sku/, 'sku_induk'],
    [/variasi|variant|opsi/, 'variasi'],
    [/^qty|jumlah|quantity|jml/, 'qty'],
    [/harga_jual|harga_asli|harga_deal|price/, 'harga_jual'],
    [/diskon_produk|disc_produk/, 'diskon_produk'],
    [/voucher|diskon_shopee|diskon_platform/, 'voucher_shopee'],
    [/biaya_admin|admin_fee|komisi/, 'biaya_admin'],
    [/biaya_layanan|service_fee|layanan/, 'biaya_layanan'],
    [/program|cashback|xtra|promo/, 'biaya_program'],
    [/affiliate|afiliasi/, 'biaya_affiliate'],
    [/ongkir|shipping|ongkos_kirim/, 'ongkir_seller'],
    [/iklan|ads/, 'biaya_iklan'],
    [/diterima|received|settlement|total_rilis/, 'total_diterima_manual'],
    [/catatan|note|remark/, 'catatan'],
  ]
  for (const [re, val] of patterns) if (re.test(h)) return val
  return ''
}

export default function ImportPage() {
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<'shopee' | 'custom'>('shopee')
  const [headers, setHeaders]   = useState<string[]>([])
  const [preview, setPreview]   = useState<string[][]>([])
  const [mapping, setMapping]   = useState<Record<number, string>>({})
  const [importing, setImporting] = useState(false)
  const [result, setResult]     = useState<ShopeeImportResult | null>(null)
  const [alert, setAlert]       = useState<{ type: 'success'|'error'|'info'; msg: string } | null>(null)
  const [filename, setFilename] = useState('')
  const [rawRows, setRawRows]   = useState<string[][]>([])

  // SKU column detection state
  const [skuColIdx, setSkuColIdx]       = useState<number | null>(null)
  const [skuIndukColIdx, setSkuIndukColIdx] = useState<number | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setResult(null); setAlert(null); setFilename(file.name)

    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const parsed = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' })
        if (parsed.length < 2) { setAlert({ type: 'error', msg: 'File kosong atau format tidak valid.' }); return }

        const hdrs = (parsed[0] as string[]).map(String)
        const rows = parsed.slice(1).filter(r => (r as string[]).some(Boolean)) as string[][]
        setHeaders(hdrs); setPreview(rows.slice(0, 6)); setRawRows(rows)

        const autoM: Record<number, string> = {}
        hdrs.forEach((h, i) => { autoM[i] = autoMap(h) })
        setMapping(autoM)

        // Detect SKU columns
        const skuIdx      = detectSkuColumn(hdrs)
        const skuIndukIdx = detectSkuIndukColumn(hdrs)
        setSkuColIdx(skuIdx)
        setSkuIndukColIdx(skuIndukIdx)

        setAlert({
          type: 'info',
          msg: `File dibaca: ${rows.length} baris. SKU col: ${skuIdx !== null ? hdrs[skuIdx] : 'tidak terdeteksi'}.`
        })
      } catch {
        setAlert({ type: 'error', msg: 'Gagal membaca file.' })
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleImport() {
    setImporting(true); setResult(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setAlert({ type: 'error', msg: 'Sesi habis.' }); setImporting(false); return }

    // Load semua master SKU user ini — buat map sekali untuk O(1) lookup
    const { data: masterSkuData } = await supabase
      .from('master_sku').select('*').eq('user_id', user.id).eq('is_active', true)
    const skuMap = buildSkuMap((masterSkuData ?? []) as MasterSku[])

    // Create import log record
    const { data: importLog } = await supabase.from('imports').insert({
      user_id: user.id, filename,
      total_rows: rawRows.length, status: 'pending'
    }).select('id').single()
    const importId = importLog?.id ?? null

    let success = 0, skipped = 0, matchedSku = 0, unmatchedSku = 0
    let totalModalMatched = 0
    const errors: string[] = []
    const unmatchedItems: Record<string, unknown>[] = []

    const BATCH = 50
    for (let bi = 0; bi < rawRows.length; bi += BATCH) {
      const batch = rawRows.slice(bi, bi + BATCH)
      const records: Record<string, unknown>[] = []

      for (let ri = 0; ri < batch.length; ri++) {
        const row = batch[ri]
        const globalIdx = bi + ri + 2  // 1-based + header

        const rec: Record<string, unknown> = { user_id: user.id }

        // Map kolom ke field
        Object.entries(mapping).forEach(([ci, field]) => {
          if (!field) return
          const val = String(row[parseInt(ci)] ?? '').trim()
          rec[field] = NUM_FIELDS.has(field) ? parseNumber(val) : (val || null)
        })

        if (!rec.tanggal) rec.tanggal = todayStr()
        if (!rec.order_id || !rec.nama_produk) {
          errors.push(`Baris ${globalIdx}: order_id atau nama_produk kosong — dilewati`)
          continue
        }
        if (!rec.qty) rec.qty = 1

        // ── SKU Matching ─────────────────────────────────
        // Ambil SKU dari kolom yang sudah di-map ke 'sku' atau dari auto-detect
        let skuFromRow = String(rec.sku ?? '').trim()
        let skuIndukFromRow = String(rec.sku_induk ?? '').trim()

        // Fallback: jika ada kolom sku yang terdeteksi tapi belum di-map
        if (!skuFromRow && skuColIdx !== null) {
          skuFromRow = String(row[skuColIdx] ?? '').trim()
        }
        if (!skuIndukFromRow && skuIndukColIdx !== null) {
          skuIndukFromRow = String(row[skuIndukColIdx] ?? '').trim()
        }

        rec.sku       = skuFromRow || null
        rec.sku_induk = skuIndukFromRow || null

        const match = matchSku(skuFromRow, skuIndukFromRow, skuMap)

        if (match.matched) {
          matchedSku++
          rec.harga_modal    = match.harga_modal
          rec.unmatched_sku  = false
          totalModalMatched += match.harga_modal * Number(rec.qty)

          // Hitung derived profit fields
          const derived = hitungModalFields(
            Number(rec.qty),
            match.harga_modal,
            Number(rec.qty) * Number(rec.harga_jual ?? 0),
            Number(rec.diskon_produk ?? 0),
            Number(rec.voucher_shopee ?? 0),
            Number(rec.biaya_admin ?? 0),
            Number(rec.biaya_layanan ?? 0),
            Number(rec.biaya_program ?? 0),
            Number(rec.biaya_affiliate ?? 0),
            Number(rec.ongkir_seller ?? 0),
            Number(rec.biaya_iklan ?? 0),
            rec.total_diterima_manual != null ? Number(rec.total_diterima_manual) : null,
          )
          Object.assign(rec, derived)
        } else {
          unmatchedSku++
          rec.harga_modal    = 0
          rec.unmatched_sku  = true

          // Log ke unmatched_import_items
          unmatchedItems.push({
            user_id:       user.id,
            import_id:     importId,
            raw_order_id:  rec.order_id,
            raw_sku:       skuFromRow || null,
            raw_sku_induk: skuIndukFromRow || null,
            nama_produk:   rec.nama_produk,
            nama_variasi:  rec.variasi ?? null,
            qty:           rec.qty,
            total_payment: rec.total_diterima_manual ?? 0,
          })
        }

        records.push(rec)
      }

      if (records.length > 0) {
        const { error } = await supabase.from('transactions')
          .upsert(records as any[], { onConflict: 'user_id,order_id,nama_produk', ignoreDuplicates: false })
        if (error) errors.push(`Batch ${Math.floor(bi/BATCH)+1}: ${error.message}`)
        else success += records.length
      }
    }

    // Insert unmatched items
    if (unmatchedItems.length > 0) {
      await supabase.from('unmatched_import_items').upsert(
        unmatchedItems as any[],
        { onConflict: 'id', ignoreDuplicates: false }
      )
    }

    // Update import log
    if (importId) {
      await supabase.from('imports').update({
        total_rows: rawRows.length, success_rows: success,
        skipped_rows: skipped, error_rows: errors.length,
        status: errors.length === 0 ? 'done' : 'error',
        error_log: errors.slice(0,20).map(e => ({ msg: e })),
      }).eq('id', importId)
    }

    const res: ShopeeImportResult = {
      total_rows: rawRows.length,
      success_rows: success,
      skipped_rows: skipped,
      matched_sku: matchedSku,
      unmatched_sku: unmatchedSku,
      match_rate: rawRows.length > 0 ? (matchedSku / rawRows.length) * 100 : 0,
      total_modal_matched: totalModalMatched,
      errors: errors.slice(0,20),
    }
    setResult(res)
    setImporting(false)
    setAlert({
      type: errors.length === 0 ? 'success' : 'info',
      msg: `Import selesai: ${success} baris, ${matchedSku} SKU matched (${res.match_rate.toFixed(1)}%).`
    })
  }

  const matchRatePct = result ? result.match_rate : 0
  const matchRateColor = matchRatePct >= 90 ? 'text-emerald-400' : matchRatePct >= 60 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="space-y-5">
      <PageHeader title="Import Data Transaksi" subtitle="Upload transaksi dari file CSV atau Excel Shopee" />

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}

      {/* Mode toggle */}
      <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05] w-fit">
        {(['shopee','custom'] as const).map(v => (
          <button key={v} onClick={() => setMode(v)}
            className={cn('text-xs font-semibold px-4 py-1.5 rounded-lg transition-all',
              mode === v ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300')}>
            {v === 'shopee' ? '🛒 Export Shopee (Auto)' : '📋 File Custom (Manual Map)'}
          </button>
        ))}
      </div>

      {/* Info banner */}
      {mode === 'shopee' && (
        <div className="bg-blue-500/8 border border-blue-500/15 rounded-xl p-4 text-sm text-blue-300">
          <p className="font-semibold mb-1">Mode Export Shopee</p>
          <p className="text-blue-400/80 text-xs">
            Sistem otomatis mendeteksi kolom SKU dari file export Shopee (field: "Nomor Referensi SKU" atau "SKU Induk").
            Harga modal diisi otomatis dari <strong>Master SKU</strong> berdasarkan SKU yang cocok.
            Transaksi tanpa SKU match dicatat di halaman <strong>Unmatched SKU</strong>.
          </p>
        </div>
      )}

      {/* Upload zone */}
      <div className="card p-6">
        <div className="border-2 border-dashed border-white/[0.08] hover:border-orange-500/40 rounded-2xl p-10 text-center cursor-pointer transition-all group"
          onClick={() => fileRef.current?.click()}>
          <div className="text-5xl mb-3 group-hover:scale-105 transition-transform">📁</div>
          <div className="text-gray-300 font-semibold mb-1">
            {filename || 'Klik untuk pilih file atau drag & drop'}
          </div>
          <div className="text-gray-600 text-sm">Format: .xlsx, .xls, .csv</div>
        </div>
        <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleFile} />
        <div className="mt-4 flex gap-3">
          <button className="btn-secondary btn-sm" onClick={downloadImportTemplate}>⬇ Template Custom</button>
        </div>
      </div>

      {/* SKU Detection info */}
      {headers.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Deteksi Kolom SKU</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/[0.025] rounded-xl p-3 border border-white/[0.05]">
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">Kolom SKU Utama</div>
              {skuColIdx !== null ? (
                <div className="text-sm text-emerald-400 font-semibold">
                  ✓ "{headers[skuColIdx]}" (kolom {skuColIdx + 1})
                </div>
              ) : (
                <div className="text-sm text-red-400">✗ Tidak terdeteksi otomatis</div>
              )}
              <div className="mt-1">
                <select className="input text-xs w-full" value={skuColIdx ?? ''} onChange={e => setSkuColIdx(e.target.value === '' ? null : parseInt(e.target.value))}>
                  <option value="">— Pilih manual —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h} (col {i+1})</option>)}
                </select>
              </div>
            </div>
            <div className="bg-white/[0.025] rounded-xl p-3 border border-white/[0.05]">
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">Kolom SKU Induk</div>
              {skuIndukColIdx !== null ? (
                <div className="text-sm text-emerald-400 font-semibold">
                  ✓ "{headers[skuIndukColIdx]}" (kolom {skuIndukColIdx + 1})
                </div>
              ) : (
                <div className="text-sm text-yellow-400">— Tidak terdeteksi (opsional)</div>
              )}
              <div className="mt-1">
                <select className="input text-xs w-full" value={skuIndukColIdx ?? ''} onChange={e => setSkuIndukColIdx(e.target.value === '' ? null : parseInt(e.target.value))}>
                  <option value="">— Pilih manual —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h} (col {i+1})</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column mapping */}
      {headers.length > 0 && (
        <SectionCard title="🗂️ Mapping Kolom">
          <div className="p-5">
            <p className="text-xs text-gray-500 mb-4">
              Petakan kolom file ke field sistem. Field <span className="text-orange-400 font-semibold">SKU</span> adalah kunci matching harga modal.
              <span className="text-gray-600 ml-2">Tips: Untuk export Shopee, cari kolom "Nomor Referensi SKU".</span>
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {headers.map((h, i) => (
                <div key={i}>
                  <label className="label flex items-center gap-1.5">
                    {h}
                    {mapping[i] === 'sku' && <span className="badge badge-orange text-[9px]">SKU Utama</span>}
                    {mapping[i] === 'sku_induk' && <span className="badge badge-blue text-[9px]">SKU Induk</span>}
                  </label>
                  <select className={cn('input text-xs', mapping[i] === 'sku' && 'border-orange-500/40')}
                    value={mapping[i] ?? ''}
                    onChange={e => {
                      setMapping(m => ({ ...m, [i]: e.target.value }))
                      if (e.target.value === 'sku') setSkuColIdx(i)
                      if (e.target.value === 'sku_induk') setSkuIndukColIdx(i)
                    }}>
                    {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <SectionCard title={`Preview (${preview.length} baris pertama)`}>
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className={cn(i === skuColIdx && 'bg-orange-500/10 text-orange-400')}>
                      <div>{h}</div>
                      {mapping[i] && (
                        <div className={cn('text-[9px] font-normal tracking-normal normal-case mt-0.5',
                          mapping[i] === 'sku' ? 'text-orange-400' : 'text-gray-600')}>
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
                      <td key={ci} className={cn('text-xs', ci === skuColIdx && 'text-orange-400 font-mono font-semibold')}>
                        {row[ci] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 pb-5 pt-4 flex justify-end">
            <button className="btn-primary" onClick={handleImport} disabled={importing}>
              {importing ? '⏳ Mengimport & Matching SKU...' : `✅ Import ${rawRows.length} Baris`}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Result */}
      {result && (
        <SectionCard title="📊 Hasil Import">
          <div className="p-5 space-y-4">
            {/* Main stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-white/[0.025] rounded-xl p-4 text-center border border-white/[0.05]">
                <div className="text-2xl font-bold text-white tabular-nums">{result.total_rows}</div>
                <div className="text-xs text-gray-500 mt-1">Total Baris</div>
              </div>
              <div className="bg-emerald-500/8 border border-emerald-500/15 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-emerald-400 tabular-nums">{result.success_rows}</div>
                <div className="text-xs text-gray-500 mt-1">Berhasil Diimport</div>
              </div>
              <div className="bg-red-500/8 border border-red-500/15 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-red-400 tabular-nums">{result.errors.length}</div>
                <div className="text-xs text-gray-500 mt-1">Error</div>
              </div>
            </div>

            {/* SKU matching stats */}
            <div className="bg-white/[0.02] rounded-xl p-4 border border-white/[0.05]">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Hasil Matching SKU</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-0.5">SKU Matched</div>
                  <div className="text-xl font-bold text-emerald-400 tabular-nums">{result.matched_sku}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-0.5">SKU Unmatched</div>
                  <div className="text-xl font-bold text-red-400 tabular-nums">{result.unmatched_sku}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-0.5">Match Rate</div>
                  <div className={cn('text-xl font-bold tabular-nums', matchRateColor)}>{result.match_rate.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-0.5">Total Modal Terhitung</div>
                  <div className="text-base font-bold text-orange-400 tabular-nums">{formatRupiah(result.total_modal_matched, true)}</div>
                </div>
              </div>

              {/* Match rate bar */}
              <div className="mt-3">
                <div className="flex justify-between text-[10px] text-gray-600 mb-1">
                  <span>Match rate</span>
                  <span>{result.match_rate.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all',
                    matchRatePct >= 90 ? 'bg-emerald-500' : matchRatePct >= 60 ? 'bg-yellow-500' : 'bg-red-500')}
                    style={{ width: `${result.match_rate}%` }} />
                </div>
              </div>

              {result.unmatched_sku > 0 && (
                <div className="mt-3 bg-red-500/8 border border-red-500/15 rounded-lg px-3 py-2 text-xs text-red-400 flex items-center justify-between">
                  <span>{result.unmatched_sku} transaksi tidak memiliki harga modal (SKU tidak ditemukan di master)</span>
                  <a href="/dashboard/sku-unmatched" className="text-orange-400 hover:text-orange-300 font-semibold ml-2 shrink-0">
                    Resolve →
                  </a>
                </div>
              )}
            </div>

            {result.errors.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2 font-medium">Detail Error:</div>
                <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-3 space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => <div key={i} className="text-xs text-red-400 mono">{e}</div>)}
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  )
}
