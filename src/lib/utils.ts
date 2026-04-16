// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO, subDays, startOfMonth, endOfMonth } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRupiah(amount: number | null | undefined, compact = false): string {
  const n = Math.round(amount ?? 0)
  if (compact) {
    if (Math.abs(n) >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`
    if (Math.abs(n) >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}Jt`
    if (Math.abs(n) >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}Rb`
    return `Rp ${n.toLocaleString('id-ID')}`
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

export function formatDate(dateStr: string | null | undefined, fmt = 'd MMM yyyy'): string {
  if (!dateStr) return '-'
  try { return format(parseISO(dateStr + (dateStr.length === 10 ? 'T00:00:00' : '')), fmt, { locale: idLocale }) }
  catch { return dateStr }
}

export function formatDateLong(dateStr: string | null | undefined): string {
  return formatDate(dateStr, 'EEEE, d MMMM yyyy')
}

export function formatDatetime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  try { return format(parseISO(dateStr), 'd MMM yyyy, HH:mm', { locale: idLocale }) }
  catch { return dateStr }
}

export function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function nDaysAgo(n: number): string {
  return format(subDays(new Date(), n), 'yyyy-MM-dd')
}

export function thisMonthRange(): { from: string; to: string } {
  const now = new Date()
  return {
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to:   format(endOfMonth(now),   'yyyy-MM-dd'),
  }
}

export function formatPersen(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`
}

export function parseNumber(val: string | number | undefined | null): number {
  if (val === null || val === undefined || val === '') return 0
  const n = typeof val === 'string' ? parseFloat(val.replace(/[^0-9.-]/g, '')) : val
  return isNaN(n) ? 0 : n
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max)
}

/** Format chart x-axis date label */
export function chartDateLabel(dateStr: string): string {
  return formatDate(dateStr, 'd/M')
}
