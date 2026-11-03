"use client"

import * as React from "react"
import { IconPlus } from "@tabler/icons-react"
import { Plus } from "lucide-react"
import { useSearchParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { useRegisterPageActions } from "@/hooks/use-register-page-actions"

import { useProjectList } from "@/components/project-list-provider"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import {
  createInvoice,
  updateInvoice,
  deleteInvoice,
} from "@/app/actions/invoices"
import {
  createVendorBill,
  updateVendorBill,
  deleteVendorBill,
} from "@/app/actions/vendor-bills"
import {
  createPayment,
  updatePayment,
  deletePayment,
} from "@/app/actions/payments"
import {
  createCreditMemo,
  updateCreditMemo,
  deleteCreditMemo,
} from "@/app/actions/credit-memos"
import {
  getSageSquareReceipts,
  type SquareReceiptListItem,
} from "@/app/actions/sage-square-receipts"

import type { ActionFailure } from "@/lib/action-result"
import type { Customer, Vendor } from "@/db/schema"
import type {
  Invoice,
  VendorBill,
  Payment,
  CreditMemo,
} from "@/db/schema-netsuite"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { InvoicesTable } from "@/components/financials/invoices-table"
import { InvoiceDialog } from "@/components/financials/invoice-dialog"
import { VendorBillsTable } from "@/components/financials/vendor-bills-table"
import { VendorBillDialog } from "@/components/financials/vendor-bill-dialog"
import { PaymentsTable } from "@/components/financials/payments-table"
import { PaymentDialog } from "@/components/financials/payment-dialog"
import { SquareReceiptsTable } from "@/components/financials/square-receipts-table"
import { CreditMemosTable } from "@/components/financials/credit-memos-table"
import { CreditMemoDialog } from "@/components/financials/credit-memo-dialog"

const TABS = ["invoices", "bills", "payments", "credit-memos"] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return TABS.some((tab) => tab === value)
}

/** What the server page loads for the workspace. */
export type FinancialsData = {
  readonly customers: Customer[]
  readonly vendors: Vendor[]
  readonly invoices: Invoice[]
  readonly bills: VendorBill[]
  readonly payments: Payment[]
  readonly creditMemos: CreditMemo[]
  readonly squareReceipts: SquareReceiptListItem[]
  /** A load failed on the server; every list is empty. */
  readonly loadFailed: boolean
}

type SaveResult = { readonly success: true } | ActionFailure

/** Runs a create or update and shows the toast the page has always shown. */
async function saveRecord(label: string, editing: boolean, save: () => Promise<SaveResult>): Promise<boolean> {
  const result = await save()
  if (result.success) {
    toast.success(`${label} ${editing ? "updated" : "created"}`)
    return true
  }
  toast.error(result.error || "Failed")
  return false
}

async function removeRecord(label: string, remove: () => Promise<SaveResult>, reload: () => void): Promise<void> {
  const result = await remove()
  if (result.success) { toast.success(`${label} deleted`); reload() }
  else toast.error(result.error || "Failed")
}

function FinancialsTabList() {
  return (
    <div className="overflow-x-auto min-w-0">
      <TabsList className="w-max sm:w-auto">
        <TabsTrigger value="invoices" className="text-xs sm:text-sm shrink-0">
          Invoices
        </TabsTrigger>
        <TabsTrigger value="bills" className="text-xs sm:text-sm shrink-0">
          Bills
        </TabsTrigger>
        <TabsTrigger value="payments" className="text-xs sm:text-sm shrink-0">
          Payments
        </TabsTrigger>
        <TabsTrigger value="credit-memos" className="text-xs sm:text-sm shrink-0">
          <span className="sm:hidden">Credits</span>
          <span className="hidden sm:inline">Credit Memos</span>
        </TabsTrigger>
      </TabsList>
    </div>
  )
}

type PolledReceipts = {
  /** The server-rendered list this poll result stands in for. */
  readonly from: readonly SquareReceiptListItem[]
  readonly receipts: SquareReceiptListItem[]
}

export function FinancialsWorkspace({ data }: { readonly data: FinancialsData }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get("tab")
  const initialTab: Tab = isTab(tabParam) ? tabParam : "invoices"
  const selectedSquareReceipt = searchParams.get("squareReceipt")

  const [tab, setTab] = React.useState<Tab>(initialTab)

  const customersList = data.customers
  const vendorsList = data.vendors
  // The dashboard layout already loaded the viewer's projects.
  const projectsList = useProjectList()

  const invoicesList = data.invoices
  const billsList = data.bills
  const paymentsList = data.payments
  const memosList = data.creditMemos
  // The Payments tab polls Square receipts; a newer server render wins.
  const [polledReceipts, setPolledReceipts] =
    React.useState<PolledReceipts | null>(null)
  const serverReceipts = data.squareReceipts
  const squareReceipts =
    polledReceipts && polledReceipts.from === serverReceipts
      ? polledReceipts.receipts
      : serverReceipts

  const [invoiceDialogOpen, setInvoiceDialogOpen] = React.useState(false)
  const [editingInvoice, setEditingInvoice] =
    React.useState<Invoice | null>(null)

  const [billDialogOpen, setBillDialogOpen] = React.useState(false)
  const [editingBill, setEditingBill] =
    React.useState<VendorBill | null>(null)

  const [paymentDialogOpen, setPaymentDialogOpen] = React.useState(false)
  const [editingPayment, setEditingPayment] =
    React.useState<Payment | null>(null)

  const [memoDialogOpen, setMemoDialogOpen] = React.useState(false)
  const [editingMemo, setEditingMemo] =
    React.useState<CreditMemo | null>(null)

  React.useEffect(() => {
    if (data.loadFailed) toast.error("Failed to load financial data")
  }, [data.loadFailed])

  // The actions revalidate this page; refresh to show the new server data.
  const reload = () => router.refresh()

  useVisibleInterval(
    () => {
      void getSageSquareReceipts()
        .then((receipts) => setPolledReceipts({ from: serverReceipts, receipts }))
        .catch(() => undefined)
    },
    15_000,
    { enabled: tab === "payments", immediate: false },
  )

  const openInvoice = React.useCallback(() => {
    setEditingInvoice(null)
    setInvoiceDialogOpen(true)
  }, [])

  const openBill = React.useCallback(() => {
    setEditingBill(null)
    setBillDialogOpen(true)
  }, [])

  const openPayment = React.useCallback(() => {
    setEditingPayment(null)
    setPaymentDialogOpen(true)
  }, [])

  const openMemo = React.useCallback(() => {
    setEditingMemo(null)
    setMemoDialogOpen(true)
  }, [])

  const TAB_ACTIONS: Record<
    Tab,
    { id: string; label: string; onSelect: () => void }
  > = React.useMemo(
    () => ({
      invoices: {
        id: "new-invoice",
        label: "New Invoice",
        onSelect: openInvoice,
      },
      bills: {
        id: "new-bill",
        label: "New Bill",
        onSelect: openBill,
      },
      payments: {
        id: "new-payment",
        label: "New Payment",
        onSelect: openPayment,
      },
      "credit-memos": {
        id: "new-credit-memo",
        label: "New Credit Memo",
        onSelect: openMemo,
      },
    }),
    [openInvoice, openBill, openPayment, openMemo]
  )

  const pageActions = React.useMemo(() => {
    const action = TAB_ACTIONS[tab]
    return [{ ...action, icon: Plus }]
  }, [tab, TAB_ACTIONS])

  useRegisterPageActions(pageActions)

  const handleTabChange = (value: string) => {
    if (isTab(value)) setTab(value)
    router.replace(`/dashboard/financials?tab=${value}`, { scroll: false })
  }

  const customerMap = React.useMemo(
    () =>
      Object.fromEntries(customersList.map((c) => [c.id, c.name])),
    [customersList]
  )
  const vendorMap = React.useMemo(
    () =>
      Object.fromEntries(vendorsList.map((v) => [v.id, v.name])),
    [vendorsList]
  )
  const projectMap = React.useMemo(
    () =>
      Object.fromEntries(projectsList.map((p) => [p.id, p.name])),
    [projectsList]
  )

  const handleInvoiceSubmit = async (data: Parameters<typeof createInvoice>[0] & { lineItems: string; subtotal: number; tax: number; total: number; amountPaid: number; amountDue: number }) => {
    const saved = await saveRecord("Invoice", editingInvoice !== null, () =>
      editingInvoice ? updateInvoice(editingInvoice.id, data) : createInvoice(data))
    if (!saved) return
    setInvoiceDialogOpen(false)
    reload()
  }

  const handleBillSubmit = async (data: Parameters<typeof createVendorBill>[0] & { lineItems: string; subtotal: number; tax: number; total: number; amountPaid: number; amountDue: number }) => {
    const saved = await saveRecord("Bill", editingBill !== null, () =>
      editingBill ? updateVendorBill(editingBill.id, data) : createVendorBill(data))
    if (!saved) return
    setBillDialogOpen(false)
    reload()
  }

  const handlePaymentSubmit = async (data: Parameters<typeof createPayment>[0] & { paymentType: string; amount: number; paymentDate: string }) => {
    const saved = await saveRecord("Payment", editingPayment !== null, () =>
      editingPayment ? updatePayment(editingPayment.id, data) : createPayment(data))
    if (!saved) return
    setPaymentDialogOpen(false)
    reload()
  }

  const handleMemoSubmit = async (data: Parameters<typeof createCreditMemo>[0] & { lineItems: string; total: number; amountApplied: number; amountRemaining: number }) => {
    const saved = await saveRecord("Credit memo", editingMemo !== null, () =>
      editingMemo ? updateCreditMemo(editingMemo.id, data) : createCreditMemo(data))
    if (!saved) return
    setMemoDialogOpen(false)
    reload()
  }

  const handleDeleteInvoice = (id: string) => removeRecord("Invoice", () => deleteInvoice(id), reload)
  const handleDeleteBill = (id: string) => removeRecord("Bill", () => deleteVendorBill(id), reload)
  const handleDeletePayment = (id: string) => removeRecord("Payment", () => deletePayment(id), reload)
  const handleDeleteMemo = (id: string) => removeRecord("Credit memo", () => deleteCreditMemo(id), reload)
  const newAction = TAB_ACTIONS[tab]

  return (
    <>
      <div className="flex-1 space-y-6 p-4 sm:p-6 md:p-8 pt-6">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
            Financials
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Invoices, bills, payments, and credit memos
          </p>
        </div>

        <Tabs value={tab} onValueChange={handleTabChange}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <FinancialsTabList />

            <Button onClick={newAction.onSelect} size="sm" className="w-full sm:w-auto h-9">
              <IconPlus className="mr-2 size-4" />
              {newAction.label}
            </Button>
          </div>

          <TabsContent value="invoices" className="mt-4">
            <InvoicesTable
              invoices={invoicesList}
              customerMap={customerMap}
              projectMap={projectMap}
              onEdit={(inv) => {
                setEditingInvoice(inv)
                setInvoiceDialogOpen(true)
              }}
              onDelete={handleDeleteInvoice}
            />
          </TabsContent>

          <TabsContent value="bills" className="mt-4">
            <VendorBillsTable
              bills={billsList}
              vendorMap={vendorMap}
              projectMap={projectMap}
              onEdit={(bill) => {
                setEditingBill(bill)
                setBillDialogOpen(true)
              }}
              onDelete={handleDeleteBill}
            />
          </TabsContent>

          <TabsContent value="payments" className="mt-4">
            <div className="space-y-4">
              <SquareReceiptsTable
                receipts={squareReceipts}
                selectedReceiptId={selectedSquareReceipt}
              />
              <PaymentsTable
                payments={paymentsList}
                customerMap={customerMap}
                vendorMap={vendorMap}
                projectMap={projectMap}
                onEdit={(pay) => {
                  setEditingPayment(pay)
                  setPaymentDialogOpen(true)
                }}
                onDelete={handleDeletePayment}
              />
            </div>
          </TabsContent>

          <TabsContent value="credit-memos" className="mt-4">
            <CreditMemosTable
              creditMemos={memosList}
              customerMap={customerMap}
              onEdit={(memo) => {
                setEditingMemo(memo)
                setMemoDialogOpen(true)
              }}
              onDelete={handleDeleteMemo}
            />
          </TabsContent>
        </Tabs>
      </div>

      <InvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        initialData={editingInvoice}
        customers={customersList}
        projects={projectsList}
        onSubmit={handleInvoiceSubmit}
      />

      <VendorBillDialog
        open={billDialogOpen}
        onOpenChange={setBillDialogOpen}
        initialData={editingBill}
        vendors={vendorsList}
        projects={projectsList}
        onSubmit={handleBillSubmit}
      />

      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        initialData={editingPayment}
        customers={customersList}
        vendors={vendorsList}
        projects={projectsList}
        onSubmit={handlePaymentSubmit}
      />

      <CreditMemoDialog
        open={memoDialogOpen}
        onOpenChange={setMemoDialogOpen}
        initialData={editingMemo}
        customers={customersList}
        projects={projectsList}
        onSubmit={handleMemoSubmit}
      />
    </>
  )
}
