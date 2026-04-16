# ShopeeRekap v2 — Rekapitulasi Profit Penjualan Shopee

Dashboard full-stack modern untuk seller Shopee yang ingin menghitung profit bersih harian secara otomatis — tanpa spreadsheet manual.

---

## Cara Setup (5 Menit)

### 1. Buat Project Supabase
Daftar di [supabase.com](https://supabase.com) → New Project → pilih region Asia (Singapore).

### 2. Jalankan Schema Database
Buka **SQL Editor** di Supabase Dashboard, paste isi `supabase/schema.sql`, lalu klik **Run**.

### 3. Install & Konfigurasi

```bash
# Clone & install
cd shopee-rekap
npm install

# Copy file environment
cp .env.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

> Ambil dari: Supabase Dashboard → **Settings → API**

### 4. Jalankan

```bash
npm run dev
```

Buka: **http://localhost:3000**

### 5. Daftar & Seed Data

1. Buka `/login` → klik **Daftar gratis**
2. Masuk ke **Supabase → Authentication → Users** → copy UUID user Anda
3. Edit `supabase/seed.sql` → ganti `GANTI_DENGAN_USER_ID_ANDA`
4. Jalankan di SQL Editor → data dummy 14 hari langsung muncul di dashboard

---

## Fitur Lengkap

| Halaman | Fitur |
|---------|-------|
| **Dashboard** | Kartu stat harian, grafik omzet/profit/iklan/shopee 4-in-1, produk terlaris, transaksi terbaru, formula profit visual |
| **Transaksi** | Tabel dengan filter + summary row, klik untuk detail breakdown |
| **Tambah / Edit** | Form lengkap, kalkulasi real-time, **validasi duplikat order ID live** |
| **Rekap Harian** | Akumulasi profit/iklan/shopee, grafik 4 metrik, expandable rows, input biaya iklan harian |
| **Analisa Produk** | View tabel + kartu, sort by profit/qty/omzet/margin, export Excel |
| **Import** | Upload CSV/Excel, **column mapping otomatis**, preview, skip duplikat |
| **Pengaturan** | Profil toko, master produk dengan margin preview, referensi rumus |

---

## Rumus Kalkulasi (satu fungsi, konsisten di seluruh app)

```
Total Kotor        = Qty × Harga Jual
Total Modal        = Qty × Harga Modal
Potongan Shopee    = Admin + Layanan + Program + Affiliate + Ongkir Seller + Voucher
Total Diterima     = Total Kotor − Diskon Produk − Potongan Shopee
                     (atau override manual dari laporan Shopee)
Profit per Trx     = Total Diterima − Total Modal − Biaya Iklan Trx
Profit Harian      = Σ(Profit per Trx) − Biaya Iklan Harian
Margin (%)         = Profit Bersih / Total Kotor × 100
```

> Semua kalkulasi menggunakan `hitungProfit()` di `src/types/index.ts` — **satu rumus, satu sumber kebenaran**.

---

## Struktur Project

```
src/
├── app/
│   ├── login/                        # Auth page
│   └── dashboard/
│       ├── page.tsx                  # Dashboard utama
│       ├── transactions/             # List + new + [id]/edit
│       ├── daily-recap/              # Rekap harian + iklan harian
│       ├── products/                 # Analisa produk (tabel + kartu)
│       ├── import/                   # Import CSV/Excel
│       └── settings/                 # Profil + master produk
├── components/
│   ├── charts/DailyChart.tsx         # Area, Bar, 4-grid charts
│   ├── layout/Sidebar.tsx            # Navigasi sidebar
│   ├── layout/Topbar.tsx             # Header bar
│   ├── transactions/
│   │   ├── TransactionForm.tsx       # Form + duplikat check
│   │   └── TransactionDetailModal.tsx# Detail + breakdown
│   └── ui/index.tsx                  # StatCard, Modal, Alert, dll
├── lib/
│   ├── utils.ts                      # formatRupiah, formatDate, dll
│   ├── export.ts                     # Export Excel (3 tipe)
│   └── supabase/                     # client + server
└── types/index.ts                    # Types + hitungProfit()

supabase/
├── schema.sql                        # Semua tabel, views, triggers, RLS
└── seed.sql                          # Data dummy 14 hari
```

---

## Database Schema

| Tabel/View | Fungsi |
|------------|--------|
| `profiles` | Data toko per user |
| `products` | Master produk & harga modal default |
| `transactions` | Data transaksi (generated columns: total_kotor, total_modal) |
| `daily_ads` | Biaya iklan harian (terpisah dari biaya iklan per transaksi) |
| `imports` | Log riwayat import file |
| `daily_summary` (view) | Rekap harian otomatis — dipakai dashboard & rekap harian |
| `product_summary` (view) | Akumulasi per produk — dipakai halaman analisa produk |

---

## Deploy ke Vercel

```bash
npm install -g vercel
vercel

# Set env di Vercel Dashboard:
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY
```

---

## Tech Stack

- **Next.js 14** (App Router, Server Components)
- **Supabase** (PostgreSQL + Auth + RLS)
- **Tailwind CSS** (dark theme)
- **Recharts** (grafik interaktif)
- **SheetJS / xlsx** (import & export Excel)
- **TypeScript** (fully typed)

---

## Troubleshooting

**Grafik kosong?** → Pastikan ada data di `daily_summary` view. Cek dengan: `select * from daily_summary limit 5;` di SQL Editor.

**Login redirect loop?** → Pastikan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` sudah benar di `.env.local`.

**Seed gagal?** → Pastikan UUID sudah diganti dan user sudah terdaftar di Supabase Auth.

**`total_kotor` tidak muncul?** → Kolom ini adalah generated column PostgreSQL. Pastikan schema.sql sudah dijalankan ulang jika ada error.
