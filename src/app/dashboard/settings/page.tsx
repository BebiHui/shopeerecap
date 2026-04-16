// src/app/dashboard/settings/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, EmptyState, LoadingSpinner, Modal, Alert, ConfirmDialog, SectionCard } from '@/components/ui'
import { formatRupiah } from '@/lib/utils'
import type { Product, Profile } from '@/types'

const EMPTY_PRODUCT = { name: '', sku: '', default_price: 0, default_modal: 0, category: '', notes: '' }

interface RecalcPreviewItem {
  id: string
  nama_produk: string | null
  qty: number
  old_total: number
  new_total: number
  old_profit: number
  new_profit: number
}

export default function SettingsPage() {
  const supabase = createClient()
  const [products, setProducts]     = useState<Product[]>([])
  const [profile, setProfile]       = useState<Profile | null>(null)
  const [loading, setLoading]       = useState(true)
  const [modalOpen, setModalOpen]   = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [form, setForm]             = useState(EMPTY_PRODUCT)
  const [saving, setSaving]         = useState(false)
  const [status, setStatus]         = useState<{ type: 'success'|'error'; msg: string } | null>(null)
  const [deleteId, setDeleteId]     = useState<string | null>(null)
  const [pForm, setPForm]           = useState({ store_name: '', owner_name: '', phone: '' })
  const [savingProfile, setSavingProfile] = useState(false)

  // ── State untuk perbaikan kalkulasi qty > 1 ───────────────
  const [qtyBrokenCount, setQtyBrokenCount] = useState<number | null>(null)
  const [recalcRunning, setRecalcRunning]   = useState(false)
  const [recalcResult, setRecalcResult]     = useState<{ fixed: number; errors: number } | null>(null)
  const [recalcPreview, setRecalcPreview]   = useState<RecalcPreviewItem[]>([])
  const [showPreview, setShowPreview]       = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const loadQtyBrokenCount = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { count } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gt('qty', 1)
      .lt('profit', 0)
    setQtyBrokenCount(count ?? 0)
  }, [supabase])

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: prods }, { data: prof }] = await Promise.all([
      supabase.from('products').select('*').eq('user_id', user.id).eq('is_active', true).order('name'),
      supabase.from('profiles').select('*').eq('id', user.id).single(),
    ])
    if (prods) setProducts(prods)
    if (prof)  { setProfile(prof); setPForm({ store_name: prof.store_name, owner_name: prof.owner_name ?? '', phone: prof.phone ?? '' }) }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    load()
    loadQtyBrokenCount()
  }, [load, loadQtyBrokenCount])

  function openNew() { setEditProduct(null); setForm(EMPTY_PRODUCT); setModalOpen(true) }
  function openEdit(p: Product) {
    setEditProduct(p)
    setForm({ name: p.name, sku: p.sku ?? '', default_price: p.default_price, default_modal: p.default_modal, category: p.category ?? '', notes: p.notes ?? '' })
    setModalOpen(true)
  }

  async function saveProduct() {
    if (!form.name.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const payload = { ...form, user_id: user.id, sku: form.sku || null, category: form.category || null, notes: form.notes || null }
    const { error } = editProduct
      ? await supabase.from('products').update(payload).eq('id', editProduct.id).eq('user_id', user.id)
      : await supabase.from('products').insert(payload)
    setSaving(false)
    if (error) { setStatus({ type: 'error', msg: error.message }); return }
    setModalOpen(false); load()
    setStatus({ type: 'success', msg: editProduct ? 'Produk diperbarui!' : 'Produk ditambahkan!' })
    setTimeout(() => setStatus(null), 2500)
  }

  async function deleteProduct() {
    if (!deleteId) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('products').update({ is_active: false }).eq('id', deleteId).eq('user_id', user.id)
    setDeleteId(null); load()
  }

  // ── Kalkulasi ulang transaksi qty > 1 ────────────────────────

  async function loadRecalcPreview() {
    setLoadingPreview(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoadingPreview(false); return }

    const { data: txns } = await supabase
      .from('transactions')
      .select('id, nama_produk, qty, total_harga_produk, harga_modal_per_item, voucher_ditanggung_penjual, biaya_program_hemat_biaya_kirim, biaya_transaksi_spaylater, biaya_ams, profit')
      .eq('user_id', user.id)
      .gt('qty', 1)
      .lt('profit', 0)
      .order('tanggal', { ascending: false })
      .limit(30)

    if (txns) {
      const preview: RecalcPreviewItem[] = txns.map(t => {
        const newTotal    = (t.total_harga_produk ?? 0) * t.qty
        const newAdmin    = Math.round(newTotal * 0.0825)
        const newLayanan  = Math.round(newTotal * 0.10)
        const voucher     = t.voucher_ditanggung_penjual ?? 0
        const hematKirim  = t.biaya_program_hemat_biaya_kirim ?? 0
        const spaylater   = t.biaya_transaksi_spaylater ?? 0
        const ams         = t.biaya_ams ?? 0
        const newBiaya    = voucher + newAdmin + newLayanan + 1250 + hematKirim + spaylater + ams
        const newModal    = (t.harga_modal_per_item ?? 0) * t.qty
        return {
          id:          t.id,
          nama_produk: t.nama_produk,
          qty:         t.qty,
          old_total:   t.total_harga_produk ?? 0,
          new_total:   newTotal,
          old_profit:  t.profit ?? 0,
          new_profit:  newTotal - newModal - newBiaya,
        }
      })
      setRecalcPreview(preview)
    }
    setLoadingPreview(false)
    setShowPreview(true)
  }

  async function runRecalculate() {
    setRecalcRunning(true)
    setRecalcResult(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setRecalcRunning(false); return }

    // Fetch hanya transaksi yang masih broken: qty > 1 dan profit < 0
    const { data: txns, error: fetchErr } = await supabase
      .from('transactions')
      .select('id, qty, total_harga_produk, harga_modal_per_item, voucher_ditanggung_penjual, biaya_program_hemat_biaya_kirim, biaya_transaksi_spaylater, biaya_ams')
      .eq('user_id', user.id)
      .gt('qty', 1)
      .lt('profit', 0)

    if (fetchErr || !txns) {
      setRecalcRunning(false)
      setStatus({ type: 'error', msg: `Gagal fetch data: ${fetchErr?.message ?? 'unknown'}` })
      return
    }

    if (txns.length === 0) {
      setRecalcRunning(false)
      setRecalcResult({ fixed: 0, errors: 0 })
      return
    }

    let fixed = 0, errors = 0

    for (const t of txns) {
      const newTotal   = (t.total_harga_produk ?? 0) * t.qty
      const newAdmin   = Math.round(newTotal * 0.0825)
      const newLayanan = Math.round(newTotal * 0.10)
      const voucher    = t.voucher_ditanggung_penjual ?? 0
      const hematKirim = t.biaya_program_hemat_biaya_kirim ?? 0
      const spaylater  = t.biaya_transaksi_spaylater ?? 0
      const ams        = t.biaya_ams ?? 0
      const newBiaya   = voucher + newAdmin + newLayanan + 1250 + hematKirim + spaylater + ams
      const newModal   = (t.harga_modal_per_item ?? 0) * t.qty
      const newProfit  = newTotal - newModal - newBiaya

      const { error } = await supabase
        .from('transactions')
        .update({
          total_harga_produk:                           newTotal,
          harga_modal_total:                            newModal,
          biaya_administrasi:                           newAdmin,
          biaya_layanan_promo_xtra_gratis_ongkir_xtra: newLayanan,
          biaya_proses_pesanan:                         1250,
          total_biaya_shopee:                           newBiaya,
          profit:                                       newProfit,
        })
        .eq('id', t.id)
        .eq('user_id', user.id)

      if (error) errors++
      else fixed++
    }

    setRecalcRunning(false)
    setRecalcResult({ fixed, errors })
    setShowPreview(false)
    loadQtyBrokenCount()
  }

  async function saveProfile() {
    setSavingProfile(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('profiles').update({
      store_name: pForm.store_name,
      owner_name: pForm.owner_name || null,
      phone:      pForm.phone      || null,
    }).eq('id', user.id)
    setSavingProfile(false)
    setStatus({ type: 'success', msg: '✓ Profil berhasil diperbarui!' })
    setTimeout(() => setStatus(null), 2500)
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Pengaturan" subtitle="Profil toko & master produk" />

      {status && <Alert type={status.type} message={status.msg} onClose={() => setStatus(null)} />}

      {/* Profile */}
      <SectionCard title="🏪 Profil Toko">
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Nama Toko</label>
            <input type="text" className="input" value={pForm.store_name}
              onChange={e => setPForm({ ...pForm, store_name: e.target.value })} />
          </div>
          <div>
            <label className="label">Nama Pemilik</label>
            <input type="text" className="input" value={pForm.owner_name}
              onChange={e => setPForm({ ...pForm, owner_name: e.target.value })} />
          </div>
          <div>
            <label className="label">No. HP / WA</label>
            <input type="text" className="input" placeholder="08xxxxxxxxxx" value={pForm.phone}
              onChange={e => setPForm({ ...pForm, phone: e.target.value })} />
          </div>
        </div>
        <div className="px-5 pb-5 flex justify-end">
          <button className="btn-primary btn-sm" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? 'Menyimpan...' : '💾 Simpan Profil'}
          </button>
        </div>
      </SectionCard>

      {/* Products */}
      <SectionCard
        title="📦 Master Produk & Modal Default"
        action={<button className="btn-primary btn-sm" onClick={openNew}>+ Tambah Produk</button>}
      >
        {loading ? <LoadingSpinner /> : products.length === 0 ? (
          <EmptyState icon="📦" title="Belum ada produk"
            desc="Tambahkan produk agar tersedia sebagai autocomplete saat input transaksi"
            action={<button className="btn-primary btn-sm" onClick={openNew}>+ Tambah Produk</button>} />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Nama Produk</th>
                  <th>SKU</th>
                  <th>Kategori</th>
                  <th className="text-right">Harga Jual Default</th>
                  <th className="text-right">Harga Modal</th>
                  <th className="text-right">Margin Gross</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const margin = p.default_price > 0
                    ? ((p.default_price - p.default_modal) / p.default_price * 100)
                    : 0
                  return (
                    <tr key={p.id}>
                      <td className="font-medium text-gray-200">{p.name}</td>
                      <td className="mono text-xs text-gray-600">{p.sku ?? '—'}</td>
                      <td>{p.category ? <span className="badge badge-blue">{p.category}</span> : '—'}</td>
                      <td className="text-right text-orange-400">{formatRupiah(p.default_price)}</td>
                      <td className="text-right text-gray-400">{formatRupiah(p.default_modal)}</td>
                      <td className="text-right">
                        <span className={`badge text-[10px] ${margin >= 0 ? 'badge-green' : 'badge-red'}`}>
                          {margin.toFixed(1)}%
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <button className="btn-ghost btn-xs" onClick={() => openEdit(p)}>✏️</button>
                          <button className="btn-danger btn-xs" onClick={() => setDeleteId(p.id)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── Perbaiki Kalkulasi Qty > 1 ─────────────────────────── */}
      <SectionCard title="🔧 Perbaiki Kalkulasi Qty > 1">
        <div className="p-5 space-y-4">
          {/* Penjelasan */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-200 space-y-1">
            <p className="font-semibold text-amber-300">⚠️ Tentang Bug Ini</p>
            <p className="text-xs text-amber-200/80 leading-relaxed">
              File export Shopee menyimpan kolom &quot;Total Harga Produk&quot; sebagai <strong>harga per unit</strong> (bukan total).
              Transaksi yang diimport sebelum fix dengan qty &gt; 1 menyimpan harga unit saja, bukan unit × qty,
              sehingga profit menjadi negatif secara tidak wajar.
            </p>
            <p className="text-xs text-amber-200/80">
              Fungsi ini hanya memperbaiki transaksi dengan <code className="text-amber-300">qty &gt; 1</code> dan <code className="text-amber-300">profit &lt; 0</code>.
              Import baru sudah otomatis benar.
            </p>
          </div>

          {/* Status count */}
          <div className="flex items-center gap-4">
            <div className="card px-4 py-3 flex items-center gap-3">
              <span className="text-xs text-gray-500">Transaksi perlu diperbaiki</span>
              {qtyBrokenCount === null ? (
                <span className="text-gray-500 text-sm">Memuat...</span>
              ) : (
                <span className={`text-xl font-bold tabular-nums ${qtyBrokenCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {qtyBrokenCount}
                </span>
              )}
            </div>
            {qtyBrokenCount !== null && qtyBrokenCount > 0 && (
              <span className="text-xs text-gray-500">transaksi dengan qty &gt; 1 dan profit negatif</span>
            )}
            {qtyBrokenCount === 0 && (
              <span className="text-xs text-emerald-400">✓ Semua transaksi sudah benar</span>
            )}
          </div>

          {/* Tombol aksi */}
          {qtyBrokenCount !== null && qtyBrokenCount > 0 && !recalcResult && (
            <div className="flex gap-3 flex-wrap">
              <button
                className="btn-secondary btn-sm"
                onClick={loadRecalcPreview}
                disabled={loadingPreview || recalcRunning}
              >
                {loadingPreview ? 'Memuat...' : '🔍 Lihat Preview'}
              </button>
              <button
                className="btn-primary btn-sm"
                onClick={runRecalculate}
                disabled={recalcRunning || loadingPreview}
              >
                {recalcRunning ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    Memperbaiki...
                  </span>
                ) : `⚡ Fix ${qtyBrokenCount} Transaksi Sekarang`}
              </button>
            </div>
          )}

          {/* Hasil setelah fix */}
          {recalcResult && (
            <div className={`rounded-xl p-4 text-sm border ${recalcResult.errors === 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-300'}`}>
              {recalcResult.fixed > 0 && (
                <p>✅ <strong>{recalcResult.fixed}</strong> transaksi berhasil diperbaiki.</p>
              )}
              {recalcResult.errors > 0 && (
                <p>⚠️ <strong>{recalcResult.errors}</strong> transaksi gagal diperbarui.</p>
              )}
              {recalcResult.fixed === 0 && recalcResult.errors === 0 && (
                <p>✅ Tidak ada transaksi yang perlu diperbaiki.</p>
              )}
              <p className="text-xs mt-1 opacity-70">Refresh halaman dashboard untuk melihat profit yang sudah diperbarui.</p>
            </div>
          )}

          {/* Preview table */}
          {showPreview && recalcPreview.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">Preview {recalcPreview.length} transaksi yang akan diperbaiki (maks. 30):</p>
                <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setShowPreview(false)}>Tutup</button>
              </div>
              <div className="table-wrap max-h-64 overflow-y-auto">
                <table className="dt text-xs">
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Total Lama</th>
                      <th className="text-right">Total Baru</th>
                      <th className="text-right">Profit Lama</th>
                      <th className="text-right">Profit Baru</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recalcPreview.map(item => (
                      <tr key={item.id}>
                        <td className="max-w-[140px] truncate text-gray-300">{item.nama_produk ?? '—'}</td>
                        <td className="text-right">{item.qty}</td>
                        <td className="text-right text-gray-500">{formatRupiah(item.old_total)}</td>
                        <td className="text-right text-blue-400">{formatRupiah(item.new_total)}</td>
                        <td className="text-right text-red-400">{formatRupiah(item.old_profit)}</td>
                        <td className={`text-right font-semibold ${item.new_profit >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {formatRupiah(item.new_profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="btn-primary btn-sm mt-2"
                onClick={runRecalculate}
                disabled={recalcRunning}
              >
                {recalcRunning ? 'Memperbaiki...' : `⚡ Fix ${recalcPreview.length} Transaksi Ini`}
              </button>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Formula reference */}
      <SectionCard title="🧮 Referensi Rumus Kalkulasi">
        <div className="p-5 space-y-3">
          {[
            { label: 'Total Kotor',        formula: 'Qty × Harga Jual per Item' },
            { label: 'Total Modal',         formula: 'Qty × Harga Modal per Item' },
            { label: 'Potongan Shopee',     formula: 'Admin + Layanan + Program + Affiliate + Ongkir Seller + Voucher' },
            { label: 'Total Diterima',      formula: 'Total Kotor − Diskon Produk − Potongan Shopee (atau override manual)' },
            { label: 'Profit Bersih',       formula: 'Total Diterima − Total Modal − Biaya Iklan' },
            { label: 'Profit Harian',       formula: 'Σ Profit Transaksi − Biaya Iklan Harian' },
            { label: 'Margin (%)',          formula: '(Profit Bersih / Total Kotor) × 100' },
          ].map(item => (
            <div key={item.label} className="flex gap-4 items-start text-sm">
              <div className="w-36 shrink-0 text-orange-400 font-semibold text-xs pt-0.5">{item.label}</div>
              <div className="text-gray-400 mono text-xs leading-relaxed">= {item.formula}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Product modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editProduct ? 'Edit Produk' : 'Tambah Produk'}
        maxWidth="max-w-lg"
        footer={
          <div className="flex gap-3 justify-end">
            <button className="btn-secondary btn-sm" onClick={() => setModalOpen(false)}>Batal</button>
            <button className="btn-primary btn-sm" onClick={saveProduct} disabled={saving || !form.name}>
              {saving ? 'Menyimpan...' : '💾 Simpan'}
            </button>
          </div>
        }
      >
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Nama Produk <span className="text-red-500">*</span></label>
            <input type="text" className="input" value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nama lengkap produk" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">SKU</label>
              <input type="text" className="input" value={form.sku}
                onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="SKU-001" />
            </div>
            <div>
              <label className="label">Kategori</label>
              <input type="text" className="input" value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Oli, Rem, dll" />
            </div>
            <div>
              <label className="label">Harga Jual Default (Rp)</label>
              <input type="number" className="input" min={0} value={form.default_price || ''}
                onChange={e => setForm({ ...form, default_price: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="label">Harga Modal (Rp)</label>
              <input type="number" className="input" min={0} value={form.default_modal || ''}
                onChange={e => setForm({ ...form, default_modal: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          {form.default_price > 0 && (
            <div className="bg-white/[0.025] rounded-xl p-3 border border-white/[0.06] text-sm">
              <span className="text-gray-500">Gross margin: </span>
              <span className={form.default_price > form.default_modal ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                {form.default_price > 0
                  ? ((form.default_price - form.default_modal) / form.default_price * 100).toFixed(1) + '%'
                  : '0%'}
              </span>
              <span className="text-gray-500 ml-2">
                ({formatRupiah(form.default_price - form.default_modal)} / item)
              </span>
            </div>
          )}
          <div>
            <label className="label">Catatan</label>
            <textarea className="input resize-none min-h-[60px]" value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Info tambahan..." />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={deleteProduct}
        title="Hapus Produk?"
        message="Produk akan disembunyikan dari daftar. Data transaksi yang ada tidak terpengaruh."
      />
    </div>
  )
}
