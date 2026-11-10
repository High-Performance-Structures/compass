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
  MemoField,
  MoneyField,
  PreconstructionField,
  ProjectField,
  TextField,
  VendorField,
} from "./financial-dialog-fields"
import type { Payment } from "@/db/schema-netsuite"
import type { BillingScope } from "@/lib/financials/billing-scope"
import type { Customer, Vendor, Project } from "@/db/schema"

/** "received" from a customer, "sent" to a vendor. */
const PAYMENT_TYPES = ["received", "sent"] as const
const PAYMENT_TYPE_LABELS = { received: "Received", sent: "Sent" }

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
    billingScope: BillingScope
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
  const [preconstruction, setPreconstruction] = React.useState(false)

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
      setPreconstruction(initialData.billingScope === "preconstruction")
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
      setPreconstruction(false)
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
      billingScope: preconstruction ? "preconstruction" : "construction",
    })
  }

  const page1 = (
    <>
      <ChoiceField
        label="Type *"
        choices={PAYMENT_TYPES}
        labels={PAYMENT_TYPE_LABELS}
        value={paymentType}
        onChange={setPaymentType}
      />
      {paymentType === "received" && (
        <CustomerField label="Customer" customers={customers} value={customerId} onChange={setCustomerId} optional />
      )}
      {paymentType === "sent" && (
        <VendorField label="Vendor" vendors={vendors} value={vendorId} onChange={setVendorId} optional />
      )}
      <ProjectField projects={projects} value={projectId} onChange={setProjectId} />
    </>
  )

  const page2 = (
    <>
      <MoneyField label="Amount *" value={amount} onChange={setAmount} required />
      <DateField label="Date *" value={paymentDate} onChange={setPaymentDate} placeholder="Select date" />
    </>
  )

  const page3 = (
    <>
      <ChoiceField
        label="Method"
        choices={PAYMENT_METHODS}
        value={paymentMethod}
        onChange={setPaymentMethod}
        placeholder="Select method"
      />
      <TextField label="Reference #" value={referenceNumber} onChange={setReferenceNumber} />
      <MemoField value={memo} onChange={setMemo} />
      <PreconstructionField verb="received" checked={preconstruction} onChange={setPreconstruction} />
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
        <DialogSaveFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={initialData ? "Save Changes" : "Create Payment"}
        />
      </form>
    </ResponsiveDialog>
  )
}
