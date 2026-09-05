"use client"

import * as React from "react"
import { IconCheck, IconFileImport } from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import {
  approveProjectRfqBid,
  importApprovedProjectRfqBid,
  type ProjectRfqBidWorkflowItem,
} from "@/app/actions/project-rfq-bids"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

export function ProjectRfqBidActions({
  projectId,
  rfqId,
  rfqLabel,
  canApprove,
  canImport,
  workflow,
  editableEstimates,
}: {
  readonly projectId: string
  readonly rfqId: string
  readonly rfqLabel: string
  readonly canApprove: boolean
  readonly canImport: boolean
  readonly workflow: ProjectRfqBidWorkflowItem | null
  readonly editableEstimates: readonly {
    readonly id: string
    readonly label: string
  }[]
}): React.ReactElement {
  const router = useRouter()
  const [approvalOpen, setApprovalOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [approvalNote, setApprovalNote] = React.useState("")
  const [estimateId, setEstimateId] = React.useState(
    editableEstimates[0]?.id ?? ""
  )
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function approve(): void {
    setError(null)
    startTransition(async () => {
      const result = await approveProjectRfqBid(
        projectId,
        rfqId,
        approvalNote
      )
      if (!result.success) {
        setError(result.error)
        return
      }
      setApprovalOpen(false)
      router.refresh()
    })
  }

  function importBid(): void {
    if (!workflow || !estimateId) return
    setError(null)
    startTransition(async () => {
      const result = await importApprovedProjectRfqBid(
        projectId,
        workflow.approval.id,
        estimateId
      )
      if (!result.success) {
        setError(result.error)
        return
      }
      setImportOpen(false)
      router.refresh()
    })
  }

  if (!workflow) {
    return (
      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="sm" disabled={!canApprove}>
            <IconCheck className="size-4" />
            Approve bid
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve {rfqLabel} bid</DialogTitle>
            <DialogDescription>
              This snapshots the submitted pricing and closes this bidder copy.
              Approval is required before estimate import.
            </DialogDescription>
          </DialogHeader>
          <label className="mt-5 grid gap-1.5 text-sm font-medium">
            Approval note
            <Textarea
              value={approvalNote}
              onChange={(event) => setApprovalNote(event.currentTarget.value)}
              maxLength={4_000}
              placeholder="Selection rationale, qualifications, or follow-up items"
            />
          </label>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => setApprovalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={approve} disabled={pending}>
              {pending ? "Approving..." : "Confirm approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <div className="mt-3 border-l-2 border-brand-hps-primary px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            Approved bid · {money(workflow.approval.amountCents)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {workflow.approval.approvedByName} ·{" "}
            {new Date(workflow.approval.approvedAt).toLocaleString("en-US")}
          </p>
        </div>
        {!workflow.estimateImport && (
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                disabled={!canImport || editableEstimates.length === 0}
              >
                <IconFileImport className="size-4" />
                Import to estimate
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Import approved bid</DialogTitle>
                <DialogDescription>
                  Each priced RFQ scope row becomes a new estimate line. Imported
                  lines start internal-only with zero markup, zero tax, and no
                  builder fee until reviewed.
                </DialogDescription>
              </DialogHeader>
              <label className="mt-5 grid gap-1.5 text-sm font-medium">
                Draft estimate
                <Select value={estimateId} onValueChange={setEstimateId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose an editable estimate" />
                  </SelectTrigger>
                  <SelectContent>
                    {editableEstimates.map((estimate) => (
                      <SelectItem key={estimate.id} value={estimate.id}>
                        {estimate.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
              <DialogFooter className="mt-5">
                <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={importBid}
                  disabled={pending || !estimateId}
                >
                  {pending ? "Importing..." : "Import approved pricing"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {workflow.approval.approvalNote && (
        <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
          {workflow.approval.approvalNote}
        </p>
      )}
      {workflow.estimateImport && (
        <p className="mt-2 text-xs text-muted-foreground">
          Imported {workflow.estimateImport.lineCount} estimate{" "}
          {workflow.estimateImport.lineCount === 1 ? "line" : "lines"} into{" "}
          {workflow.estimateImport.estimateLabel} by{" "}
          {workflow.estimateImport.importedByName}.
        </p>
      )}
    </div>
  )
}
