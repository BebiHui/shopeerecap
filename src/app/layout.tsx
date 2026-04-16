// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ShopeeRekap — Rekapitulasi Penjualan',
  description: 'Dashboard rekapitulasi profit penjualan Shopee harian',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body>{children}</body>
    </html>
  )
}
