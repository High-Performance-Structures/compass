"use client"

import * as React from "react"
import { IconPlus } from "@tabler/icons-react"
import { useSearchParams, useRouter } from "next/navigation"
import { toast } from "sonner"

import { getCustomers } from "@/app/actions/customers"
import { getVendors } from "@/app/actions/vendors"
import { getProjects } from "@/app/actions/projects"
import {
  getInvoices,
  createInvoice,
  updateInvoice,
  deleteInvoice,
} from "@/app/actions/invoices"
import {
  getVendorBills,
  createVendorBill,
  updateVendorBill,
  deleteVendorBill,
} from "@/app/actions/vendor-bills"
import {
  getPayments,
  createPayment,
  updatePayment,
  deletePayment,
} from "@/app/actions/payments"
import {
  getCreditMemos,
  createCreditMemo,
  updateCreditMemo,
  deleteCreditMemo,
} from "@/app/actions/credit-memos"

import type { Customer, Vendor, Project } from "@/db/schema"
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
import { CreditMemosTable } from "@/components/financials/credit-memos-table"
import { CreditMemoDialog } from "@/components/financials/credit-memo-dialog"

type Tab = "invoices" | "bills" | "payments" | "credit-memos"

export default function FinancialsPage() {
  return (
    <React.Suspense fallback={
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
    }>
      <FinancialsContent />
    </React.Suspense>
  )
}

function FinancialsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialTab = (searchParams.get("tab") as Tab) || "invoices"

  const [tab, setTab] = React.useState<Tab>(initialTab)
  const [loading, setLoading] = React.useState(true)

  const [customersList, setCustomersList] = React.useState<Customer[]>([])
  const [vendorsList, setVendorsList] = React.useState<Vendor[]>([])
  const [projectsList, setProjectsList] = React.useState<Project[]>([])

  const [invoicesList, setInvoicesList] = React.useState<Invoice[]>([])
  const [billsList, setBillsList] = React.useState<VendorBill[]>([])
  const [paymentsList, setPaymentsList] = React.useState<Payment[]>([])
  const [memosList, setMemosList] = React.useState<CreditMemo[]>([])

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

  const loadAll = async () => {
    try {
      const [c, v, p, inv, bills, pay, cm] = await Promise.all([
        getCustomers(),
        getVendors(),
        getProjects(),
        getInvoices(),
        getVendorBills(),
        getPayments(),
        getCreditMemos(),
      ])
      setCustomersList(c)
      setVendorsList(v)
      setProjectsList(p as Project[])
      setInvoicesList(inv)
      setBillsList(bills)
      setPaymentsList(pay)
      setMemosList(cm)
    } catch {
      toast.error("Failed to load financial data")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { loadAll() }, [])

  const handleTabChange = (value: string) => {
    setTab(value as Tab)
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

  // invoice handlers
  const handleInvoiceSubmit = async (data: Parameters<typeof createInvoice>[0] & { lineItems: string; subtotal: number; tax: number; total: number; amountPaid: number; amountDue: number }) => {
    if (editingInvoice) {
      const result = await updateInvoice(editingInvoice.id, data)
      if (result.success) toast.success("Invoice updated")
      else { toast.error(result.error || "Failed"); return }
    } else {
      const result = await createInvoice(data)
      if (result.success) toast.success("Invoice created")
      else { toast.error(result.error || "Failed"); return }
    }
    setInvoiceDialogOpen(false)
    await loadAll()
  }

  const handleDeleteInvoice = async (id: string) => {
    const result = await deleteInvoice(id)
    if (result.success) { toast.success("Invoice deleted"); await loadAll() }
    else toast.error(result.error || "Failed")
  }

  // bill handlers
  const handleBillSubmit = async (data: Parameters<typeof createVendorBill>[0] & { lineItems: string; subtotal: number; tax: number; total: number; amountPaid: number; amountDue: number }) => {
    if (editingBill) {
      const result = await updateVendorBill(editingBill.id, data)
      if (result.success) toast.success("Bill updated")
      else { toast.error(result.error || "Failed"); return }
    } else {
      const result = await createVendorBill(data)
      if (result.success) toast.success("Bill created")
      else { toast.error(result.error || "Failed"); return }
    }
    setBillDialogOpen(false)
    await loadAll()
  }

  const handleDeleteBill = async (id: string) => {
    const result = await deleteVendorBill(id)
    if (result.success) { toast.success("Bill deleted"); await loadAll() }
    else toast.error(result.error || "Failed")
  }

  // payment handlers
  const handlePaymentSubmit = async (data: Parameters<typeof createPayment>[0] & { paymentType: string; amount: number; paymentDate: string }) => {
    if (editingPayment) {
      const result = await updatePayment(editingPayment.id, data)
      if (result.success) toast.success("Payment updated")
      else { toast.error(result.error || "Failed"); return }
    } else {
      const result = await createPayment(data)
      if (result.success) toast.success("Payment created")
      else { toast.error(result.error || "Failed"); return }
    }
    setPaymentDialogOpen(false)
    await loadAll()
  }

  const handleDeletePayment = async (id: string) => {
    const result = await deletePayment(id)
    if (result.success) { toast.success("Payment deleted"); await loadAll() }
    else toast.error(result.error || "Failed")
  }

  // credit memo handlers
  const handleMemoSubmit = async (data: Parameters<typeof createCreditMemo>[0] & { lineItems: string; total: number; amountApplied: number; amountRemaining: number }) => {
    if (editingMemo) {
      const result = await updateCreditMemo(editingMemo.id, data)
      if (result.success) toast.success("Credit memo updated")
      else { toast.error(result.error || "Failed"); return }
    } else {
      const result = await createCreditMemo(data)
      if (result.success) toast.success("Credit memo created")
      else { toast.error(result.error || "Failed"); return }
    }
    setMemoDialogOpen(false)
    await loadAll()
  }

  const handleDeleteMemo = async (id: string) => {
    const result = await deleteCreditMemo(id)
    if (result.success) { toast.success("Credit memo deleted"); await loadAll() }
    else toast.error(result.error || "Failed")
  }

  if (loading) {
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

            {tab === "invoices" && (
              <Button
                onClick={() => {
                  setEditingInvoice(null)
                  setInvoiceDialogOpen(true)
                }}
                size="sm"
                className="w-full sm:w-auto h-9"
              >
                <IconPlus className="mr-2 size-4" />
                New Invoice
              </Button>
            )}
            {tab === "bills" && (
              <Button
                onClick={() => {
                  setEditingBill(null)
                  setBillDialogOpen(true)
                }}
                size="sm"
                className="w-full sm:w-auto h-9"
              >
                <IconPlus className="mr-2 size-4" />
                New Bill
              </Button>
            )}
            {tab === "payments" && (
              <Button
                onClick={() => {
                  setEditingPayment(null)
                  setPaymentDialogOpen(true)
                }}
                size="sm"
                className="w-full sm:w-auto h-9"
              >
                <IconPlus className="mr-2 size-4" />
                New Payment
              </Button>
            )}
            {tab === "credit-memos" && (
              <Button
                onClick={() => {
                  setEditingMemo(null)
                  setMemoDialogOpen(true)
                }}
                size="sm"
                className="w-full sm:w-auto h-9"
              >
                <IconPlus className="mr-2 size-4" />
                New Credit Memo
              </Button>
            )}
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
        projects={projectsList as Project[]}
        onSubmit={handleInvoiceSubmit}
      />

      <VendorBillDialog
        open={billDialogOpen}
        onOpenChange={setBillDialogOpen}
        initialData={editingBill}
        vendors={vendorsList}
        projects={projectsList as Project[]}
        onSubmit={handleBillSubmit}
      />

      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        initialData={editingPayment}
        customers={customersList}
        vendors={vendorsList}
        projects={projectsList as Project[]}
        onSubmit={handlePaymentSubmit}
      />

      <CreditMemoDialog
        open={memoDialogOpen}
        onOpenChange={setMemoDialogOpen}
        initialData={editingMemo}
        customers={customersList}
        projects={projectsList as Project[]}
        onSubmit={handleMemoSubmit}
      />
    </>
  )
}
