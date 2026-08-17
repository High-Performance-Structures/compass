"use client"

import * as React from "react"
import { ProjectCombobox } from "@/components/projects/project-combobox"
import { SearchableCombobox } from "@/components/searchable-combobox"
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
  projects: readonly Pick<Project, "id" | "name">[]
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
          <SearchableCombobox
            options={[
              { value: "", label: "None", keywords: "clear no customer" },
              ...customers.map((customer) => ({
                value: customer.id,
                label: customer.name,
                description: customer.company ?? customer.email ?? undefined,
                keywords: [customer.company, customer.email, customer.phone]
                  .filter(Boolean)
                  .join(" "),
              })),
            ]}
            value={customerId}
            onValueChange={setCustomerId}
            ariaLabel="Choose customer"
            placeholder="Select customer"
            searchPlaceholder="Search name, company, or email..."
            emptyMessage="No matching customers."
            className="h-9"
          />
        </div>
      )}
      {paymentType === "sent" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Vendor</Label>
          <SearchableCombobox
            options={[
              { value: "", label: "None", keywords: "clear no vendor" },
              ...vendors.map((vendor) => ({
                value: vendor.id,
                label: vendor.name,
                description: vendor.category,
                keywords: [vendor.category, vendor.email, vendor.phone]
                  .filter(Boolean)
                  .join(" "),
              })),
            ]}
            value={vendorId}
            onValueChange={setVendorId}
            ariaLabel="Choose vendor"
            placeholder="Select vendor"
            searchPlaceholder="Search name, category, or email..."
            emptyMessage="No matching vendors."
            className="h-9"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs">Project</Label>
        <ProjectCombobox
          projects={projects}
          value={projectId}
          onValueChange={setProjectId}
          specialOptions={[
            { value: "", label: "None", keywords: "clear no project" },
          ]}
          className="h-9"
        />
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
