'use client'

import { cn, formatRupiah } from '@/lib/utils'
import type { ProfitCalc } from '@/types'

// ── StatCard ──────────────────────────────────────────────────
export interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: React.ReactNode
  color?: 'orange' | 'green' | 'red' | 'blue' | 'yellow' | 'purple'
  isRupiah?: boolean
  compact?: boolean
  trend?: number   // positive = up arrow, negative = down
}

const COLOR = {
  orange: { bar: 'bg-orange-500',  text: 'text-orange-400',  glow: 'stat-glow-orange', dot: 'bg-orange-500/20' },
  green:  { bar: 'bg-emerald-500', text: 'text-emerald-400', glow: 'stat-glow-green',  dot: 'bg-emerald-500/20' },
  red:    { bar: 'bg-red-500',     text: 'text-red-400',     glow: 'stat-glow-red',    dot: 'bg-red-500/20' },
  blue:   { bar: 'bg-blue-500',    text: 'text-blue-400',    glow: 'stat-glow-blue',   dot: 'bg-blue-500/20' },
  yellow: { bar: 'bg-yellow-500',  text: 'text-yellow-400',  glow: '',                 dot: 'bg-yellow-500/20' },
  purple: { bar: 'bg-purple-500',  text: 'text-purple-400',  glow: '',                 dot: 'bg-purple-500/20' },
}

export function StatCard({ label, value, sub, icon, color = 'orange', isRupiah, compact, trend }: StatCardProps) {
  const c = COLOR[color]
  const display = isRupiah ? formatRupiah(Number(value), compact ?? true) : value

  return (
    <div className={cn('stat-card group', c.glow)}>
      {/* top accent bar */}
      <div className={cn('absolute top-0 inset-x-0 h-px rounded-t-2xl', c.bar)} />

      {/* icon bg */}
      {icon && (
        <div className={cn('absolute top-4 right-4 w-9 h-9 rounded-xl flex items-center justify-center text-base', c.dot)}>
          {icon}
        </div>
      )}

      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">{label}</div>
      <div className={cn('text-2xl font-bold tracking-tight tabular-nums', c.text)}>{display}</div>

      {(sub || trend !== undefined) && (
        <div className="flex items-center gap-2 mt-2">
          {trend !== undefined && (
            <span className={cn('text-[11px] font-semibold', trend >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {sub && <span className="text-[11px] text-gray-600">{sub}</span>}
        </div>
      )}
    </div>
  )
}

// ── SectionCard ────────────────────────────────────────────────
export function SectionCard({ title, children, action, className }: {
  title?: string
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('card', className)}>
      {title && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
          <span className="text-sm font-semibold text-gray-200">{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

// ── CalcBreakdown ─────────────────────────────────────────────
interface CalcRow { label: string; value: number; negative?: boolean; highlight?: boolean; size?: 'sm' | 'lg' }

export function CalcBreakdown({ rows, title }: { rows: CalcRow[]; title?: string }) {
  return (
    <div className="bg-white/[0.025] rounded-xl p-4 border border-white/[0.06] space-y-0.5">
      {title && <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">{title}</div>}
      {rows.map((row, i) => (
        <div key={i} className={cn(
          'flex justify-between items-center py-1.5 text-sm',
          row.highlight && 'border-t border-white/[0.08] mt-2 pt-3 font-semibold',
          row.size === 'lg' && 'text-base'
        )}>
          <span className="text-gray-400">{row.label}</span>
          <span className={cn(
            'tabular-nums',
            row.highlight ? (row.value >= 0 ? 'text-emerald-400' : 'text-red-400')
              : row.negative ? 'text-red-400' : 'text-gray-200'
          )}>
            {row.negative && row.value > 0 ? '— ' : ''}{formatRupiah(Math.abs(row.value))}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── ProfitDisplay ─────────────────────────────────────────────
export function ProfitDisplay({ calc, showMargin = true }: { calc: ProfitCalc; showMargin?: boolean }) {
  const pos = calc.profit_bersih >= 0
  return (
    <div className="flex items-center gap-2">
      <span className={cn('font-semibold tabular-nums', pos ? 'text-emerald-400' : 'text-red-400')}>
        {formatRupiah(calc.profit_bersih)}
      </span>
      {showMargin && (
        <span className={cn('badge text-[10px]', pos ? 'badge-green' : 'badge-red')}>
          {calc.margin_persen.toFixed(1)}%
        </span>
      )}
    </div>
  )
}

// ── MarginBar ─────────────────────────────────────────────────
export function MarginBar({ pct, className }: { pct: number; className?: string }) {
  const pos = pct >= 0
  const width = Math.min(Math.abs(pct), 100)
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="w-20 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', pos ? 'bg-emerald-500' : 'bg-red-500')}
          style={{ width: `${width}%` }} />
      </div>
      <span className={cn('text-xs font-medium tabular-nums', pos ? 'text-emerald-400' : 'text-red-400')}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

// ── EmptyState ─────────────────────────────────────────────────
export function EmptyState({ icon = '📭', title = 'Tidak ada data', desc, action }: {
  icon?: string; title?: string; desc?: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <div className="text-4xl mb-3 opacity-30">{icon}</div>
      <div className="text-gray-400 font-medium mb-1">{title}</div>
      {desc && <div className="text-gray-600 text-sm mt-0.5 max-w-xs">{desc}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── LoadingSpinner ─────────────────────────────────────────────
export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-14', className)}>
      <div className="w-7 h-7 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-white/[0.04] rounded-lg', className)} />
}

// ── Modal ─────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, maxWidth = 'max-w-2xl', footer }: {
  open: boolean; onClose: () => void; title: string
  children: React.ReactNode; maxWidth?: string; footer?: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={cn(
        'bg-[#13161c] border border-white/[0.08] w-full shadow-2xl flex flex-col',
        'rounded-t-3xl sm:rounded-2xl max-h-[92vh] sm:max-h-[90vh]',
        maxWidth
      )}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-gray-400 hover:text-white transition-all text-xs">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
        {footer && <div className="border-t border-white/[0.06] px-6 py-4 shrink-0">{footer}</div>}
      </div>
    </div>
  )
}

// ── ConfirmDialog ─────────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Ya, Hapus', danger = true, loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void
  title: string; message: string; confirmLabel?: string; danger?: boolean; loading?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[#13161c] border border-white/[0.08] rounded-2xl w-full max-w-sm shadow-2xl p-6">
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center text-2xl mb-4">⚠️</div>
        <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
        <p className="text-gray-400 text-sm leading-relaxed mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1" disabled={loading}>Batal</button>
          <button onClick={onConfirm} className={cn('flex-1 btn', danger ? 'btn-danger' : 'btn-primary')} disabled={loading}>
            {loading ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Alert ─────────────────────────────────────────────────────
export function Alert({ type, message, onClose }: {
  type: 'success' | 'error' | 'info' | 'warning'; message: string; onClose?: () => void
}) {
  const cfg = {
    success: { cls: 'bg-emerald-500/8 border-emerald-500/20 text-emerald-400', icon: '✓' },
    error:   { cls: 'bg-red-500/8 border-red-500/20 text-red-400', icon: '✕' },
    info:    { cls: 'bg-blue-500/8 border-blue-500/20 text-blue-400', icon: 'i' },
    warning: { cls: 'bg-yellow-500/8 border-yellow-500/20 text-yellow-400', icon: '!' },
  }[type]

  return (
    <div className={cn('flex items-start gap-3 px-4 py-3 rounded-xl border text-sm', cfg.cls)}>
      <span className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold mt-0.5 shrink-0">
        {cfg.icon}
      </span>
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="opacity-50 hover:opacity-100 text-xs mt-0.5">✕</button>
      )}
    </div>
  )
}

// ── PageHeader ────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions, back }: {
  title: string; subtitle?: string; actions?: React.ReactNode; back?: string
}) {
  return (
    <div className="page-header">
      <div className="flex items-center gap-3">
        {back && (
          <a href={back} className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/[0.08] transition-all text-sm">
            ←
          </a>
        )}
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-sub">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }: {
  tabs: { id: string; label: string; count?: number }[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05] mb-5 w-fit">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            active === t.id
              ? 'bg-[#1e2229] text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-300'
          )}>
          {t.label}
          {t.count !== undefined && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-semibold',
              active === t.id ? 'bg-orange-500/20 text-orange-400' : 'bg-white/[0.06] text-gray-500')}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── NumberDisplay ─────────────────────────────────────────────
export function Num({ value, compact, className }: { value: number; compact?: boolean; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{formatRupiah(value, compact)}</span>
}
