// src/app/dashboard/harga-modal/page.tsx
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  PageHeader, EmptyState, LoadingSpinner,
  Modal, Alert, ConfirmDialog, SectionCard,
} from '@/components/ui'
import { formatRupiah, formatDate, formatDatetime, parseNumber, cn } from '@/lib/utils'
import type { MasterHargaModal, MasterHargaModalFormData, HargaModalHistory } from '@/types'
import { exportMasterHargaModalXLSX, downloadHargaModalTemplate } from '@/lib/harga-modal-export'
import * as XLSX from 'xlsx'

const EMPTY: MasterHargaModalFormData = {
  sku_induk: '', nama_produk: '', nama_variasi: '', harga_modal: 0, is_active: true,
}

// ── Inline edit harga modal ───────────────────────────────────
function InlineEdit({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState('')
  const ref                   = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) { setVal(String(value)); setTimeout(() => ref.current?.select(), 30) }
  }, [editing])

  function commit() {
    const n = parseNumber(val)
    if (!isNaN(n) && n !== value) onSave(n)
    setEditing(false)
  }

  if (!editing) return (
    <button onClick={() => setEditing(true)}
      className="text-sm font-semibold text-orange-400 hover:text-orange-300 hover:underline tabular-nums transition-colors group flex items-center gap-1">
      {formatRupiah(value)}
      <span className="text-[10px] text-gray-700 opacity-0 group-hover:opacity-100">✎</span>
    </button>
  )
  return (
    <div className="flex items-center gap-1.5">
      <input ref={ref} type="number" min={0}
        className="w-28 bg-white/[0.06] border border-orange-500/50 rounded-lg px-2 py-1 text-sm text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-orange-500/40"
        value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
      <button onClick={commit} className="text-emerald-400 hover:text-emerald-300 font-bold px-1 text-xs">✓</button>
      <button onClick={() => setEditing(false)} className="text-gray-600 hover:text-gray-400 px-1 text-xs">✕</button>
    </div>
  )
}

export default function HargaModalPage() {
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)

  const [data, setData]           = useState<MasterHargaModal[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]     = useState<MasterHargaModal | null>(null)
  const [form, setForm]           = useState<MasterHargaModalFormData>({ ...EMPTY })
  const [saving, setSaving]       = useState(false)
  const [deleteId, setDeleteId]   = useState<string | null>(null)
  const [status, setStatus]       = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null)

  const [histOpen, setHistOpen]   = useState(false)
  const [history, setHistory]     = useState<HargaModalHistory[]>([])
  const [histSku, setHistSku]     = useState('')

  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult]   = useState<{ inserted: number; updated: number; invalid: number; errors: string[] } | null>(null)

  // ── Bulk delete state ─────────────────────────────────────────
  const [bulkDeleteOpen, setBulkDeleteOpen]     = useState(false)
  const [bulkDeleting, setBulkDeleting]         = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState('')   // user must type "HAPUS SEMUA"

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: rows } = await supabase
      .from('master_harga_modal').select('*').eq('user_id', user.id).order('sku_induk')
    setData(rows ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function flash(type: 'success' | 'error' | 'info', msg: string) {
    setStatus({ type, msg })
    setTimeout(() => setStatus(null), 4000)
  }

  // Filter
  const filtered = data.filter(m => {
    if (filterActive === 'active'   && !m.is_active) return false
    if (filterActive === 'inactive' &&  m.is_active) return false
    if (search) {
      const q = search.toLowerCase()
      return m.sku_induk.toLowerCase().includes(q) || m.nama_produk.toLowerCase().includes(q)
        || (m.nama_variasi ?? '').toLowerCase().includes(q)
    }
    return true
  })

  const aktif    = data.filter(m => m.is_active).length
  const nonaktif = data.length - aktif

  // CRUD
  function openNew()  { setEditing(null);  setForm({ ...EMPTY }); setModalOpen(true) }
  function openEdit(m: MasterHargaModal) {
    setEditing(m)
    setForm({ sku_induk: m.sku_induk, nama_produk: m.nama_produk, nama_variasi: m.nama_variasi ?? '', harga_modal: m.harga_modal, is_active: m.is_active })
    setModalOpen(true)
  }

  async function saveSku() {
    if (!form.sku_induk.trim()) { flash('error', 'SKU Induk wajib diisi.'); return }
    if (!form.nama_produk.trim()) { flash('error', 'Nama Produk wajib diisi.'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const payload = { user_id: user.id, sku_induk: form.sku_induk.trim(), nama_produk: form.nama_produk.trim(), nama_variasi: form.nama_variasi.trim() || null, harga_modal: form.harga_modal, is_active: form.is_active }
    const { error } = editing
      ? await supabase.from('master_harga_modal').update(payload).eq('id', editing.id).eq('user_id', user.id)
      : await supabase.from('master_harga_modal').insert(payload)
    setSaving(false)
    if (error) { flash('error', error.code === '23505' ? `SKU Induk "${form.sku_induk}" sudah ada.` : error.message) }
    else { setModalOpen(false); load(); flash('success', editing ? `${form.sku_induk} diperbarui.` : `${form.sku_induk} ditambahkan.`) }
  }

  async function quickUpdateModal(id: string, sku: string, v: number) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('master_harga_modal').update({ harga_modal: v }).eq('id', id).eq('user_id', user.id)
    setData(prev => prev.map(m => m.id === id ? { ...m, harga_modal: v } : m))
    flash('success', `Harga modal ${sku} → ${formatRupiah(v)}`)
  }

  async function del() {
    if (!deleteId) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('master_harga_modal').delete().eq('id', deleteId).eq('user_id', user.id)
    setDeleteId(null); load(); flash('info', 'Data dihapus.')
  }

  async function toggleActive(m: MasterHargaModal) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('master_harga_modal').update({ is_active: !m.is_active }).eq('id', m.id).eq('user_id', user.id)
    setData(prev => prev.map(x => x.id === m.id ? { ...x, is_active: !m.is_active } : x))
  }

  async function showHistory(skuInduk: string) {
    setHistSku(skuInduk); setHistOpen(true); setHistory([])
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: rows } = await supabase.from('harga_modal_history')
      .select('*').eq('user_id', user.id).eq('sku_induk', skuInduk)
      .order('changed_at', { ascending: false }).limit(30)
    setHistory(rows ?? [])
  }

  // ── BULK DELETE ───────────────────────────────────────────────
  async function handleBulkDelete() {
    if (bulkDeleteConfirm.trim().toUpperCase() !== 'HAPUS SEMUA') {
      flash('error', 'Ketik "HAPUS SEMUA" untuk konfirmasi.')
      return
    }
    setBulkDeleting(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBulkDeleting(false); return }

    const { error } = await supabase
      .from('master_harga_modal')
      .delete()
      .eq('user_id', user.id)   // RLS: hanya data milik user ini

    setBulkDeleting(false)
    setBulkDeleteOpen(false)
    setBulkDeleteConfirm('')

    if (error) {
      flash('error', `Gagal menghapus: ${error.message}`)
    } else {
      flash('success', `✓ Seluruh master harga modal dihapus. Silakan upload file baru.`)
      setData([])
    }
  }

  // ── Import Excel ──────────────────────────────────────────────
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''; setImportLoading(true); setImportResult(null)
    const { data: { user } } = await supabase.auth.getUser(); if (!user) return

    const reader = new FileReader()
    reader.onload = async ev => {
      const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { raw: false })
      const { data: existing } = await supabase.from('master_harga_modal').select('sku_induk').eq('user_id', user.id)
      const existingSet = new Set((existing ?? []).map(x => x.sku_induk.trim()))

      let inserted = 0, updated = 0, invalid = 0
      const errors: string[] = []

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const skuInduk   = (r['SKU Induk'] || r['sku_induk'] || r['SKU_INDUK'] || '').trim()
        const namaProduk = (r['Nama Produk'] || r['nama_produk'] || '').trim()
        const namaVar    = (r['Nama Variasi'] || r['nama_variasi'] || '').trim()
        const harga      = parseNumber(r['Harga Modal'] || r['harga_modal'] || '0')

        if (!skuInduk)   { invalid++; errors.push(`Baris ${i + 2}: SKU Induk kosong`); continue }
        if (!namaProduk) { invalid++; errors.push(`Baris ${i + 2} (${skuInduk}): Nama Produk kosong`); continue }

        const { error } = await supabase.from('master_harga_modal').upsert(
          { user_id: user.id, sku_induk: skuInduk, nama_produk: namaProduk, nama_variasi: namaVar || null, harga_modal: harga, is_active: true },
          { onConflict: 'user_id,sku_induk' }
        )
        if (error) { errors.push(`Baris ${i + 2} (${skuInduk}): ${error.message}`); invalid++ }
        else if (existingSet.has(skuInduk)) updated++
        else inserted++
      }

      setImportResult({ inserted, updated, invalid, errors: errors.slice(0, 20) })
      setImportLoading(false); load()
      flash(errors.length === 0 ? 'success' : 'info', `Import: ${inserted} baru, ${updated} update, ${invalid} invalid.`)
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Master Harga Modal"
        subtitle={`${data.length} SKU Induk terdaftar`}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={importLoading}>
              {importLoading ? '⏳' : '📤'} Import Excel
            </button>
            <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleImportFile} />
            <button className="btn-secondary btn-sm" onClick={() => exportMasterHargaModalXLSX(filtered)}>⬇ Export</button>
            {/* ── RESET ALL BUTTON ── */}
            <button
              className="btn-danger btn-sm"
              onClick={() => { setBulkDeleteOpen(true); setBulkDeleteConfirm('') }}
              disabled={data.length === 0}
            >
              🗑 Reset Semua
            </button>
            <button className="btn-primary btn-sm" onClick={openNew}>+ Tambah</button>
          </div>
        }
      />

      {status && <Alert type={status.type} message={status.msg} onClose={() => setStatus(null)} />}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total SKU', value: data.length, color: 'text-white' },
          { label: 'Aktif', value: aktif, color: 'text-emerald-400' },
          { label: 'Nonaktif', value: nonaktif, color: 'text-gray-500' },
          { label: 'Rata-rata Modal', value: data.length > 0 ? formatRupiah(data.reduce((s, m) => s + m.harga_modal, 0) / data.length, true) : '—', color: 'text-orange-400' },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">{s.label}</span>
            <span className={cn('text-lg font-bold', s.color)}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Import result */}
      {importResult && (
        <SectionCard title="📊 Hasil Import">
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Baru', v: importResult.inserted, cls: 'bg-emerald-500/8 border-emerald-500/15 text-emerald-400' },
              { label: 'Update', v: importResult.updated, cls: 'bg-blue-500/8 border-blue-500/15 text-blue-400' },
              { label: 'Invalid', v: importResult.invalid, cls: 'bg-red-500/8 border-red-500/15 text-red-400' },
              { label: 'Total', v: importResult.inserted + importResult.updated + importResult.invalid, cls: 'bg-white/[0.03] border-white/[0.06] text-white' },
            ].map(item => (
              <div key={item.label} className={cn('rounded-xl p-4 text-center border', item.cls)}>
                <div className="text-2xl font-bold tabular-nums">{item.v}</div>
                <div className="text-xs text-gray-500 mt-1">{item.label}</div>
              </div>
            ))}
          </div>
          {importResult.errors.length > 0 && (
            <div className="px-4 pb-4 space-y-1 max-h-32 overflow-y-auto">
              {importResult.errors.map((e, i) => <div key={i} className="text-xs text-red-400 mono">{e}</div>)}
            </div>
          )}
        </SectionCard>
      )}

      {/* Filter */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <input type="text" className="input w-64 text-sm" placeholder="🔍 Cari SKU Induk atau nama produk..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05]">
          {(['all', 'active', 'inactive'] as const).map(v => (
            <button key={v} onClick={() => setFilterActive(v)}
              className={cn('text-[10px] font-semibold px-3 py-1.5 rounded-lg transition-all',
                filterActive === v ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-gray-300')}>
              {v === 'all' ? 'Semua' : v === 'active' ? '✓ Aktif' : '✗ Nonaktif'}
            </button>
          ))}
        </div>
        <button className="btn-secondary btn-sm text-xs" onClick={downloadHargaModalTemplate}>⬇ Template</button>
        <span className="ml-auto text-xs text-gray-600">{filtered.length} data</span>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? <LoadingSpinner /> : filtered.length === 0 ? (
          <EmptyState icon="💰" title="Belum ada data harga modal"
            desc='Import dari Excel atau tambah manual. SKU Induk adalah kunci utama.'
            action={
              <div className="flex gap-2">
                <button className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>📤 Import Excel</button>
                <button className="btn-primary btn-sm" onClick={openNew}>+ Tambah Manual</button>
              </div>
            } />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>SKU Induk</th><th>Nama Produk</th><th>Variasi</th>
                  <th className="text-right">Harga Modal / item</th><th>Status</th>
                  <th>Diperbarui</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id}>
                    <td className="mono text-xs font-bold text-gray-200">{m.sku_induk}</td>
                    <td className="font-medium text-gray-200 max-w-[220px] truncate">{m.nama_produk}</td>
                    <td className="text-xs text-gray-500">{m.nama_variasi ?? '—'}</td>
                    <td className="text-right">
                      <InlineEdit value={m.harga_modal} onSave={v => quickUpdateModal(m.id, m.sku_induk, v)} />
                    </td>
                    <td>
                      <button onClick={() => toggleActive(m)}
                        className={cn('badge cursor-pointer transition-opacity hover:opacity-70 text-[10px]',
                          m.is_active ? 'badge-green' : 'badge-gray')}>
                        {m.is_active ? '✓ Aktif' : '✗ Nonaktif'}
                      </button>
                    </td>
                    <td className="text-xs text-gray-600">{formatDate(m.updated_at, 'd/M/yy')}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn-ghost btn-xs" title="Riwayat" onClick={() => showHistory(m.sku_induk)}>📋</button>
                        <button className="btn-ghost btn-xs" onClick={() => openEdit(m)}>✏️</button>
                        <button className="btn-danger btn-xs" onClick={() => setDeleteId(m.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Format import guide */}
      <SectionCard title="📋 Format File Import Excel">
        <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { col: 'SKU Induk',    req: true,  desc: 'Key matching utama (wajib unik)' },
            { col: 'Nama Produk',  req: true,  desc: 'Nama produk untuk tampilan' },
            { col: 'Nama Variasi', req: false, desc: 'Opsional (misal: 1L, Merah)' },
            { col: 'Harga Modal',  req: true,  desc: 'Harga per item (angka)' },
          ].map(c => (
            <div key={c.col} className="bg-white/[0.025] rounded-xl p-3 border border-white/[0.05]">
              <div className="flex items-center gap-1.5 mb-1">
                <code className="text-xs text-orange-400 font-mono">{c.col}</code>
                <span className={cn('badge text-[9px]', c.req ? 'badge-red' : 'badge-gray')}>
                  {c.req ? 'Wajib' : 'Opsional'}
                </span>
              </div>
              <div className="text-[11px] text-gray-600">{c.desc}</div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-4 text-xs text-gray-600">
          Saat import: SKU Induk sudah ada → <strong className="text-gray-400">update</strong> harga modal.
          Belum ada → <strong className="text-gray-400">buat baru</strong>.
        </div>
      </SectionCard>

      {/* ── Modal Add/Edit ── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `Edit: ${editing.sku_induk}` : 'Tambah Harga Modal'}
        maxWidth="max-w-lg"
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
          <div>
            <label className="label">SKU Induk <span className="text-red-500">*</span></label>
            <input type="text" className={cn('input mono', editing && 'opacity-60 cursor-not-allowed')}
              placeholder="SKU-IND-001" value={form.sku_induk}
              onChange={e => !editing && setForm({ ...form, sku_induk: e.target.value })}
              readOnly={!!editing} />
            {editing && <p className="text-[10px] text-gray-600 mt-1">SKU Induk tidak bisa diubah — ini adalah key utama</p>}
          </div>
          <div>
            <label className="label">Nama Produk <span className="text-red-500">*</span></label>
            <input type="text" className="input" placeholder="Kampas Rem Honda Vario 125"
              value={form.nama_produk} onChange={e => setForm({ ...form, nama_produk: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Nama Variasi</label>
              <input type="text" className="input" placeholder="Standar, 1L, Merah..."
                value={form.nama_variasi} onChange={e => setForm({ ...form, nama_variasi: e.target.value })} />
            </div>
            <div>
              <label className="label">Harga Modal / item (Rp) <span className="text-red-500">*</span></label>
              <input type="number" className="input" min={0} placeholder="25000"
                value={form.harga_modal || ''}
                onChange={e => setForm({ ...form, harga_modal: parseNumber(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button type="button"
              onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
              className={cn('w-10 h-5 rounded-full transition-all relative shrink-0',
                form.is_active ? 'bg-emerald-500' : 'bg-gray-700')}>
              <span className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all',
                form.is_active ? 'left-5' : 'left-0.5')} />
            </button>
            <span className="text-sm text-gray-400 cursor-pointer"
              onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}>
              {form.is_active ? 'Aktif — dipakai untuk matching saat import' : 'Nonaktif — diabaikan saat import'}
            </span>
          </div>
        </div>
      </Modal>

      {/* ── History Modal ── */}
      <Modal open={histOpen} onClose={() => setHistOpen(false)}
        title={`Riwayat Harga Modal — ${histSku}`} maxWidth="max-w-md">
        <div className="p-5">
          {history.length === 0 ? (
            <EmptyState icon="📋" title="Belum ada riwayat perubahan" desc="Riwayat tercatat otomatis saat harga modal diubah" />
          ) : (
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between p-3 bg-white/[0.025] rounded-xl border border-white/[0.05]">
                  <div>
                    <div className="text-[10px] text-gray-600">{formatDatetime(h.changed_at)}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-sm text-red-400 line-through tabular-nums">{formatRupiah(h.harga_modal_lama)}</span>
                      <span className="text-gray-700 text-xs">→</span>
                      <span className="text-sm text-emerald-400 font-semibold tabular-nums">{formatRupiah(h.harga_modal_baru)}</span>
                    </div>
                  </div>
                  <div className={cn('text-xs font-bold',
                    h.harga_modal_baru > h.harga_modal_lama ? 'text-red-400' : 'text-emerald-400')}>
                    {h.harga_modal_baru > h.harga_modal_lama ? '↑' : '↓'}
                    {h.harga_modal_lama > 0
                      ? ` ${Math.abs(((h.harga_modal_baru - h.harga_modal_lama) / h.harga_modal_lama) * 100).toFixed(1)}%`
                      : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* ── BULK DELETE MODAL ── */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#13161c] border border-red-500/20 rounded-2xl w-full max-w-md shadow-2xl p-6">
            {/* Warning header */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center text-2xl shrink-0">🗑</div>
              <div>
                <h3 className="text-base font-bold text-white">Reset Master Harga Modal</h3>
                <p className="text-xs text-red-400 mt-0.5">Tindakan ini tidak bisa dibatalkan</p>
              </div>
            </div>

            <div className="bg-red-500/6 border border-red-500/15 rounded-xl p-4 mb-5 text-sm text-red-300 space-y-1.5">
              <p>Seluruh <strong className="text-red-200">{data.length} data</strong> master harga modal akan dihapus.</p>
              <p className="text-red-400/80 text-xs">
                Setelah dihapus, Anda bisa upload ulang file Excel master harga modal terbaru.
                Transaksi yang sudah diimport tidak terpengaruh (snapshot harga modal tetap tersimpan di transaksi).
              </p>
            </div>

            <div className="mb-5">
              <label className="label text-gray-400">Ketik <span className="text-red-400 font-mono font-bold">HAPUS SEMUA</span> untuk konfirmasi</label>
              <input type="text" className="input border-red-500/30 focus:ring-red-500/30"
                placeholder="HAPUS SEMUA"
                value={bulkDeleteConfirm}
                onChange={e => setBulkDeleteConfirm(e.target.value)} />
            </div>

            <div className="flex gap-3">
              <button className="btn-secondary flex-1"
                onClick={() => { setBulkDeleteOpen(false); setBulkDeleteConfirm('') }}
                disabled={bulkDeleting}>
                Batal
              </button>
              <button
                className={cn(
                  'flex-1 btn text-sm font-semibold',
                  bulkDeleteConfirm.trim().toUpperCase() === 'HAPUS SEMUA'
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-red-500/10 text-red-500/40 cursor-not-allowed'
                )}
                onClick={handleBulkDelete}
                disabled={bulkDeleting || bulkDeleteConfirm.trim().toUpperCase() !== 'HAPUS SEMUA'}
              >
                {bulkDeleting ? (
                  <div className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-red-300/30 border-t-red-300 rounded-full animate-spin" />
                    <span>Menghapus...</span>
                  </div>
                ) : '🗑 Hapus Semua Data'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={del}
        title="Hapus SKU Induk?"
        message="Data akan dihapus. Transaksi yang sudah diimport tidak terpengaruh (snapshot tersimpan di transaksi)." />
    </div>
  )
}
