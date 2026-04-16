// src/lib/export.ts
// Export utilities — semua kalkulasi memakai 6 biaya baru
import * as XLSX from 'xlsx'
import { formatRupiah, formatDate } from './utils'
import type { Transaction, ProductSummary } from '@/types'
import { hitungProfit } from '@/types'

function save(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename)
}
function sheet(rows: Record<string, unknown>[], name = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, name)
  return wb
}

// ── Export transaksi manual ───────────────────────────────────
export function exportTransaksiXLSX(
  transactions: Transaction[],
  filename = 'transaksi.xlsx'
) {
  const rows = transactions.map(t => {
    const c = hitungProfit(t)
    // Fallback backward compat: field baru ?? field lama
    const harga_modal_per_item = t.harga_modal_per_item ?? (t as any).harga_modal ?? 0
    const total_harga_produk   = t.total_harga_produk   ?? (t as any).harga_jual  ?? 0
    return {
      'Tanggal':                       formatDate((t as any).tanggal),
      'Order ID':                      t.order_id,
      'Pembeli':                       (t as any).nama_pembeli ?? '',
      'Produk':                        t.nama_produk,
      'SKU Induk':                     t.sku_induk ?? '',
      'Variasi':                       (t as any).variasi ?? '',
      'Qty':                           t.qty,
      'Harga Modal / item':            harga_modal_per_item,
      'Total Harga Produk':            total_harga_produk,
      'Harga Modal Total':             c.harga_modal_total,
      'Voucher Ditanggung Penjual':    c.breakdown?.voucher_ditanggung_penjual ?? 0,
      'Biaya Administrasi':            t.biaya_administrasi ?? 0,
      'Biaya Program Hemat Biaya Kirim': t.biaya_program_hemat_biaya_kirim ?? 0,
      'Biaya Layanan Promo XTRA+ & Gratis Ongkir': t.biaya_layanan_promo_xtra_gratis_ongkir_xtra ?? 0,
      'Biaya Proses Pesanan':          t.biaya_proses_pesanan ?? 0,
      'Biaya Transaksi SPayLater':     t.biaya_transaksi_spaylater ?? 0,
      'Biaya AMS':                     t.biaya_ams ?? 0,
      'Total Biaya Shopee':            c.total_biaya_shopee,
      'Profit Bersih':                 c.profit_bersih,
      'Margin %':                      isFinite(c.margin_persen) ? parseFloat(c.margin_persen.toFixed(2)) : 0,
      'Catatan':                       (t as any).catatan ?? '',
    }
  })
  save(sheet(rows, 'Transaksi'), filename)
}

// ── Export rekap harian ──────────────────────────────────────
export function exportRekapHarianXLSX(
  data: any[],
  filename = 'rekap_harian.xlsx'
) {
  const rows = data.map(d => {
    const profit    = d.profit_bersih ?? 0
    const biaya     = d.total_biaya_shopee ?? d.total_potongan_shopee ?? 0
    const iklan     = d.total_iklan_harian ?? 0
    const netProfit = profit - iklan
    const margin    = (d.total_omzet ?? 0) > 0
      ? parseFloat(((netProfit / d.total_omzet) * 100).toFixed(2))
      : 0

    return {
      'Tanggal':                    formatDate(d.tanggal),
      'Jumlah Transaksi':           d.total_transaksi ?? 0,
      'Item Terjual':               d.total_item ?? d.total_qty ?? 0,
      'Total Omzet':                d.total_omzet ?? 0,
      'Total Modal':                d.total_modal ?? 0,
      'Biaya Administrasi':         d.total_biaya_administrasi ?? 0,
      'Biaya Hemat Kirim':          d.total_biaya_hemat_kirim  ?? 0,
      'Biaya XTRA+ & Gratis Ongkir':d.total_biaya_xtra         ?? 0,
      'Biaya Proses Pesanan':       d.total_biaya_proses       ?? 0,
      'Biaya SPayLater':            d.total_biaya_spaylater    ?? 0,
      'Biaya AMS':                  d.total_biaya_ams          ?? 0,
      'Total Biaya Shopee':         biaya,
      'Biaya Iklan Harian':         iklan,
      'Profit Produk':              profit,
      'Net Profit':                 netProfit,
      'Net Margin %':               margin,
    }
  })
  save(sheet(rows, 'Rekap Harian'), filename)
}

// ── Export analisa produk ────────────────────────────────────
export function exportProdukXLSX(
  data: ProductSummary[],
  filename = 'analisa_produk.xlsx'
) {
  const rows = data.map((p, i) => ({
    'Rank':            i + 1,
    'Produk':          p.nama_produk,
    'SKU':             p.sku ?? '',
    'Qty Terjual':     p.total_qty,
    'Total Omzet':     p.total_omzet,
    'Total Modal':     p.total_modal,
    'Total Profit':    p.total_profit,
    'Avg Profit/pcs':  p.total_qty > 0 ? Math.round(p.total_profit / p.total_qty) : 0,
    'Margin %':        p.total_omzet > 0 ? parseFloat(((p.total_profit / p.total_omzet) * 100).toFixed(2)) : 0,
    'Total Transaksi': p.total_transaksi,
    'Terakhir Jual':   formatDate(p.last_sold_date, 'yyyy-MM-dd'),
  }))
  save(sheet(rows, 'Analisa Produk'), filename)
}

// ── Template import transaksi manual ──────────────────────────
export function downloadImportTemplate() {
  const headers = [
    'tanggal', 'order_id', 'nama_pembeli', 'nama_produk', 'sku_induk', 'variasi',
    'qty', 'harga_jual', 'harga_modal',
    'biaya_administrasi',
    'biaya_program_hemat_biaya_kirim',
    'biaya_layanan_promo_xtra_gratis_ongkir_xtra',
    'biaya_proses_pesanan',
    'biaya_transaksi_spaylater',
    'biaya_ams',
    'catatan',
  ]
  const example = [
    '2025-04-08', '250408ABCXYZ', 'Budi Santoso', 'Kampas Rem Honda Vario 125',
    'SKU-IND-001', 'Standar', '2', '55000', '25000',
    '2420', '0', '1100', '0', '0', '0', '',
  ]
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Template')
  save(wb, 'template_import.xlsx')
}
