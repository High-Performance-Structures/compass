"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { LineItemsEditor, type LineItem } from "./line-items-editor"
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
  projects: Project[]
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
        initialData.lineItems ? JSON.parse(initialData.lineItems) : []
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

  const subtotal = lines.reduce((s, l) => s + l.amount, 0)
  const total = subtotal + tax
  const amountDue = total - (initialData?.amountPaid ?? 0)

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
      <div className="space-y-1.5">
        <Label className="text-xs">Vendor *</Label>
        <Select value={vendorId} onValueChange={setVendorId}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Select vendor" />
          </SelectTrigger>
          <SelectContent>
            {vendors.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Project</Label>
        <Select value={projectId || "none"} onValueChange={(v) => setProjectId(v === "none" ? "" : v)}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Select project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Bill #</Label>
        <Input
          className="h-9"
          value={billNumber}
          onChange={(e) => setBillNumber(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BILL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )

  const page2 = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Bill Date *</Label>
        <DatePicker
          value={billDate}
          onChange={setBillDate}
          placeholder="Select bill date"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Due Date</Label>
        <DatePicker
          value={dueDate}
          onChange={setDueDate}
          placeholder="Select due date"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Memo</Label>
        <Textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          className="text-sm"
        />
      </div>
    </>
  )

  const page3 = (
    <div className="space-y-1.5">
      <Label className="text-xs">Line Items</Label>
      <LineItemsEditor value={lines} onChange={setLines} />
    </div>
  )

  const page4 = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Tax</Label>
        <Input
          type="number"
          className="h-9"
          min={0}
          step="any"
          value={tax || ""}
          onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="space-y-1.5 rounded-md bg-muted/50 p-3">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Subtotal:</span>
          <span className="font-medium">${subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Tax:</span>
          <span className="font-medium">${tax.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm font-semibold pt-1 border-t">
          <span>Total:</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </div>
    </>
  )

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Bill" : "New Bill"}
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ResponsiveDialogBody pages={[page1, page2, page3, page4]} />

        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-9"
          >
            Cancel
          </Button>
          <Button type="submit" className="h-9">
            {initialData ? "Save Changes" : "Create Bill"}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </ResponsiveDialog>
  )
}
