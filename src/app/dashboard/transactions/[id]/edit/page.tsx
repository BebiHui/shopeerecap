// src/app/dashboard/transactions/[id]/edit/page.tsx
import TransactionForm from '@/components/transactions/TransactionForm'
import { PageHeader } from '@/components/ui'

export default function EditTransactionPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <PageHeader
        title="Edit Transaksi"
        subtitle="Perbarui data transaksi"
        back="/dashboard/transactions"
      />
      <TransactionForm editId={params.id} />
    </div>
  )
}
