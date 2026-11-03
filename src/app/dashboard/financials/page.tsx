import { Suspense } from "react"

import { getCustomers } from "@/app/actions/customers"
import { getVendors } from "@/app/actions/vendors"
import { getInvoices } from "@/app/actions/invoices"
import { getVendorBills } from "@/app/actions/vendor-bills"
import { getPayments } from "@/app/actions/payments"
import { getCreditMemos } from "@/app/actions/credit-memos"
import { getSageSquareReceipts } from "@/app/actions/sage-square-receipts"
import {
  FinancialsWorkspace,
  type FinancialsData,
} from "@/components/financials/financials-workspace"

const EMPTY: FinancialsData = {
  customers: [],
  vendors: [],
  invoices: [],
  bills: [],
  payments: [],
  creditMemos: [],
  squareReceipts: [],
  loadFailed: true,
}

/** Every list the workspace shows, read once on the server. */
async function loadFinancials(): Promise<FinancialsData> {
  try {
    const [customers, vendors, invoices, bills, payments, creditMemos, squareReceipts] =
      await Promise.all([
        getCustomers(),
        getVendors(),
        getInvoices(),
        getVendorBills(),
        getPayments(),
        getCreditMemos(),
        getSageSquareReceipts(),
      ])
    return { customers, vendors, invoices, bills, payments, creditMemos, squareReceipts, loadFailed: false }
  } catch {
    // The workspace shows the same "Failed to load financial data" toast.
    return EMPTY
  }
}

async function FinancialsContent() {
  const data = await loadFinancials()
  return <FinancialsWorkspace data={data} />
}

function FinancialsLoading() {
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-6 md:p-8 pt-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Financials
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground">
          Invoices, bills, payments, and credit memos
        </p>
      </div>
      <div className="rounded-md border p-8 text-center text-muted-foreground">
        Loading...
      </div>
    </div>
  )
}

export default function FinancialsPage() {
  return (
    <Suspense fallback={<FinancialsLoading />}>
      <FinancialsContent />
    </Suspense>
  )
}
