"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  decideSageAddRequest,
  listSageAddRequests,
  withdrawSageAddRequest,
  type SageAddRequestListItem,
} from "@/app/actions/sage-directory-adds"
import { SageAddDuplicateList } from "@/components/contacts/sage-add-duplicate-list"
import { SageNumberBadge } from "@/components/sage-number-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/format"

/**
 * Contacts → Sage requests: what staff asked to add to Sage. The company's
 * approver (Settings > Workflows > Adding to Sage) compares each with the
 * look-alikes Compass found and approves or rejects it; the requester or the
 * approver can withdraw one that hasn't gone to Sage.
 */
export function SageAddRequestsDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onChanged: () => void
}): React.ReactElement {
  const [rows, setRows] = React.useState<readonly SageAddRequestListItem[] | null>(null)
  const [canDecide, setCanDecide] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState<Readonly<Record<string, string>>>({})
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    const result = await listSageAddRequests()
    if (!result.success) { setError(result.error); return }
    setError(null)
    setRows(result.data.rows)
    setCanDecide(result.data.canDecide)
  }, [])

  React.useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function decide(row: SageAddRequestListItem, decision: "approve" | "reject"): Promise<void> {
    setBusyId(row.id)
    try {
      const result = await decideSageAddRequest(row.id, decision, notes[row.id] ?? "")
      if (!result.success) { toast.error(result.error); return }
      toast.success(decision === "approve" ? result.data.notice ?? `Approved. ${row.name} goes to Sage.` : "Not approved. The requester was told.")
      await load()
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  async function withdraw(row: SageAddRequestListItem): Promise<void> {
    setBusyId(row.id)
    try {
      const result = await withdrawSageAddRequest(row.id)
      if (!result.success) { toast.error(result.error); return }
      toast.success("Request withdrawn.")
      await load()
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  const open_ = rows?.filter((row) => row.status === "pending" || row.status === "approved" || row.status === "sent") ?? []
  const done = rows?.filter((row) => !open_.includes(row)) ?? []

  function renderRow(row: SageAddRequestListItem): React.ReactElement {
    return (
      <li key={row.id} className="space-y-2 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="font-medium">{row.name}</div>
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Badge variant="outline">{row.kindLabel}</Badge>
              <span>{row.statusLabel}</span>
              <SageNumberBadge number={row.sageRecordNumber} />
            </div>
            <div className="text-xs text-muted-foreground">
              Asked by {row.requestedByName ?? "someone"} on {formatDate(row.requestedAt)}
              {row.reviewedByName ? ` · decided by ${row.reviewedByName}` : ""}
              {row.reviewNote ? `: ${row.reviewNote}` : ""}
            </div>
            {row.errorMessage ? <p className="text-xs text-destructive">{row.errorMessage}</p> : null}
          </div>
          {row.canWithdraw && !row.canDecide ? (
            <Button type="button" size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => void withdraw(row)}>Withdraw</Button>
          ) : null}
        </div>
        {row.details.length > 0 ? (
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            {row.details.map((detail) => (
              <div key={detail.label} className="flex gap-2"><dt className="text-muted-foreground">{detail.label}</dt><dd>{detail.value}</dd></div>
            ))}
          </dl>
        ) : null}
        {row.status === "pending" ? (
          row.duplicates.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Look-alikes Compass found. Compare before approving:</p>
              <SageAddDuplicateList matches={row.duplicates} />
            </div>
          ) : <p className="text-xs text-muted-foreground">No look-alikes found in Compass or Sage.</p>
        ) : null}
        {row.canDecide ? (
          <div className="space-y-2">
            <Textarea placeholder="Note for the requester (optional)" value={notes[row.id] ?? ""} rows={2}
              onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busyId === row.id} onClick={() => void decide(row, "approve")}>Approve and send to Sage</Button>
              <Button type="button" size="sm" variant="outline" disabled={busyId === row.id} onClick={() => void decide(row, "reject")}>Don&apos;t add</Button>
              {row.canWithdraw ? <Button type="button" size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => void withdraw(row)}>Withdraw</Button> : null}
            </div>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sage requests</DialogTitle>
          <DialogDescription>
            New vendors, clients and contacts staff asked to add to Sage.
            {canDecide ? " You decide these." : " Your company's Sage approver decides these."}
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {rows === null && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {rows !== null ? (
          <div className="space-y-4">
            {open_.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting.</p> : <ul className="divide-y rounded-lg border">{open_.map(renderRow)}</ul>}
            {done.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Last 30 days</h3>
                <ul className="divide-y rounded-lg border">{done.map(renderRow)}</ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
