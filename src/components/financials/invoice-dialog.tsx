"use client"

import * as React from "react"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog"
import {
  ChoiceField,
  CustomerField,
  DateField,
  DialogSaveFooter,
  LineItemsField,
  MemoField,
  PreconstructionField,
  ProjectField,
  TaxAndTotalsFields,
  TextField,
} from "./financial-dialog-fields"
import {
  billTotals,
  lineItemsSubtotal,
  parseLineItems,
  type LineItem,
} from "@/lib/domain/financials/rules"
import type { Invoice } from "@/db/schema-netsuite"
import type { BillingScope } from "@/lib/financials/billing-scope"
import type { Customer, Project } from "@/db/schema"

const INVOICE_STATUSES = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "void",
] as const

interface InvoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: Invoice | null
  customers: Customer[]
  projects: readonly Pick<Project, "id" | "name">[]
  onSubmit: (data: {
    customerId: string
    projectId: string | null
    invoiceNumber: string
    status: string
    issueDate: string
    dueDate: string
    memo: string
    billingScope: BillingScope
    lineItems: string
    subtotal: number
    tax: number
    total: number
    amountPaid: number
    amountDue: number
  }) => void
}

export function InvoiceDialog({
  open,
  onOpenChange,
  initialData,
  customers,
  projects,
  onSubmit,
}: InvoiceDialogProps) {
  const [customerId, setCustomerId] = React.useState("")
  const [projectId, setProjectId] = React.useState("")
  const [invoiceNumber, setInvoiceNumber] = React.useState("")
  const [status, setStatus] = React.useState("draft")
  const [issueDate, setIssueDate] = React.useState("")
  const [dueDate, setDueDate] = React.useState("")
  const [memo, setMemo] = React.useState("")
  const [preconstruction, setPreconstruction] = React.useState(false)
  const [tax, setTax] = React.useState(0)
  const [lines, setLines] = React.useState<LineItem[]>([])

  React.useEffect(() => {
    if (initialData) {
      setCustomerId(initialData.customerId)
      setProjectId(initialData.projectId ?? "")
      setInvoiceNumber(initialData.invoiceNumber ?? "")
      setStatus(initialData.status)
      setIssueDate(initialData.issueDate)
      setDueDate(initialData.dueDate ?? "")
      setMemo(initialData.memo ?? "")
      setPreconstruction(initialData.billingScope === "preconstruction")
      setTax(initialData.tax)
      setLines(
        parseLineItems(initialData.lineItems) ?? []
      )
    } else {
      setCustomerId("")
      setProjectId("")
      setInvoiceNumber("")
      setStatus("draft")
      setIssueDate(new Date().toISOString().split("T")[0])
      setDueDate("")
      setMemo("")
      setPreconstruction(false)
      setTax(0)
      setLines([])
    }
  }, [initialData, open])

  // Preview only: the server recomputes these from the lines on save.
  const { subtotal, total, amountDue } = billTotals(
    lineItemsSubtotal(lines),
    tax,
    initialData?.amountPaid ?? 0
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerId || !issueDate) return
    onSubmit({
      customerId,
      projectId: projectId || null,
      invoiceNumber,
      status,
      issueDate,
      dueDate,
      memo,
      billingScope: preconstruction ? "preconstruction" : "construction",
      lineItems: JSON.stringify(lines),
      subtotal,
      tax,
      total,
      amountPaid: initialData?.amountPaid ?? 0,
      amountDue,
    })
  }

  const page1 = (
    <>
      <CustomerField label="Customer *" customers={customers} value={customerId} onChange={setCustomerId} />
      <ProjectField projects={projects} value={projectId} onChange={setProjectId} />
      <TextField label="Invoice #" value={invoiceNumber} onChange={setInvoiceNumber} />
      <ChoiceField label="Status" choices={INVOICE_STATUSES} value={status} onChange={setStatus} />
    </>
  )

  const page2 = (
    <>
      <DateField label="Issue Date *" value={issueDate} onChange={setIssueDate} placeholder="Select issue date" />
      <DateField label="Due Date" value={dueDate} onChange={setDueDate} placeholder="Select due date" />
      <MemoField value={memo} onChange={setMemo} />
      <PreconstructionField verb="billed" checked={preconstruction} onChange={setPreconstruction} />
    </>
  )

  const page3 = <LineItemsField lines={lines} onChange={setLines} />

  const page4 = <TaxAndTotalsFields tax={tax} onTaxChange={setTax} subtotal={subtotal} total={total} />

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Invoice" : "New Invoice"}
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ResponsiveDialogBody pages={[page1, page2, page3, page4]} />
        <DialogSaveFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={initialData ? "Save Changes" : "Create Invoice"}
        />
      </form>
    </ResponsiveDialog>
  )
}
