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
import type { Payment } from "@/db/schema-netsuite"
import type { Customer, Vendor, Project } from "@/db/schema"

const PAYMENT_METHODS = [
  "check",
  "ach",
  "wire",
  "credit_card",
  "cash",
  "other",
] as const

interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: Payment | null
  customers: Customer[]
  vendors: Vendor[]
  projects: Project[]
  onSubmit: (data: {
    paymentType: string
    customerId: string | null
    vendorId: string | null
    projectId: string | null
    amount: number
    paymentDate: string
    paymentMethod: string
    referenceNumber: string
    memo: string
  }) => void
}

export function PaymentDialog({
  open,
  onOpenChange,
  initialData,
  customers,
  vendors,
  projects,
  onSubmit,
}: PaymentDialogProps) {
  const [paymentType, setPaymentType] = React.useState("received")
  const [customerId, setCustomerId] = React.useState("")
  const [vendorId, setVendorId] = React.useState("")
  const [projectId, setProjectId] = React.useState("")
  const [amount, setAmount] = React.useState(0)
  const [paymentDate, setPaymentDate] = React.useState("")
  const [paymentMethod, setPaymentMethod] = React.useState("")
  const [referenceNumber, setReferenceNumber] = React.useState("")
  const [memo, setMemo] = React.useState("")

  React.useEffect(() => {
    if (initialData) {
      setPaymentType(initialData.paymentType)
      setCustomerId(initialData.customerId ?? "")
      setVendorId(initialData.vendorId ?? "")
      setProjectId(initialData.projectId ?? "")
      setAmount(initialData.amount)
      setPaymentDate(initialData.paymentDate)
      setPaymentMethod(initialData.paymentMethod ?? "")
      setReferenceNumber(initialData.referenceNumber ?? "")
      setMemo(initialData.memo ?? "")
    } else {
      setPaymentType("received")
      setCustomerId("")
      setVendorId("")
      setProjectId("")
      setAmount(0)
      setPaymentDate(new Date().toISOString().split("T")[0])
      setPaymentMethod("")
      setReferenceNumber("")
      setMemo("")
    }
  }, [initialData, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!amount || !paymentDate) return
    onSubmit({
      paymentType,
      customerId: paymentType === "received" ? (customerId || null) : null,
      vendorId: paymentType === "sent" ? (vendorId || null) : null,
      projectId: projectId || null,
      amount,
      paymentDate,
      paymentMethod,
      referenceNumber,
      memo,
    })
  }

  const page1 = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Type *</Label>
        <Select value={paymentType} onValueChange={setPaymentType}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {paymentType === "received" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Customer</Label>
          <Select value={customerId || "none"} onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select customer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {paymentType === "sent" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Vendor</Label>
          <Select value={vendorId || "none"} onValueChange={(v) => setVendorId(v === "none" ? "" : v)}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
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
    </>
  )

  const page2 = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Amount *</Label>
        <Input
          type="number"
          className="h-9"
          min={0}
          step="any"
          value={amount || ""}
          onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Date *</Label>
        <DatePicker
          value={paymentDate}
          onChange={setPaymentDate}
          placeholder="Select date"
        />
      </div>
    </>
  )

  const page3 = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Method</Label>
        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Select method" />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {m.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Reference #</Label>
        <Input
          className="h-9"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
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

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Payment" : "New Payment"}
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ResponsiveDialogBody pages={[page1, page2, page3]} />

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
            {initialData ? "Save Changes" : "Create Payment"}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </ResponsiveDialog>
  )
}
