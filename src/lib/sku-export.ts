// src/lib/sku-export.ts
import * as XLSX from 'xlsx'
import type { MasterSku, SkuModalSummary } from '@/types'
import { formatDate } from './utils'

function saveXLSX(rows: Record<string, unknown>[], sheetName: string, filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

export function exportMasterSkuXLSX(data: MasterSku[], filename = 'master_sku.xlsx') {
  const rows = data.map(m => ({
    'SKU':          m.sku,
    'SKU Induk':    m.sku_induk ?? '',
    'Nama Produk':  m.nama_produk,
    'Nama Variasi': m.nama_variasi ?? '',
    'Harga Modal':  m.harga_modal,
    'Kategori':     m.kategori ?? '',
    'Supplier':     m.supplier ?? '',
    'Catatan':      m.catatan ?? '',
    'Aktif':        m.is_active ? 'Ya' : 'Tidak',
    'Dibuat':       formatDate(m.created_at),
    'Diperbarui':   formatDate(m.updated_at),
  }))
  saveXLSX(rows, 'Master SKU', filename)
}

export function exportSkuModalSummaryXLSX(data: SkuModalSummary[], filename = 'rekap_modal_sku.xlsx') {
  const rows = data.map((s, i) => ({
    'Rank':              i + 1,
    'SKU':               s.sku,
    'SKU Induk':         s.sku_induk ?? '',
    'Nama Produk':       s.nama_produk,
    'Variasi':           s.nama_variasi ?? '',
    'Kategori':          s.kategori ?? '',
    'Supplier':          s.supplier ?? '',
    'Modal/item (Rp)':   s.modal_master_saat_ini,
    'Total Qty Keluar':  s.total_qty,
    'Total Modal Keluar':s.total_modal_keluar,
    'Total Omzet':       s.total_omzet,
    'Total Profit':      s.total_profit,
    'Total Transaksi':   s.total_transaksi,
    'Terakhir Terjual':  formatDate(s.last_sold_date),
    'Trx Unmatched':     s.trx_unmatched,
  }))
  saveXLSX(rows, 'Rekap Modal SKU', filename)
}

export function downloadMasterSkuTemplate() {
  const headers = ['sku','sku_induk','nama_produk','nama_variasi','harga_modal','kategori','supplier','catatan']
  const example = ['SKU-001','SKU-IND-001','Kampas Rem Vario 125','Standar','25000','Rem','Supplier A','']
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Template Master SKU')
  XLSX.writeFile(wb, 'template_master_sku.xlsx')
}
