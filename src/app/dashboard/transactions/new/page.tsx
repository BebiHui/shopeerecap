// src/app/dashboard/transactions/new/page.tsx
import TransactionForm from '@/components/transactions/TransactionForm'
import { PageHeader } from '@/components/ui'
import Link from 'next/link'

export default function NewTransactionPage() {
  return (
    <div>
      <PageHeader
        title="Tambah Transaksi"
        subtitle="Input data penjualan baru"
        back="/dashboard/transactions"
      />
      <TransactionForm />
    </div>
  )
}
