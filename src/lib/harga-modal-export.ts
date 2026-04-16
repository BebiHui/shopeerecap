// src/lib/harga-modal-export.ts
import * as XLSX from 'xlsx'
import type { MasterHargaModal, ShopeeSkuSummary } from '@/types'
import { formatDate, formatRupiah } from './utils'

function save(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename)
}

export function exportMasterHargaModalXLSX(
  data: MasterHargaModal[],
  filename = 'master_harga_modal.xlsx'
) {
  const rows = data.map(m => ({
    'SKU Induk':    m.sku_induk,
    'Nama Produk':  m.nama_produk,
    'Nama Variasi': m.nama_variasi ?? '',
    'Harga Modal':  m.harga_modal,
    'Aktif':        m.is_active ? 'Ya' : 'Tidak',
    'Dibuat':       formatDate(m.created_at),
    'Diperbarui':   formatDate(m.updated_at),
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Master Harga Modal')
  save(wb, filename)
}

export function exportShopeeSkuSummaryXLSX(
  data: ShopeeSkuSummary[],
  filename = 'rekap_profit_sku.xlsx'
) {
  const rows = data.map((s, i) => {
    const margin = s.total_omzet > 0
      ? parseFloat(((s.total_profit / s.total_omzet) * 100).toFixed(2))
      : 0
    return {
      'Rank':               i + 1,
      'SKU Induk':          s.sku_induk ?? '—',
      'Nama Produk':        s.nama_produk ?? '—',
      'Harga Modal/item':   s.harga_modal_master ?? 0,
      'Total Qty':          s.total_qty,
      'Total Omzet':        s.total_omzet,
      'Total Modal Keluar': s.total_modal_keluar,
      'Total Biaya Shopee': s.total_biaya_shopee,
      'Total Profit':       s.total_profit,
      'Margin %':           margin,
      'Total Transaksi':    s.total_transaksi,
      'Terakhir Jual':      formatDate(s.last_sold_date),
      'Trx Unmatched':      s.trx_unmatched,
    }
  })
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Rekap Profit SKU')
  save(wb, filename)
}

export function downloadHargaModalTemplate() {
  const headers = ['SKU Induk', 'Nama Produk', 'Nama Variasi', 'Harga Modal']
  const examples = [
    ['SKU-IND-001', 'Kampas Rem Honda Vario 125', 'Standar', '25000'],
    ['SKU-IND-002', 'Oli Yamalube 10W-40 1L', '1 Liter', '38000'],
    ['SKU-IND-003', 'Ban IRC 80/90-14', 'Tubeless', '185000'],
  ]
  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples])
  // Format header bold
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Template')
  save(wb, 'template_harga_modal.xlsx')
}
