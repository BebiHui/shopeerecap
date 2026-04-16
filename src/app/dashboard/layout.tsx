// src/app/dashboard/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0c10]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar profile={profile} userEmail={user.email ?? ''} />
        <main className="flex-1 overflow-y-auto px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  )
}
