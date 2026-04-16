// src/components/layout/Sidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const NAV = [
  {
    group: 'Dashboard',
    items: [
      { href: '/dashboard',              label: 'Overview',           icon: '▦', exact: true },
    ],
  },
  {
    group: 'Shopee',
    items: [
      { href: '/dashboard/import-harian',   label: 'Import Harian',      icon: '↑' },
      { href: '/dashboard/profit-rekap',    label: 'Rekap Profit',        icon: '📈' },
      { href: '/dashboard/iklan-harian',    label: 'Iklan Harian',        icon: '📢' },
      { href: '/dashboard/unmatched-modal', label: 'Unmatched Modal',     icon: '⚠' },
    ],
  },
  {
    group: 'Master Data',
    items: [
      { href: '/dashboard/harga-modal',  label: 'Master Harga Modal', icon: '💰' },
    ],
  },
  {
    group: 'Transaksi',
    items: [
      { href: '/dashboard/transactions',      label: 'Semua Transaksi', icon: '≡' },
      { href: '/dashboard/transactions/new',  label: 'Tambah Manual',   icon: '+' },
      { href: '/dashboard/daily-recap',       label: 'Rekap Harian',    icon: '◫' },
    ],
  },
  {
    group: 'Sistem',
    items: [
      { href: '/dashboard/settings', label: 'Pengaturan', icon: '◎' },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 bg-[#0d0f13] border-r border-white/[0.05] flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.05]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-orange-500/15 border border-orange-500/20 flex items-center justify-center text-sm font-black text-orange-400">
            S
          </div>
          <div>
            <div className="text-sm font-bold text-white tracking-tight">ShopeeRekap</div>
            <div className="text-[10px] text-gray-600 mt-0.5">Profit Tracker</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {NAV.map(group => (
          <div key={group.group}>
            <div className="text-[9px] font-bold text-gray-700 uppercase tracking-[0.12em] px-3 mb-1.5">
              {group.group}
            </div>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                      active
                        ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                        : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
                    )}
                  >
                    <span className={cn(
                      'w-5 h-5 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0',
                      active
                        ? 'bg-orange-500/20 text-orange-400'
                        : 'bg-white/[0.04] text-gray-600'
                    )}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/[0.05]">
        <div className="text-[9px] text-gray-700 font-mono">v5.0 · ShopeeRekap</div>
      </div>
    </aside>
  )
}
