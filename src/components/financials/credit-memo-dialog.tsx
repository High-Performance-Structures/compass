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
import type { CreditMemo } from "@/db/schema-netsuite"
import type { Customer, Project } from "@/db/schema"

const CREDIT_MEMO_STATUSES = ["draft", "applied", "void"] as const

interface CreditMemoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: CreditMemo | null
  customers: Customer[]
  projects: Project[]
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
        initialData.lineItems ? JSON.parse(initialData.lineItems) : []
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

  const total = lines.reduce((s, l) => s + l.amount, 0)
  const amountApplied = initialData?.amountApplied ?? 0
  const amountRemaining = total - amountApplied

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
      <div className="space-y-1.5">
        <Label className="text-xs">Customer *</Label>
        <Select value={customerId} onValueChange={setCustomerId}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Select customer" />
          </SelectTrigger>
          <SelectContent>
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
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
        <Label className="text-xs">Memo #</Label>
        <Input
          className="h-9"
          value={memoNumber}
          onChange={(e) => setMemoNumber(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CREDIT_MEMO_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
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
        <Label className="text-xs">Issue Date *</Label>
        <DatePicker
          value={issueDate}
          onChange={setIssueDate}
          placeholder="Select issue date"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Memo</Label>
        <Textarea
          value={memoText}
          onChange={(e) => setMemoText(e.target.value)}
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

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Credit Memo" : "New Credit Memo"}
      className="max-w-2xl"
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
            {initialData ? "Save Changes" : "Create Credit Memo"}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </ResponsiveDialog>
  )
}
