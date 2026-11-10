"use client"

import * as React from "react"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog"
import {
  ChoiceField,
  DateField,
  DialogSaveFooter,
  LineItemsField,
  MemoField,
  ProjectField,
  TaxAndTotalsFields,
  TextField,
  VendorField,
} from "./financial-dialog-fields"
import {
  billTotals,
  lineItemsSubtotal,
  parseLineItems,
  type LineItem,
} from "@/lib/domain/financials/rules"
import type { VendorBill } from "@/db/schema-netsuite"
import type { Vendor, Project } from "@/db/schema"

const BILL_STATUSES = [
  "pending",
  "approved",
  "partially_paid",
  "paid",
  "void",
] as const

interface VendorBillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: VendorBill | null
  vendors: Vendor[]
  projects: readonly Pick<Project, "id" | "name">[]
  onSubmit: (data: {
    vendorId: string
    projectId: string | null
    billNumber: string
    status: string
    billDate: string
    dueDate: string
    memo: string
    lineItems: string
    subtotal: number
    tax: number
    total: number
    amountPaid: number
    amountDue: number
  }) => void
}

export function VendorBillDialog({
  open,
  onOpenChange,
  initialData,
  vendors,
  projects,
  onSubmit,
}: VendorBillDialogProps) {
  const [vendorId, setVendorId] = React.useState("")
  const [projectId, setProjectId] = React.useState("")
  const [billNumber, setBillNumber] = React.useState("")
  const [status, setStatus] = React.useState("pending")
  const [billDate, setBillDate] = React.useState("")
  const [dueDate, setDueDate] = React.useState("")
  const [memo, setMemo] = React.useState("")
  const [tax, setTax] = React.useState(0)
  const [lines, setLines] = React.useState<LineItem[]>([])

  React.useEffect(() => {
    if (initialData) {
      setVendorId(initialData.vendorId)
      setProjectId(initialData.projectId ?? "")
      setBillNumber(initialData.billNumber ?? "")
      setStatus(initialData.status)
      setBillDate(initialData.billDate)
      setDueDate(initialData.dueDate ?? "")
      setMemo(initialData.memo ?? "")
      setTax(initialData.tax)
      setLines(
        parseLineItems(initialData.lineItems) ?? []
      )
    } else {
      setVendorId("")
      setProjectId("")
      setBillNumber("")
      setStatus("pending")
      setBillDate(new Date().toISOString().split("T")[0])
      setDueDate("")
      setMemo("")
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
    if (!vendorId || !billDate) return
    onSubmit({
      vendorId,
      projectId: projectId || null,
      billNumber,
      status,
      billDate,
      dueDate,
      memo,
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
      <VendorField label="Vendor *" vendors={vendors} value={vendorId} onChange={setVendorId} />
      <ProjectField projects={projects} value={projectId} onChange={setProjectId} />
      <TextField label="Bill #" value={billNumber} onChange={setBillNumber} />
      <ChoiceField label="Status" choices={BILL_STATUSES} value={status} onChange={setStatus} />
    </>
  )

  const page2 = (
    <>
      <DateField label="Bill Date *" value={billDate} onChange={setBillDate} placeholder="Select bill date" />
      <DateField label="Due Date" value={dueDate} onChange={setDueDate} placeholder="Select due date" />
      <MemoField value={memo} onChange={setMemo} />
    </>
  )

  const page3 = <LineItemsField lines={lines} onChange={setLines} />

  const page4 = <TaxAndTotalsFields tax={tax} onTaxChange={setTax} subtotal={subtotal} total={total} />

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Bill" : "New Bill"}
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ResponsiveDialogBody pages={[page1, page2, page3, page4]} />
        <DialogSaveFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={initialData ? "Save Changes" : "Create Bill"}
        />
      </form>
    </ResponsiveDialog>
  )
}
