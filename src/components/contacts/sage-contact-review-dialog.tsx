"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  listSageContactChangeProposals,
  reviewSageContactChange,
  type SageContactProposalListItem,
} from "@/app/actions/sage-contact-changes"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

export function SageContactReviewDialog({
  open,
  onOpenChange,
  canApprove,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly canApprove: boolean
}): React.ReactElement {
  const [proposals, setProposals] = React.useState<readonly SageContactProposalListItem[]>([])
  const [notes, setNotes] = React.useState<Readonly<Record<string, string>>>({})
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    try {
      setProposals(await listSageContactChangeProposals())
    } catch {
      toast.error("Could not load Sage contact proposals")
    }
  }, [])
  React.useEffect(() => { if (open) void reload() }, [open, reload])

  const decide = async (proposalId: string, decision: "approve" | "reject") => {
    setBusyId(proposalId)
    try {
      const result = await reviewSageContactChange(proposalId, decision, notes[proposalId] ?? "")
      if (!result.success) toast.error(result.error)
      else {
        toast.success(decision === "approve" ? "Approved for Sage processing" : "Proposal rejected")
        setNotes((current) => {
          const next = { ...current }
          delete next[proposalId]
          return next
        })
        await reload()
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sage contact review</DialogTitle>
          <DialogDescription>Approve or reject proposed contact changes. Approved changes are queued for the Sage bridge; they do not update Sage immediately.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contact change proposals yet.</p>
          ) : proposals.map((proposal) => (
            <section key={proposal.id} className="space-y-3 border-b pb-4 last:border-b-0">
              <div className="text-sm font-medium">{proposal.kind.replaceAll("_", " ")} · {proposal.entityId} · {proposal.status}</div>
              <div className="text-xs text-muted-foreground">Requested {new Date(proposal.requestedAt).toLocaleString()} by {proposal.requestedByUserId}</div>
              {proposal.errorMessage ? <p className="text-sm text-destructive">{proposal.errorMessage}</p> : null}
              {proposal.reviewNote ? <p className="text-sm text-muted-foreground">Review note: {proposal.reviewNote}</p> : null}
              <dl className="grid gap-1 text-sm">
                {proposal.changes.map((change) => (
                  <div key={change.field} className="grid grid-cols-3 gap-2">
                    <dt className="font-medium">{change.field}</dt>
                    <dd className="text-muted-foreground break-words">{change.before ?? "(blank)"}</dd>
                    <dd className="break-words">{change.after ?? "(blank)"}</dd>
                  </div>
                ))}
              </dl>
              {proposal.status === "pending" && canApprove ? <Textarea value={notes[proposal.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [proposal.id]: event.target.value }))} placeholder="Review note (optional)" aria-label={`Review note for ${proposal.kind.replaceAll("_", " ")} ${proposal.entityId}`} /> : null}
              {proposal.status === "pending" && canApprove ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void decide(proposal.id, "approve")} disabled={busyId !== null}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => void decide(proposal.id, "reject")} disabled={busyId !== null}>Reject</Button>
                </div>
              ) : proposal.status === "pending" ? <p className="text-xs text-muted-foreground">View-only review access.</p> : null}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
