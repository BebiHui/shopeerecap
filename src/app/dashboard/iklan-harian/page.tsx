// src/app/dashboard/iklan-harian/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  PageHeader, EmptyState, LoadingSpinner, Alert,
  ConfirmDialog, SectionCard, StatCard,
} from '@/components/ui'
import {
  formatRupiah, formatDate, formatDateLong,
  todayStr, parseNumber, cn, nDaysAgo,
} from '@/lib/utils'
import type { DailyAdsCost, DailyAdsCostFormData } from '@/types'
import { upsertDailyAds, getNetProfitSummary } from '@/lib/daily-ads'

type NetProfitSummary = {
  profit_produk: number
  total_iklan: number
  net_profit: number
}

type PeriodeSummary = NetProfitSummary
import { NetProfitChart } from '@/components/charts/DailyChart'
import type { NetProfitChartPoint } from '@/components/charts/DailyChart'
import * as XLSX from 'xlsx'

const EMPTY_FORM: DailyAdsCostFormData = {
  tanggal:     todayStr(),
  total_iklan: 0,
  catatan:     '',
}

export default function IklanHarianPage() {
  const supabase = createClient()

  // ── State ─────────────────────────────────────────────────────
  const [list, setList]         = useState<DailyAdsCost[]>([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState<DailyAdsCostFormData>({ ...EMPTY_FORM })
  const [saving, setSaving]     = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [status, setStatus]     = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Date range for history
  const [dateFrom, setDateFrom] = useState(nDaysAgo(29))
  const [dateTo, setDateTo]     = useState(todayStr())

  // KPI summaries
  const [todayKpi, setTodayKpi]   = useState<NetProfitSummary | null>(null)
  const [weekKpi, setWeekKpi]     = useState<NetProfitSummary | null>(null)
  const [monthKpi, setMonthKpi]   = useState<NetProfitSummary | null>(null)

  // Chart data
  const [chartData, setChartData] = useState<NetProfitChartPoint[]>([])

  // ── Load ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const today      = todayStr()
    const weekStart  = nDaysAgo(6)
    const monthStart = today.slice(0, 7) + '-01'

    const [{ data: history }, todayP, weekP, monthP, { data: chartRaw }] = await Promise.all([
      // History list
      supabase.from('daily_ads_cost').select('*')
        .eq('user_id', user.id)
        .gte('tanggal', dateFrom).lte('tanggal', dateTo)
        .order('tanggal', { ascending: false }),

      // KPI periods
      getNetProfitSummary(user.id, today, today),
      getNetProfitSummary(user.id, weekStart, today),
      getNetProfitSummary(user.id, monthStart, today),

      // Chart: last 14 days
      supabase.from('shopee_net_profit_harian')
        .select('tanggal, profit_produk, total_iklan_harian, net_profit_harian')
        .eq('user_id', user.id)
        .gte('tanggal', nDaysAgo(13)).lte('tanggal', today)
        .order('tanggal'),
    ])

    setList(history ?? [])
    setTodayKpi(todayP)
    setWeekKpi(weekP)
    setMonthKpi(monthP)
    setChartData((chartRaw ?? []) as NetProfitChartPoint[])
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  // ── Auto-detect edit mode when date changes ───────────────────
  useEffect(() => {
    const existing = list.find(x => x.tanggal === form.tanggal)
    if (existing) {
      setEditingId(existing.id)
      // Prefill form values from existing if user hasn't typed yet
      setForm(prev => ({
        ...prev,
        total_iklan: prev.total_iklan !== 0 ? prev.total_iklan : existing.total_iklan,
        catatan:     prev.catatan || existing.catatan || '',
      }))
    } else {
      setEditingId(null)
    }
  }, [form.tanggal, list])

  function flash(type: 'success' | 'error' | 'info', msg: string) {
    setStatus({ type, msg })
    setTimeout(() => setStatus(null), 4000)
  }

  // ── Save (upsert) ─────────────────────────────────────────────
  async function handleSave() {
    if (!form.tanggal)        { flash('error', 'Tanggal wajib diisi.'); return }
    if (form.total_iklan <= 0) { flash('error', 'Total iklan harus lebih dari 0.'); return }

    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    const { error } = await upsertDailyAds(user.id, form)
    setSaving(false)

    if (error) {
      flash('error', error)
    } else {
      flash(
        'success',
        `${editingId ? 'Update' : 'Simpan'} iklan ${formatDate(form.tanggal)}: ${formatRupiah(form.total_iklan)}`
      )
      setForm({ ...EMPTY_FORM })
      setEditingId(null)
      load()
    }
  }

  function startEdit(item: DailyAdsCost) {
    setForm({
      tanggal:     item.tanggal,
      total_iklan: item.total_iklan,
      catatan:     item.catatan ?? '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleDelete() {
    if (!deleteId) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const err = null
    setDeleteId(null)
    if (err) flash('error', err)
    else { flash('info', 'Data iklan dihapus.'); load() }
  }

  // ── Stats ─────────────────────────────────────────────────────
  const totalIklanPeriode = list.reduce((s, x) => s + x.total_iklan, 0)
  const avgIklan = list.length > 0 ? totalIklanPeriode / list.length : 0
  const maxItem  = list.reduce((best, x) => x.total_iklan > (best?.total_iklan ?? 0) ? x : best, null as DailyAdsCost | null)

  function exportXLSX() {
    const rows = list.map(x => ({
      'Tanggal':      formatDate(x.tanggal),
      'Total Iklan':  x.total_iklan,
      'Catatan':      x.catatan ?? '',
      'Diperbarui':   formatDate(x.updated_at),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Iklan Harian')
    XLSX.writeFile(wb, `iklan_harian_${dateFrom}_sd_${dateTo}.xlsx`)
  }

  // ── KPI render helper ─────────────────────────────────────────
  function renderKpi(label: string, kpi: PeriodeSummary | null) {
    const netPos = (kpi?.net_profit ?? 0) >= 0
    return (
      <div className="card p-4">
        <div className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-3">{label}</div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-xs text-gray-500">Profit Transaksi</span>
            <span className={cn('text-sm font-semibold tabular-nums',
              (kpi?.profit_produk ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {formatRupiah(kpi?.profit_produk ?? 0, true)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-gray-500">Total Iklan</span>
            <span className="text-sm font-semibold tabular-nums text-yellow-400">
              {(kpi?.total_iklan ?? 0) > 0
                ? `− ${formatRupiah(kpi!.total_iklan, true)}`
                : <span className="text-gray-600">—</span>}
            </span>
          </div>
          <div className="border-t border-white/[0.06] pt-2 flex justify-between">
            <span className="text-xs font-semibold text-gray-300">Net Profit</span>
            <span className={cn('text-base font-bold tabular-nums', netPos ? 'text-emerald-400' : 'text-red-400')}>
              {formatRupiah(kpi?.net_profit ?? 0, true)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Iklan Harian"
        subtitle="Input biaya iklan per hari — Net Profit = Profit Transaksi − Iklan"
        actions={
          <button className="btn-secondary btn-sm" onClick={exportXLSX}>
            ⬇ Export Excel
          </button>
        }
      />

      {status && (
        <Alert type={status.type} message={status.msg} onClose={() => setStatus(null)} />
      )}

      {/* ── Form Input ── */}
      <div className="card p-5">
        <div className="section-title">
          {editingId ? '✏️ Update Iklan' : '➕ Tambah Iklan Harian'}
        </div>

        {/* Formula reminder */}
        <div className="mb-4 p-3 bg-blue-500/6 border border-blue-500/15 rounded-xl">
          <div className="text-[11px] text-blue-300/80 leading-relaxed">
            <strong className="text-blue-300">Formula:</strong>
            {' '}Net Profit Harian = Σ Profit Transaksi pada hari T
            {' '}− <strong className="text-yellow-300">Total Iklan Harian</strong>
            <span className="ml-2 text-blue-300/50">
              · Iklan harian tidak dibagi ke tiap transaksi
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="label">Tanggal <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={form.tanggal} max={todayStr()}
              onChange={e => setForm({ ...form, tanggal: e.target.value })} />
            {editingId && (
              <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-yellow-400">
                <span>⚡</span>
                <span>Tanggal ini sudah ada data — akan diupdate (bukan insert baru)</span>
              </div>
            )}
          </div>

          <div>
            <label className="label">Total Biaya Iklan (Rp) <span className="text-red-500">*</span></label>
            <input type="number" className="input" min={0} placeholder="250000"
              value={form.total_iklan || ''}
              onChange={e => setForm({ ...form, total_iklan: parseNumber(e.target.value) })} />
          </div>

          <div>
            <label className="label">Keterangan (opsional)</label>
            <input type="text" className="input" placeholder="Shopee Ads, Meta Ads, dll"
              value={form.catatan}
              onChange={e => setForm({ ...form, catatan: e.target.value })} />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button
            className="btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving || !form.tanggal || form.total_iklan <= 0}
          >
            {saving ? 'Menyimpan...' : editingId ? '💾 Update Iklan' : '💾 Simpan Iklan'}
          </button>
          {editingId && (
            <button
              className="btn-secondary btn-sm"
              onClick={() => { setForm({ ...EMPTY_FORM }); setEditingId(null) }}
            >
              Batal Edit
            </button>
          )}
          {form.total_iklan > 0 && (
            <span className="text-xs text-gray-500">
              Net profit berkurang
              <span className="text-red-400 font-semibold mx-1">
                {formatRupiah(form.total_iklan)}
              </span>
              pada {formatDate(form.tanggal)}
            </span>
          )}
        </div>
      </div>

      {/* ── KPI: Hari Ini / Minggu / Bulan ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {renderKpi('Hari Ini',        todayKpi)}
        {renderKpi('Minggu Ini (7H)', weekKpi)}
        {renderKpi('Bulan Ini',       monthKpi)}
      </div>

      {/* ── Graf Net Profit ── */}
      {chartData.length > 0 && (
        <SectionCard title="📊 Grafik Net Profit vs Iklan — 14 Hari Terakhir">
          <div className="p-5">
            {/* Legend */}
            <div className="flex flex-wrap gap-4 mb-4 text-[11px] text-gray-500">
              {[
                { color: 'bg-emerald-500/30', label: 'Profit Produk (bar)' },
                { color: 'bg-yellow-500/50',  label: 'Iklan (bar bawah)' },
                { color: 'bg-emerald-500',    label: 'Net Profit (garis)' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <div className={cn('w-3 h-3 rounded-sm', l.color)} />
                  <span>{l.label}</span>
                </div>
              ))}
            </div>
            <NetProfitChart data={chartData} />
          </div>
        </SectionCard>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Iklan Periode', value: formatRupiah(totalIklanPeriode, true), color: 'text-yellow-400' },
          { label: 'Rata-rata / Hari',    value: formatRupiah(avgIklan, true),          color: 'text-gray-300' },
          { label: 'Tertinggi',           value: formatRupiah(maxItem?.total_iklan ?? 0, true), color: 'text-red-400' },
          { label: 'Hari Tertinggi',      value: maxItem ? formatDate(maxItem.tanggal, 'd/M') : '—', color: 'text-gray-300' },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">
              {s.label}
            </span>
            <span className={cn('text-base font-bold tabular-nums', s.color)}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* ── Filter ── */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <input type="date" className="input w-36 text-sm" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)} />
        <span className="text-gray-600 text-sm">s/d</span>
        <input type="date" className="input w-36 text-sm" value={dateTo}
          onChange={e => setDateTo(e.target.value)} />
        {[7, 14, 30].map(n => (
          <button key={n} className="btn-secondary btn-sm text-xs"
            onClick={() => { setDateFrom(nDaysAgo(n - 1)); setDateTo(todayStr()) }}>
            {n}H
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-600">{list.length} hari</span>
      </div>

      {/* ── History Table ── */}
      <div className="card">
        {loading ? (
          <LoadingSpinner />
        ) : list.length === 0 ? (
          <EmptyState
            icon="📢"
            title="Belum ada data iklan harian"
            desc="Tambahkan biaya iklan hari ini menggunakan form di atas"
          />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th className="text-right">Total Iklan</th>
                  <th>Keterangan</th>
                  <th>Diperbarui</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map(item => (
                  <tr key={item.id}>
                    <td className="font-medium text-gray-200">
                      {formatDateLong(item.tanggal)}
                    </td>
                    <td className="text-right text-yellow-400 font-bold tabular-nums text-base">
                      {formatRupiah(item.total_iklan)}
                    </td>
                    <td className="text-gray-500 text-sm">
                      {item.catatan || <span className="text-gray-700">—</span>}
                    </td>
                    <td className="text-xs text-gray-600">
                      {formatDate(item.updated_at, 'd/M/yy HH:mm')}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          className="btn-ghost btn-xs"
                          onClick={() => startEdit(item)}
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button
                          className="btn-danger btn-xs"
                          onClick={() => setDeleteId(item.id)}
                          title="Hapus"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Hapus Data Iklan?"
        message="Data iklan harian ini akan dihapus. Net profit hari tersebut akan kembali sama dengan profit transaksi (tanpa potongan iklan)."
      />
    </div>
  )
}
