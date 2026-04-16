// src/app/dashboard/sku/page.tsx
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  PageHeader, EmptyState, LoadingSpinner, Modal,
  Alert, ConfirmDialog, SectionCard
} from '@/components/ui'
import { formatRupiah, formatDate, formatDatetime, parseNumber, cn } from '@/lib/utils'
import type { MasterSku, MasterSkuFormData, SkuCostHistory } from '@/types'
import { exportMasterSkuXLSX, downloadMasterSkuTemplate } from '@/lib/sku-export'
import * as XLSX from 'xlsx'

const EMPTY_FORM: MasterSkuFormData = {
  sku: '', sku_induk: '', nama_produk: '', nama_variasi: '',
  harga_modal: 0, kategori: '', supplier: '', catatan: '', is_active: true,
}

// ── Inline edit component ─────────────────────────────────────
function InlineEdit({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  function commit() {
    const n = parseNumber(val)
    if (n !== value) onSave(n)
    setEditing(false)
  }

  if (!editing) return (
    <button onClick={() => { setVal(String(value)); setEditing(true) }}
      className="text-sm font-semibold text-orange-400 hover:text-orange-300 hover:underline tabular-nums transition-colors">
      {formatRupiah(value)}
    </button>
  )
  return (
    <div className="flex items-center gap-1">
      <input ref={inputRef} type="number" className="w-28 bg-white/[0.06] border border-orange-500/40 rounded-lg px-2 py-1 text-sm text-white tabular-nums focus:outline-none"
        value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
      <button onClick={commit} className="text-emerald-400 hover:text-emerald-300 text-xs font-bold px-1">✓</button>
      <button onClick={() => setEditing(false)} className="text-gray-500 hover:text-gray-300 text-xs px-1">✕</button>
    </div>
  )
}

export default function SkuPage() {
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)

  const [skus, setSkus]           = useState<MasterSku[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all')
  const [filterKat, setFilterKat] = useState('')
  const [allKategori, setAllKategori] = useState<string[]>([])

  const [modalOpen, setModalOpen]   = useState(false)
  const [editSku, setEditSku]       = useState<MasterSku | null>(null)
  const [form, setForm]             = useState<MasterSkuFormData>({ ...EMPTY_FORM })
  const [saving, setSaving]         = useState(false)
  const [deleteId, setDeleteId]     = useState<string | null>(null)
  const [status, setStatus]         = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory]         = useState<SkuCostHistory[]>([])
  const [histSku, setHistSku]         = useState('')

  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult]   = useState<{ upserted: number; errors: string[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('master_sku').select('*').eq('user_id', user.id).order('sku')
    if (data) {
      setSkus(data)
      setAllKategori([...new Set(data.map(s => s.kategori).filter(Boolean) as string[])].sort())
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function flashStatus(type: 'success' | 'error' | 'info', msg: string) {
    setStatus({ type, msg })
    setTimeout(() => setStatus(null), 3500)
  }

  // Filter + search
  const filtered = skus.filter(s => {
    if (filterActive === 'active'   && !s.is_active) return false
    if (filterActive === 'inactive' && s.is_active)  return false
    if (filterKat && s.kategori !== filterKat) return false
    if (search) {
      const q = search.toLowerCase()
      return s.sku.toLowerCase().includes(q)
        || s.nama_produk.toLowerCase().includes(q)
        || (s.sku_induk ?? '').toLowerCase().includes(q)
        || (s.nama_variasi ?? '').toLowerCase().includes(q)
        || (s.supplier ?? '').toLowerCase().includes(q)
    }
    return true
  })

  // Stats
  const activeCount   = skus.filter(s => s.is_active).length
  const inactiveCount = skus.length - activeCount

  // CRUD
  function openNew() { setEditSku(null); setForm({ ...EMPTY_FORM }); setModalOpen(true) }
  function openEdit(s: MasterSku) {
    setEditSku(s)
    setForm({
      sku: s.sku, sku_induk: s.sku_induk ?? '', nama_produk: s.nama_produk,
      nama_variasi: s.nama_variasi ?? '', harga_modal: s.harga_modal,
      kategori: s.kategori ?? '', supplier: s.supplier ?? '',
      catatan: s.catatan ?? '', is_active: s.is_active,
    })
    setModalOpen(true)
  }

  async function saveSku() {
    if (!form.sku.trim() || !form.nama_produk.trim()) {
      flashStatus('error', 'SKU dan Nama Produk wajib diisi.')
      return
    }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const payload = {
      user_id:      user.id,
      sku:          form.sku.trim().toUpperCase(),
      sku_induk:    form.sku_induk.trim() || null,
      nama_produk:  form.nama_produk.trim(),
      nama_variasi: form.nama_variasi.trim() || null,
      harga_modal:  form.harga_modal,
      kategori:     form.kategori.trim() || null,
      supplier:     form.supplier.trim() || null,
      catatan:      form.catatan.trim() || null,
      is_active:    form.is_active,
    }

    const { error } = editSku
      ? await supabase.from('master_sku').update(payload).eq('id', editSku.id)
      : await supabase.from('master_sku').insert(payload)

    setSaving(false)
    if (error) {
      flashStatus('error', error.code === '23505' ? `SKU "${form.sku}" sudah ada.` : error.message)
    } else {
      setModalOpen(false)
      load()
      flashStatus('success', editSku ? `SKU ${form.sku} diperbarui.` : `SKU ${form.sku} ditambahkan.`)
    }
  }

  // Quick inline update harga modal
  async function quickUpdateModal(id: string, sku: string, newModal: number) {
    await supabase.from('master_sku').update({ harga_modal: newModal }).eq('id', id)
    setSkus(prev => prev.map(s => s.id === id ? { ...s, harga_modal: newModal } : s))
    flashStatus('success', `Harga modal ${sku} diperbarui → ${formatRupiah(newModal)}`)
  }

  async function deleteSku() {
    if (!deleteId) return
    await supabase.from('master_sku').delete().eq('id', deleteId)
    setDeleteId(null)
    load()
    flashStatus('info', 'SKU dihapus.')
  }

  async function toggleActive(s: MasterSku) {
    await supabase.from('master_sku').update({ is_active: !s.is_active }).eq('id', s.id)
    setSkus(prev => prev.map(x => x.id === s.id ? { ...x, is_active: !s.is_active } : x))
  }

  async function showHistory(sku: string) {
    setHistSku(sku)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('sku_cost_history')
      .select('*').eq('user_id', user.id).eq('sku', sku)
      .order('changed_at', { ascending: false }).limit(30)
    setHistory(data ?? [])
    setHistoryOpen(true)
  }

  // Import master SKU dari Excel
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImportLoading(true); setImportResult(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const reader = new FileReader()
    reader.onload = async ev => {
      const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { raw: false })

      let upserted = 0
      const errors: string[] = []

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const sku = (r['sku'] || r['SKU'] || '').trim().toUpperCase()
        const nama = (r['nama_produk'] || r['Nama Produk'] || '').trim()
        const modal = parseNumber(r['harga_modal'] || r['Harga Modal'] || '0')

        if (!sku) { errors.push(`Baris ${i + 2}: kolom SKU kosong`); continue }
        if (!nama) { errors.push(`Baris ${i + 2}: kolom nama_produk kosong`); continue }

        const payload = {
          user_id:      user.id,
          sku,
          sku_induk:    (r['sku_induk'] || r['SKU Induk'] || '').trim() || null,
          nama_produk:  nama,
          nama_variasi: (r['nama_variasi'] || r['Nama Variasi'] || '').trim() || null,
          harga_modal:  modal,
          kategori:     (r['kategori'] || r['Kategori'] || '').trim() || null,
          supplier:     (r['supplier'] || r['Supplier'] || '').trim() || null,
          catatan:      (r['catatan'] || r['Catatan'] || '').trim() || null,
          is_active:    true,
        }

        const { error } = await supabase.from('master_sku')
          .upsert(payload, { onConflict: 'user_id,sku' })
        if (error) errors.push(`Baris ${i + 2} (${sku}): ${error.message}`)
        else upserted++
      }

      setImportResult({ upserted, errors: errors.slice(0, 20) })
      setImportLoading(false)
      load()
      flashStatus(errors.length === 0 ? 'success' : 'info', `Import selesai: ${upserted} SKU diproses.`)
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Master SKU & Harga Modal"
        subtitle={`${skus.length} SKU terdaftar · Harga modal acuan untuk kalkulasi profit`}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={importLoading}>
              {importLoading ? '⏳' : '📤'} Import Excel
            </button>
            <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleImportFile} />
            <button className="btn-secondary btn-sm" onClick={() => exportMasterSkuXLSX(filtered)}>⬇ Export</button>
            <button className="btn-primary btn-sm" onClick={openNew}>+ Tambah SKU</button>
          </div>
        }
      />

      {status && <Alert type={status.type} message={status.msg} onClose={() => setStatus(null)} />}

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total SKU', value: skus.length, color: 'text-white' },
          { label: 'SKU Aktif', value: activeCount, color: 'text-emerald-400' },
          { label: 'SKU Nonaktif', value: inactiveCount, color: 'text-gray-500' },
          { label: 'Kategori', value: allKategori.length, color: 'text-blue-400' },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-gray-500">{s.label}</span>
            <span className={cn('text-xl font-bold tabular-nums', s.color)}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Import result */}
      {importResult && (
        <SectionCard title="📊 Hasil Import Master SKU">
          <div className="p-4 grid grid-cols-2 gap-4">
            <div className="bg-emerald-500/8 border border-emerald-500/15 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-emerald-400">{importResult.upserted}</div>
              <div className="text-xs text-gray-500 mt-1">SKU diproses (baru/update)</div>
            </div>
            <div className="bg-red-500/8 border border-red-500/15 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{importResult.errors.length}</div>
              <div className="text-xs text-gray-500 mt-1">Error</div>
            </div>
          </div>
          {importResult.errors.length > 0 && (
            <div className="px-4 pb-4 space-y-1">
              {importResult.errors.map((e, i) => (
                <div key={i} className="text-xs text-red-400 mono">{e}</div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input type="text" className="input w-64 text-sm" placeholder="🔍 Cari SKU, nama produk, supplier..."
            value={search} onChange={e => setSearch(e.target.value)} />

          <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05]">
            {(['all','active','inactive'] as const).map(v => (
              <button key={v} onClick={() => setFilterActive(v)}
                className={cn('text-[10px] font-semibold px-3 py-1.5 rounded-lg transition-all',
                  filterActive === v ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300')}>
                {v === 'all' ? 'Semua' : v === 'active' ? '✓ Aktif' : '✗ Nonaktif'}
              </button>
            ))}
          </div>

          {allKategori.length > 0 && (
            <select className="input text-xs w-40" value={filterKat} onChange={e => setFilterKat(e.target.value)}>
              <option value="">Semua Kategori</option>
              {allKategori.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          )}

          <button className="btn-secondary btn-sm text-xs" onClick={downloadMasterSkuTemplate}>
            ⬇ Template Import
          </button>
          <span className="ml-auto text-xs text-gray-600">{filtered.length} SKU</span>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? <LoadingSpinner /> : filtered.length === 0 ? (
          <EmptyState icon="🏷️" title="Belum ada data SKU"
            desc="Tambahkan SKU manual atau import dari Excel"
            action={<button className="btn-primary btn-sm" onClick={openNew}>+ Tambah SKU Pertama</button>} />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>SKU Induk</th>
                  <th>Nama Produk</th>
                  <th>Variasi</th>
                  <th className="text-right">Harga Modal</th>
                  <th>Kategori</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Diperbarui</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td className="mono text-xs font-semibold text-gray-200">{s.sku}</td>
                    <td className="mono text-xs text-gray-500">{s.sku_induk ?? '—'}</td>
                    <td className="max-w-[180px] truncate font-medium text-gray-200">{s.nama_produk}</td>
                    <td className="text-xs text-gray-400">{s.nama_variasi ?? '—'}</td>
                    <td className="text-right">
                      <InlineEdit value={s.harga_modal} onSave={v => quickUpdateModal(s.id, s.sku, v)} />
                    </td>
                    <td>{s.kategori ? <span className="badge badge-blue text-[10px]">{s.kategori}</span> : '—'}</td>
                    <td className="text-xs text-gray-500">{s.supplier ?? '—'}</td>
                    <td>
                      <button onClick={() => toggleActive(s)}
                        className={cn('badge cursor-pointer text-[10px] transition-opacity hover:opacity-70',
                          s.is_active ? 'badge-green' : 'badge-gray')}>
                        {s.is_active ? '✓ Aktif' : '✗ Nonaktif'}
                      </button>
                    </td>
                    <td className="text-xs text-gray-600">{formatDate(s.updated_at, 'd/M/yy')}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn-ghost btn-xs" onClick={() => showHistory(s.sku)} title="Riwayat harga">
                          📋
                        </button>
                        <button className="btn-ghost btn-xs" onClick={() => openEdit(s)}>✏️</button>
                        <button className="btn-danger btn-xs" onClick={() => setDeleteId(s.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal Add/Edit ── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editSku ? `Edit SKU: ${editSku.sku}` : 'Tambah SKU Baru'}
        maxWidth="max-w-xl"
        footer={
          <div className="flex gap-3 justify-end">
            <button className="btn-secondary btn-sm" onClick={() => setModalOpen(false)}>Batal</button>
            <button className="btn-primary btn-sm" onClick={saveSku} disabled={saving}>
              {saving ? 'Menyimpan...' : '💾 Simpan'}
            </button>
          </div>
        }
      >
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">SKU <span className="text-red-500">*</span></label>
              <input type="text" className="input mono uppercase" placeholder="SKU-001"
                value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value.toUpperCase() })}
                disabled={!!editSku} />
              {editSku && <p className="text-[10px] text-gray-600 mt-1">SKU tidak bisa diubah</p>}
            </div>
            <div>
              <label className="label">SKU Induk</label>
              <input type="text" className="input mono uppercase" placeholder="SKU-IND-001"
                value={form.sku_induk} onChange={e => setForm({ ...form, sku_induk: e.target.value.toUpperCase() })} />
            </div>
          </div>

          <div>
            <label className="label">Nama Produk <span className="text-red-500">*</span></label>
            <input type="text" className="input" placeholder="Kampas Rem Honda Vario 125"
              value={form.nama_produk} onChange={e => setForm({ ...form, nama_produk: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Nama Variasi</label>
              <input type="text" className="input" placeholder="Merah-L, 1L, Standar..."
                value={form.nama_variasi} onChange={e => setForm({ ...form, nama_variasi: e.target.value })} />
            </div>
            <div>
              <label className="label">Harga Modal (Rp) <span className="text-red-500">*</span></label>
              <input type="number" className="input" min={0} placeholder="25000"
                value={form.harga_modal || ''}
                onChange={e => setForm({ ...form, harga_modal: parseNumber(e.target.value) })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Kategori</label>
              <input type="text" className="input" placeholder="Rem, Oli, Ban..."
                list="kategori-list" value={form.kategori}
                onChange={e => setForm({ ...form, kategori: e.target.value })} />
              <datalist id="kategori-list">
                {allKategori.map(k => <option key={k} value={k} />)}
              </datalist>
            </div>
            <div>
              <label className="label">Supplier</label>
              <input type="text" className="input" placeholder="Nama supplier"
                value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="label">Catatan</label>
            <textarea className="input resize-none min-h-[60px]" placeholder="Catatan tambahan..."
              value={form.catatan} onChange={e => setForm({ ...form, catatan: e.target.value })} />
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
              className={cn('w-10 h-5 rounded-full transition-all relative',
                form.is_active ? 'bg-emerald-500' : 'bg-gray-700')}>
              <span className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all',
                form.is_active ? 'left-5' : 'left-0.5')} />
            </button>
            <label className="text-sm text-gray-300 cursor-pointer"
              onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}>
              {form.is_active ? 'SKU Aktif — dipakai untuk matching' : 'SKU Nonaktif — diabaikan saat matching'}
            </label>
          </div>
        </div>
      </Modal>

      {/* ── History Modal ── */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)}
        title={`Riwayat Harga Modal — ${histSku}`} maxWidth="max-w-lg">
        <div className="p-5">
          {history.length === 0 ? (
            <EmptyState icon="📋" title="Belum ada riwayat perubahan" />
          ) : (
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between p-3 bg-white/[0.025] rounded-xl border border-white/[0.05]">
                  <div>
                    <div className="text-xs text-gray-500">{formatDatetime(h.changed_at)}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-red-400 line-through tabular-nums">{formatRupiah(h.harga_modal_lama)}</span>
                      <span className="text-gray-600">→</span>
                      <span className="text-sm text-emerald-400 font-semibold tabular-nums">{formatRupiah(h.harga_modal_baru)}</span>
                    </div>
                  </div>
                  <div className={cn('text-xs font-semibold',
                    h.harga_modal_baru > h.harga_modal_lama ? 'text-red-400' : 'text-emerald-400')}>
                    {h.harga_modal_baru > h.harga_modal_lama ? '↑' : '↓'}
                    {' '}{Math.abs(((h.harga_modal_baru - h.harga_modal_lama) / (h.harga_modal_lama || 1)) * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={deleteSku}
        title="Hapus SKU?" message="SKU akan dihapus permanen. Transaksi yang sudah diimport tidak terpengaruh." />
    </div>
  )
}
