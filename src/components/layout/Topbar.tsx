'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import type { Profile } from '@/types'
import Link from 'next/link'

const PAGE_LABELS: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/transactions': 'Transaksi',
  '/dashboard/transactions/new': 'Tambah Transaksi',
  '/dashboard/daily-recap': 'Rekap Harian',
  '/dashboard/products': 'Analisa Produk',
  '/dashboard/import': 'Import Data',
  '/dashboard/settings': 'Pengaturan',
}

export default function Topbar({ profile, userEmail }: { profile: Profile | null; userEmail: string }) {
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname()

  const label = Object.entries(PAGE_LABELS)
    .filter(([path]) => pathname.startsWith(path))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? ''

  const initials = (profile?.store_name ?? userEmail)
    .split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="h-13 bg-[#0d0f13] border-b border-white/[0.05] flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-3">
        {/* breadcrumb hint */}
        <div className="text-sm font-medium text-gray-300">{label}</div>
      </div>

      <div className="flex items-center gap-3">
        {/* Quick add button */}
        <Link href="/dashboard/transactions/new"
          className="hidden sm:flex btn-primary btn-sm gap-1.5 text-xs">
          <span className="text-base leading-none">+</span> Tambah Transaksi
        </Link>

        {/* User */}
        <div className="flex items-center gap-2.5 pl-3 border-l border-white/[0.06]">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-semibold text-gray-300">{profile?.store_name ?? 'Toko Saya'}</div>
            <div className="text-[10px] text-gray-600">{userEmail}</div>
          </div>
          <div className="w-8 h-8 rounded-xl bg-orange-500/15 border border-orange-500/20 flex items-center justify-center text-xs font-bold text-orange-400">
            {initials}
          </div>
          <button onClick={signOut} className="text-[11px] text-gray-600 hover:text-gray-300 transition-colors">
            Keluar
          </button>
        </div>
      </div>
    </header>
  )
}
