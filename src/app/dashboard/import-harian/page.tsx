'use client'

import { useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, Alert, SectionCard } from '@/components/ui'
import { formatRupiah, cn } from '@/lib/utils'
import {
  parseShopeeFile,
  buildTransactionPayload,
  type ShopeeRow,
  type ImportSummary,
} from '@/lib/shopee-import'
import {
  calculateDefaultShopeeCosts,
  RATE_ADMINISTRASI,
  RATE_LAYANAN_TOTAL,
  BIAYA_PROSES_PESANAN_DEFAULT,
} from '@/lib/shopee-costs'

// ── Summary card kecil ────────────────────────────────────────
function SummaryCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: number | string
  sub?: string
  color: string
}) {
  return (
    <div className="bg-white/[0.025] border border-white/[0.06] rounded-2xl p-4 text-center">
      <div className={cn('text-3xl font-bold tabular-nums', color)}>{value}</div>
      <div className="text-xs font-semibold text-gray-400 mt-1">{label}</div>
      {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Kolom header yang terdeteksi ──────────────────────────────
const REQUIRED_HEADERS = [
  'No. Pesanan',
  'SKU Induk',
  'Nama Produk',
  'Jumlah',
  'Total Harga Produk',
]

const OPTIONAL_HEADERS = [
  'Status Pesanan',
  'No. Resi',
  'Opsi Pengiriman',
  'Waktu Pesanan Dibuat',
  'Metode Pembayaran',
  'Voucher Ditanggung Penjual',
]

// ── Halaman utama ─────────────────────────────────────────────
export default function ImportHarianPage() {
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  // File & parse state
  const [filename, setFilename] = useState('')
  const [rows, setRows] = useState<ShopeeRow[]>([])
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])

  // Import state
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [alert, setAlert] = useState<{
    type: 'success' | 'error' | 'info'
    msg: string
  } | null>(null)

  // Drag & drop
  const [dragging, setDragging] = useState(false)

  // ── Handle file pilih / drop ──────────────────────────────
  function processFile(file: File) {
    setSummary(null)
    setAlert(null)
    setRows([])
    setDetectedHeaders([])
    setParseErrors([])
    setFilename(file.name)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer
      const { rows: parsed, errors, headers } = parseShopeeFile(buffer, file.name)

      setDetectedHeaders(headers)
      setParseErrors(errors)

      if (errors.length > 0 && parsed.length === 0) {
        setAlert({ type: 'error', msg: errors[0] })
        return
      }

      setRows(parsed)

      if (parsed.length === 0) {
        setAlert({ type: 'error', msg: 'Tidak ada baris data yang valid ditemukan.' })
      } else {
        setAlert({
          type: 'info',
          msg: `File dibaca: ${parsed.length} baris siap diimport.${errors.length > 0 ? ` (${errors.length} baris dilewati)` : ''}`,
        })
      }
    }

    reader.readAsArrayBuffer(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  // ── Import ke Supabase ────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (rows.length === 0) return

    setImporting(true)
    setAlert(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setAlert({ type: 'error', msg: 'Sesi habis — silakan login ulang.' })
        setImporting(false)
        return
      }

      // 1. Load semua master_harga_modal user sekali → Map O(1) lookup
      const { data: masterData, error: masterError } = await supabase
        .from('master_harga_modal')
        .select('sku_induk, harga_modal, nama_produk')
        .eq('user_id', user.id)
        .eq('is_active', true)

      if (masterError) {
        setAlert({ type: 'error', msg: `Gagal load master harga modal: ${masterError.message}` })
        setImporting(false)
        return
      }

      const modalMap = new Map<string, { harga_modal: number; nama_produk: string }>()
      ;(masterData ?? []).forEach((m) => {
        if (m.sku_induk) {
          modalMap.set(String(m.sku_induk).toLowerCase().trim(), {
            harga_modal: Number(m.harga_modal || 0),
            nama_produk: m.nama_produk ?? '',
          })
        }
      })

      // 2. Build payloads
      const payloads = rows.map((row) => buildTransactionPayload(row, user.id, modalMap))

      // 3. Insert dalam batch — duplicate dilewati (TIDAK diupdate)
      const BATCH = 50
      let inserted   = 0
      let duplicates = 0
      let matched_modal   = 0
      let unmatched_modal = 0
      const errors: string[] = []

      for (let i = 0; i < payloads.length; i += BATCH) {
        const batchNum = Math.floor(i / BATCH) + 1
        const batch = payloads.slice(i, i + BATCH)

        // ── a. Dedupe dalam batch yang sama (order_id + sku_induk) ──
        const dedupedMap = new Map<string, (typeof batch)[number]>()
        batch.forEach((p) => {
          const key = `${p.user_id}__${p.order_id}__${p.sku_induk ?? ''}`
          dedupedMap.set(key, p)
        })
        const dedupedBatch = Array.from(dedupedMap.values())

        // ── b. Cek order_id yang sudah ada di DB ────────────────────
        const orderIds = Array.from(new Set(dedupedBatch.map((p) => p.order_id)))

        const { data: existing, error: existingError } = await supabase
          .from('transactions')
          .select('order_id, sku_induk')
          .eq('user_id', user.id)
          .in('order_id', orderIds)

        if (existingError) {
          errors.push(`Batch ${batchNum}: gagal cek duplikat — ${existingError.message}`)
          continue
        }

        // Set berisi "order_id__sku_induk" yang sudah ada di DB
        const existingSet = new Set(
          (existing ?? []).map((e) => `${e.order_id}__${e.sku_induk ?? ''}`)
        )

        // ── c. Pisahkan: baru vs duplikat ───────────────────────────
        const toInsert: (typeof batch) = []
        dedupedBatch.forEach((p) => {
          const key = `${p.order_id}__${p.sku_induk ?? ''}`
          if (existingSet.has(key)) {
            duplicates++
          } else {
            toInsert.push(p)
          }
        })

        if (toInsert.length === 0) continue   // semua duplikat, skip

        // ── d. Validasi tanggal sebelum insert ──────────────────────
        //    Tanggal harus YYYY-MM-DD (dari kolom Waktu Pesanan Dibuat)
        const invalidDate = toInsert.filter(
          (p) => !p.tanggal || !/^\d{4}-\d{2}-\d{2}$/.test(p.tanggal)
        )
        if (invalidDate.length > 0) {
          errors.push(
            `Batch ${batchNum}: ${invalidDate.length} baris tanggal tidak valid — ` +
            `pastikan kolom "Waktu Pesanan Dibuat" terisi. ` +
            `Contoh: ${invalidDate.slice(0, 3).map((p) => p.order_id).join(', ')}`
          )
        }

        // Hanya insert baris dengan tanggal valid
        const validToInsert = toInsert.filter(
          (p) => p.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(p.tanggal)
        )

        if (validToInsert.length === 0) continue

        // ── e. Insert baris baru ────────────────────────────────────
        const { error: insertError } = await supabase
          .from('transactions')
          .insert(validToInsert as any[])

        if (insertError) {
          errors.push(`Batch ${batchNum}: insert gagal — ${insertError.message}`)
          continue
        }

        inserted += validToInsert.length
        validToInsert.forEach((p) => {
          if (p.unmatched_modal) unmatched_modal++
          else matched_modal++
        })
      }

      const result: ImportSummary = {
        total_rows: rows.length,
        inserted,
        duplicates,
        matched_modal,
        unmatched_modal,
        skipped: parseErrors.length,
        errors: errors.slice(0, 20),
      }

      setSummary(result)

      const dupMsg = result.duplicates > 0 ? `, ${result.duplicates} duplikat dilewati` : ''
      if (errors.length === 0) {
        setAlert({
          type: 'success',
          msg: `✓ Import selesai: ${result.inserted} baru${dupMsg}, ${result.matched_modal} SKU matched.`,
        })
      } else {
        setAlert({
          type: 'info',
          msg: `Import selesai: ${result.inserted} baru${dupMsg}. Ada ${errors.length} error — cek detail di bawah.`,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Terjadi error saat import.'
      setAlert({ type: 'error', msg })
    } finally {
      setImporting(false)
    }
  }, [rows, parseErrors, supabase])

  // ── Header detection badge ────────────────────────────────
  function HeaderBadge({ label }: { label: string }) {
    const norm = label.toLowerCase()
    const found = detectedHeaders.some((h) => h.includes(norm.split(' ')[0]))

    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium',
          found
            ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
            : 'bg-white/[0.04] text-gray-600 ring-1 ring-white/[0.06]'
        )}
      >
        {found ? '✓' : '○'} {label}
      </span>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import Transaksi Harian Shopee"
        subtitle="Upload file Excel/CSV dari Shopee — sistem matching harga modal otomatis"
      />

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}

      <div
        className={cn(
          'card p-8 border-2 border-dashed transition-all cursor-pointer',
          dragging
            ? 'border-orange-500/60 bg-orange-500/5'
            : 'border-white/[0.08] hover:border-orange-500/30 hover:bg-white/[0.01]'
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileInput}
        />
        <div className="text-center select-none">
          <div className="text-4xl mb-3">🛒</div>
          <div className="text-sm font-semibold text-gray-300 mb-1">
            {filename ? (
              <>
                <span className="text-orange-400">{filename}</span> — klik untuk ganti
              </>
            ) : (
              'Klik atau drag & drop file Excel / CSV'
            )}
          </div>
          <div className="text-xs text-gray-600">Format: .xlsx, .xls, .csv</div>
        </div>
      </div>

      <SectionCard title="📋 Kolom yang Diperlukan">
        <div className="p-5 space-y-3">
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-2">
              Wajib
            </div>
            <div className="flex flex-wrap gap-2">
              {REQUIRED_HEADERS.map((h) => (
                <HeaderBadge key={h} label={h} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-2">
              Opsional
            </div>
            <div className="flex flex-wrap gap-2">
              {OPTIONAL_HEADERS.map((h) => (
                <HeaderBadge key={h} label={h} />
              ))}
            </div>
          </div>
          <div className="mt-3 p-3 bg-emerald-500/[0.06] border border-emerald-500/15 rounded-xl">
            <div className="text-[10px] text-emerald-400 font-semibold uppercase tracking-widest mb-1.5">
              ✨ Biaya Shopee Dihitung Otomatis Saat Import
            </div>
            <div className="text-[11px] text-gray-500 space-y-0.5">
              <div>• <span className="text-gray-400">Biaya Administrasi</span> = {(RATE_ADMINISTRASI * 100).toFixed(2)}% × Total Harga Produk</div>
              <div>• <span className="text-gray-400">Biaya Layanan (XTRA+ & Gratis Ongkir)</span> = {(RATE_LAYANAN_TOTAL * 100).toFixed(1)}% × Total Harga Produk</div>
              <div>• <span className="text-gray-400">Biaya Proses Pesanan</span> = {formatRupiah(BIAYA_PROSES_PESANAN_DEFAULT)} per transaksi (tetap)</div>
              <div>• Biaya Hemat Kirim, SPayLater, AMS = 0 (isi manual setelah import jika diperlukan)</div>
            </div>
          </div>
          <p className="text-[11px] text-gray-600 pt-2">
            Nama kolom dibaca otomatis (case-insensitive). Gunakan nama kolom persis seperti export Shopee.
            Semua biaya dapat diubah manual per transaksi setelah import.
          </p>
        </div>
      </SectionCard>

      {rows.length > 0 && !summary && (
        <SectionCard title={`Preview — ${rows.length} baris siap diimport`}>
          {(() => {
            // Hitung estimasi biaya Shopee untuk semua baris preview
            const estTotals = rows.reduce(
              (acc, r) => {
                const c = calculateDefaultShopeeCosts(r.total_harga_produk, r.voucher_ditanggung_penjual)
                return {
                  omzet:  acc.omzet  + r.total_harga_produk,
                  biaya:  acc.biaya  + c.total_biaya_shopee,
                }
              },
              { omzet: 0, biaya: 0 }
            )
            const estProfit = estTotals.omzet - estTotals.biaya // tanpa modal (belum tahu match rate)

            return (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 p-5 pb-0">
                <SummaryCard label="Total Baris" value={rows.length} color="text-white" />
                <SummaryCard
                  label="Punya SKU Induk"
                  value={rows.filter((r) => r.sku_induk?.trim()).length}
                  sub="akan di-match ke master"
                  color="text-orange-400"
                />
                <SummaryCard
                  label="Tanpa SKU Induk"
                  value={rows.filter((r) => !r.sku_induk?.trim()).length}
                  sub="harga modal = 0"
                  color="text-gray-500"
                />
                <SummaryCard
                  label="Est. Omzet"
                  value={formatRupiah(estTotals.omzet, true)}
                  sub="total_harga_produk"
                  color="text-emerald-400"
                />
                <SummaryCard
                  label="Est. Biaya Shopee"
                  value={formatRupiah(estTotals.biaya, true)}
                  sub={`${(RATE_ADMINISTRASI * 100).toFixed(2)}% + ${(RATE_LAYANAN_TOTAL * 100).toFixed(0)}% + Rp1.250`}
                  color="text-red-400"
                />
                <SummaryCard
                  label="Est. Profit (tanpa modal)"
                  value={formatRupiah(estProfit, true)}
                  sub="omzet − biaya shopee"
                  color={estProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}
                />
              </div>
            )
          })()}

          {parseErrors.length > 0 && (
            <div className="px-5 pt-4">
              <div className="bg-yellow-500/6 border border-yellow-500/15 rounded-xl p-3 space-y-1">
                <div className="text-[11px] font-semibold text-yellow-400 mb-1">
                  {parseErrors.length} baris dilewati saat parsing:
                </div>
                {parseErrors.map((e, i) => (
                  <div key={i} className="text-[11px] text-yellow-400/70 font-mono">
                    {e}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="p-5 pt-4">
            <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold mb-2">
              5 Baris Pertama
            </div>
            <div className="table-wrap rounded-xl overflow-hidden border border-white/[0.06]">
              <table className="dt">
                <thead>
                  <tr>
                    <th>No. Pesanan</th>
                    <th>Status</th>
                    <th>SKU Induk</th>
                    <th>Nama Produk</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Total Harga</th>
                    <th className="text-right">Voucher</th>
                    <th className="text-right text-red-400/80">Est. Biaya Shopee</th>
                    <th className="text-right text-emerald-400/80">Est. Profit*</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => {
                    const c = calculateDefaultShopeeCosts(r.total_harga_produk, r.voucher_ditanggung_penjual)
                    const estProfit = r.total_harga_produk - c.total_biaya_shopee
                    return (
                      <tr key={i}>
                        <td className="font-mono text-xs text-gray-300 max-w-[160px] truncate">
                          {r.order_id}
                        </td>
                        <td>
                          {r.status_pesanan ? (
                            <span className="badge badge-gray text-[10px]">{r.status_pesanan}</span>
                          ) : (
                            <span className="text-gray-700">—</span>
                          )}
                        </td>
                        <td className="font-mono text-xs">
                          {r.sku_induk ? (
                            <span className="text-orange-400">{r.sku_induk}</span>
                          ) : (
                            <span className="text-gray-700">—</span>
                          )}
                        </td>
                        <td className="max-w-[180px] truncate text-gray-300 text-sm">
                          {r.nama_produk ?? '—'}
                        </td>
                        <td className="text-right">{r.qty}</td>
                        <td className="text-right text-emerald-400 tabular-nums font-medium">
                          {formatRupiah(r.total_harga_produk)}
                        </td>
                        <td className="text-right tabular-nums text-gray-500">
                          {r.voucher_ditanggung_penjual > 0
                            ? formatRupiah(r.voucher_ditanggung_penjual)
                            : '—'}
                        </td>
                        <td className="text-right text-red-400/80 tabular-nums text-xs">
                          {formatRupiah(c.total_biaya_shopee)}
                        </td>
                        <td className={cn('text-right tabular-nums text-xs font-medium', estProfit >= 0 ? 'text-emerald-400/80' : 'text-red-400')}>
                          {formatRupiah(estProfit)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-gray-700 mt-1.5 px-1">
              * Est. Profit di preview belum dikurangi harga modal (akan dihitung saat import berdasarkan master harga modal).
            </div>
            {rows.length > 5 && (
              <div className="text-[11px] text-gray-600 mt-2 text-center">
                + {rows.length - 5} baris lainnya tidak ditampilkan
              </div>
            )}
          </div>

          <div className="px-5 pb-5 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              Import akan upsert berdasarkan{' '}
              <code className="text-orange-400 bg-orange-500/10 px-1 py-0.5 rounded">
                user_id + order_id + sku_induk
              </code>{' '}
              — duplikat item yang sama akan diperbarui, bukan dibuat ulang.
            </div>
            <button className="btn-primary" onClick={handleImport} disabled={importing}>
              {importing ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Mengimport & Matching...
                </span>
              ) : (
                `✅ Import ${rows.length} Transaksi`
              )}
            </button>
          </div>
        </SectionCard>
      )}

      {summary && (
        <SectionCard title="📊 Hasil Import">
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <SummaryCard label="Total Baris" value={summary.total_rows} color="text-white" />
              <SummaryCard label="Baru Ditambahkan" value={summary.inserted} color="text-emerald-400" />
              <SummaryCard
                label="Duplikat Dilewati"
                value={summary.duplicates}
                sub="sudah ada di DB"
                color={summary.duplicates > 0 ? 'text-yellow-400' : 'text-gray-600'}
              />
              <SummaryCard
                label="SKU Matched"
                value={summary.matched_modal}
                sub="harga modal terisi"
                color="text-emerald-400"
              />
              <SummaryCard
                label="SKU Unmatched"
                value={summary.unmatched_modal}
                sub="harga modal = 0"
                color={summary.unmatched_modal > 0 ? 'text-yellow-400' : 'text-gray-600'}
              />
              <SummaryCard
                label="Dilewati"
                value={summary.skipped}
                sub="order_id kosong"
                color={summary.skipped > 0 ? 'text-red-400' : 'text-gray-600'}
              />
            </div>

            {summary.total_rows > 0 && (
              <div className="bg-white/[0.02] rounded-xl p-4 border border-white/[0.05]">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold text-gray-400">Match Rate Harga Modal</span>
                  <span
                    className={cn(
                      'text-lg font-bold tabular-nums',
                      summary.matched_modal / summary.total_rows >= 0.9
                        ? 'text-emerald-400'
                        : summary.matched_modal / summary.total_rows >= 0.5
                          ? 'text-yellow-400'
                          : 'text-red-400'
                    )}
                  >
                    {Math.round((summary.matched_modal / summary.total_rows) * 100)}%
                  </span>
                </div>
                <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      summary.matched_modal / summary.total_rows >= 0.9
                        ? 'bg-emerald-500'
                        : summary.matched_modal / summary.total_rows >= 0.5
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    )}
                    style={{ width: `${(summary.matched_modal / summary.total_rows) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {summary.duplicates > 0 && (
              <div className="flex items-start gap-3 p-4 bg-blue-500/[0.06] border border-blue-500/15 rounded-xl">
                <span className="text-blue-400 text-lg shrink-0 mt-0.5">ℹ</span>
                <div>
                  <div className="text-sm font-semibold text-blue-400">
                    {summary.duplicates} transaksi sudah ada — tidak diubah
                  </div>
                  <div className="text-xs text-blue-400/70 mt-1">
                    Order ID yang sudah ada di database dilewati sepenuhnya.
                    Data lama tidak ditimpa. Jika perlu koreksi, edit transaksi secara manual
                    di halaman <strong>Semua Transaksi</strong>.
                  </div>
                </div>
              </div>
            )}

            {summary.unmatched_modal > 0 && (
              <div className="flex items-start gap-3 p-4 bg-yellow-500/6 border border-yellow-500/15 rounded-xl">
                <span className="text-yellow-400 text-lg shrink-0 mt-0.5">⚠</span>
                <div>
                  <div className="text-sm font-semibold text-yellow-400">
                    {summary.unmatched_modal} transaksi tanpa harga modal
                  </div>
                  <div className="text-xs text-yellow-400/70 mt-1">
                    SKU Induk tidak ditemukan di master harga modal.
                    Profit transaksi ini dihitung dengan harga modal = 0 (belum akurat).
                    Tambahkan SKU ke master harga modal lalu lakukan import ulang,
                    atau update harga modal per transaksi secara manual.
                  </div>
                </div>
              </div>
            )}

            {summary.errors.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-4">
                <div className="text-xs font-semibold text-red-400 mb-2">
                  Error saat upsert ({summary.errors.length}):
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {summary.errors.map((e, i) => (
                    <div key={i} className="text-[11px] text-red-400/70 font-mono">
                      {e}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(summary.inserted + summary.duplicates) > 0 && (
              <div className="p-4 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                <div className="text-xs font-semibold text-gray-400 mb-3">Langkah selanjutnya:</div>
                <div className="space-y-2 text-xs text-gray-500">
                  <div className="flex items-start gap-2">
                    <span className="text-orange-400 shrink-0">1.</span>
                    <span>
                      Biaya Shopee sudah dihitung otomatis (8.25% administrasi + 10% layanan + Rp1.250 proses).
                      Buka <strong className="text-gray-300">Semua Transaksi</strong> untuk koreksi jika nilai aktual berbeda.
                    </span>
                  </div>
                  {summary.unmatched_modal > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-orange-400 shrink-0">2.</span>
                      <span>
                        Tambahkan SKU Induk yang belum ada ke{' '}
                        <strong className="text-gray-300">Master Harga Modal</strong>, lalu import ulang file ini.
                      </span>
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <span className="text-orange-400 shrink-0">
                      {summary.unmatched_modal > 0 ? '3' : '2'}.
                    </span>
                    <span>
                      Catat biaya iklan harian di halaman{' '}
                      <strong className="text-gray-300">Iklan Harian</strong> untuk menghitung net profit.
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                className="btn-secondary btn-sm"
                onClick={() => {
                  setRows([])
                  setSummary(null)
                  setFilename('')
                  setDetectedHeaders([])
                  setParseErrors([])
                  setAlert(null)
                }}
              >
                ↩ Import File Lain
              </button>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}