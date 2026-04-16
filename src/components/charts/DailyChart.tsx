'use client'

import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { formatRupiah, chartDateLabel } from '@/lib/utils'
import type { DailySummary } from '@/types'

// ── Shared Tooltip ────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1a1d24] border border-white/10 rounded-xl p-3.5 shadow-2xl min-w-[180px]">
      <div className="text-[10px] font-semibold text-gray-400 mb-2.5 pb-2 border-b border-white/[0.06] uppercase tracking-widest">
        {label}
      </div>
      <div className="space-y-1.5">
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="text-xs text-gray-400">{p.name}</span>
            </div>
            <span className="text-xs font-semibold text-white tabular-nums">
              {formatRupiah(p.value, true)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const AXIS_STYLE   = { fill: '#4b5563', fontSize: 10 }
const GRID_COLOR   = 'rgba(255,255,255,0.04)'
const COMMON_OPTS  = { responsive: true, maintainAspectRatio: false }

// ── Omzet & Profit Chart ──────────────────────────────────────
export function OmzetProfitChart({ data }: { data: DailySummary[] }) {
  const cd = data.map(d => ({
    date:    chartDateLabel(d.tanggal),
    Omzet:   d.total_omzet,
    Profit:  d.profit_bersih,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={cd} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gO" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#f97316" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
        <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={58}
          tickFormatter={v => formatRupiah(v, true)} />
        <Tooltip content={<ChartTooltip />} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" />
        <Area type="monotone" dataKey="Omzet" stroke="#f97316" strokeWidth={2}
          fill="url(#gO)" dot={false} activeDot={{ r: 4 }} />
        <Area type="monotone" dataKey="Profit" stroke="#10b981" strokeWidth={2}
          fill="url(#gP)" dot={false} activeDot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Biaya Bar Chart ───────────────────────────────────────────
export function BiayaChart({ data }: { data: DailySummary[] }) {
  const cd = data.map(d => ({
    date:         chartDateLabel(d.tanggal),
    'Pot. Shopee': d.total_potongan_shopee,
    'Iklan':       d.total_iklan,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={cd} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
        <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={58}
          tickFormatter={v => formatRupiah(v, true)} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="Pot. Shopee" stackId="a" fill="#ef4444" fillOpacity={0.75}
          radius={[0,0,3,3]} maxBarSize={32} />
        <Bar dataKey="Iklan"       stackId="a" fill="#eab308" fillOpacity={0.75}
          radius={[3,3,0,0]} maxBarSize={32} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Net Profit Chart (Profit Transaksi vs Iklan vs Net Profit) ──
export interface NetProfitChartPoint {
  tanggal: string
  profit_produk: number
  total_iklan_harian: number
  net_profit_harian: number
}

export function NetProfitChart({ data }: { data: NetProfitChartPoint[] }) {
  const cd = data.map(d => ({
    date:             chartDateLabel(d.tanggal),
    'Profit Produk':  d.profit_produk,
    'Iklan':         -d.total_iklan_harian,   // negatif → bar ke bawah
    'Net Profit':     d.net_profit_harian,
  }))

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={cd} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gNet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
        <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={58}
          tickFormatter={v => formatRupiah(v, true)} />
        <Tooltip content={<ChartTooltip />} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" strokeWidth={1.5} />
        <Bar dataKey="Profit Produk" fill="#10b981" fillOpacity={0.35}
          radius={[3,3,0,0]} maxBarSize={28} />
        <Bar dataKey="Iklan"         fill="#eab308" fillOpacity={0.5}
          radius={[0,0,3,3]} maxBarSize={28} />
        <Line type="monotone" dataKey="Net Profit" stroke="#10b981" strokeWidth={2.5}
          dot={false} activeDot={{ r: 5, fill: '#10b981' }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Four-charts grid ──────────────────────────────────────────
export function FourChartsGrid({ data }: { data: DailySummary[] }) {
  const charts = [
    { label: 'Profit Bersih',    key: 'profit',   color: '#10b981', gId: 'g4p', fn: (d: DailySummary) => d.profit_bersih },
    { label: 'Omzet',           key: 'omzet',    color: '#f97316', gId: 'g4o', fn: (d: DailySummary) => d.total_omzet },
    { label: 'Biaya Iklan',     key: 'iklan',    color: '#eab308', gId: 'g4i', fn: (d: DailySummary) => d.total_iklan },
    { label: 'Potongan Shopee', key: 'shopee',   color: '#ef4444', gId: 'g4s', fn: (d: DailySummary) => d.total_potongan_shopee },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {charts.map(c => {
        const cd = data.map(d => ({ date: chartDateLabel(d.tanggal), val: c.fn(d) }))
        const hasNeg = cd.some(x => x.val < 0)
        return (
          <div key={c.key} className="bg-white/[0.02] rounded-xl p-4 border border-white/[0.05]">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">{c.label}</div>
            <ResponsiveContainer width="100%" height={100}>
              <ComposedChart data={cd} margin={{ top: 2, right: 2, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={c.gId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={c.color} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={c.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 2" stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} tickLine={false} axisLine={false}
                  tickFormatter={v => formatRupiah(v, true)} width={52} />
                <Tooltip content={<ChartTooltip />} />
                {hasNeg && <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />}
                <Area type="monotone" dataKey="val" name={c.label}
                  stroke={c.color} strokeWidth={1.5} fill={`url(#${c.gId})`} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )
      })}
    </div>
  )
}
