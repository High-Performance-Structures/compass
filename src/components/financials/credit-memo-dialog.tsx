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
  ProjectField,
  TextField,
} from "./financial-dialog-fields"
import {
  creditMemoTotals,
  lineItemsSubtotal,
  parseLineItems,
  type LineItem,
} from "@/lib/domain/financials/rules"
import type { CreditMemo } from "@/db/schema-netsuite"
import type { Customer, Project } from "@/db/schema"

const CREDIT_MEMO_STATUSES = ["draft", "applied", "void"] as const

interface CreditMemoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: CreditMemo | null
  customers: Customer[]
  projects: readonly Pick<Project, "id" | "name">[]
  onSubmit: (data: {
    customerId: string
    projectId: string | null
    memoNumber: string
    status: string
    issueDate: string
    memo: string
    lineItems: string
    total: number
    amountApplied: number
    amountRemaining: number
  }) => void
}

export function CreditMemoDialog({
  open,
  onOpenChange,
  initialData,
  customers,
  projects,
  onSubmit,
}: CreditMemoDialogProps) {
  const [customerId, setCustomerId] = React.useState("")
  const [projectId, setProjectId] = React.useState("")
  const [memoNumber, setMemoNumber] = React.useState("")
  const [status, setStatus] = React.useState("draft")
  const [issueDate, setIssueDate] = React.useState("")
  const [memoText, setMemoText] = React.useState("")
  const [lines, setLines] = React.useState<LineItem[]>([])

  React.useEffect(() => {
    if (initialData) {
      setCustomerId(initialData.customerId)
      setProjectId(initialData.projectId ?? "")
      setMemoNumber(initialData.memoNumber ?? "")
      setStatus(initialData.status)
      setIssueDate(initialData.issueDate)
      setMemoText(initialData.memo ?? "")
      setLines(
        parseLineItems(initialData.lineItems) ?? []
      )
    } else {
      setCustomerId("")
      setProjectId("")
      setMemoNumber("")
      setStatus("draft")
      setIssueDate(new Date().toISOString().split("T")[0])
      setMemoText("")
      setLines([])
    }
  }, [initialData, open])

  // Preview only: the server recomputes these from the lines on save.
  const amountApplied = initialData?.amountApplied ?? 0
  const { total, amountRemaining } = creditMemoTotals(
    lineItemsSubtotal(lines),
    amountApplied
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerId || !issueDate) return
    onSubmit({
      customerId,
      projectId: projectId || null,
      memoNumber,
      status,
      issueDate,
      memo: memoText,
      lineItems: JSON.stringify(lines),
      total,
      amountApplied,
      amountRemaining,
    })
  }

  const page1 = (
    <>
      <CustomerField label="Customer *" customers={customers} value={customerId} onChange={setCustomerId} />
      <ProjectField projects={projects} value={projectId} onChange={setProjectId} />
      <TextField label="Memo #" value={memoNumber} onChange={setMemoNumber} />
      <ChoiceField label="Status" choices={CREDIT_MEMO_STATUSES} value={status} onChange={setStatus} />
    </>
  )

  const page2 = (
    <>
      <DateField label="Issue Date *" value={issueDate} onChange={setIssueDate} placeholder="Select issue date" />
      <MemoField value={memoText} onChange={setMemoText} />
    </>
  )

  const page3 = <LineItemsField lines={lines} onChange={setLines} />

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Credit Memo" : "New Credit Memo"}
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ResponsiveDialogBody pages={[page1, page2, page3]} />
        <DialogSaveFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={initialData ? "Save Changes" : "Create Credit Memo"}
        />
      </form>
    </ResponsiveDialog>
  )
}
