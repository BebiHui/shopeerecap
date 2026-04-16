// src/app/login/page.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const supabase = createClient()
  const router   = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [storeName, setStoreName] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [message, setMessage]   = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setMessage('')

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: storeName }, emailRedirectTo: `${location.origin}/dashboard` },
      })
      if (error) setError(error.message)
      else setMessage('Cek email Anda untuk konfirmasi pendaftaran.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError('Email atau password salah.')
      else router.push('/dashboard')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#0a0c10] flex items-center justify-center p-4">
      <div className="w-full max-w-[420px]">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-500/10 border border-orange-500/20 mb-5">
            <span className="text-2xl font-black text-orange-400">S</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">ShopeeRekap</h1>
          <p className="text-gray-500 text-sm mt-1.5">Rekapitulasi Profit Penjualan Shopee</p>
        </div>

        {/* Card */}
        <div className="bg-[#111318] border border-white/[0.07] rounded-2xl p-8 shadow-2xl">
          <h2 className="text-base font-semibold text-white mb-6">
            {isSignUp ? 'Buat Akun Baru' : 'Masuk ke Akun Anda'}
          </h2>

          {error && (
            <div className="bg-red-500/8 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl mb-4">
              {error}
            </div>
          )}
          {message && (
            <div className="bg-emerald-500/8 border border-emerald-500/20 text-emerald-400 text-sm px-4 py-3 rounded-xl mb-4">
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="label">Nama Toko</label>
                <input type="text" className="input" placeholder="Toko Sparepart Motor Jaya"
                  value={storeName} onChange={e => setStoreName(e.target.value)} required={isSignUp} />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" placeholder="seller@email.com"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" placeholder="Min. 6 karakter"
                value={password} onChange={e => setPassword(e.target.value)} minLength={6} required />
            </div>
            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white font-semibold text-sm py-3 rounded-xl transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50">
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Memproses...</>
              ) : isSignUp ? 'Daftar Sekarang' : 'Masuk'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-white/[0.06] text-center">
            <button onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage('') }}
              className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
              {isSignUp ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar gratis'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-700 mt-5">
          Data tersimpan aman dengan Row Level Security Supabase
        </p>
      </div>
    </div>
  )
}
