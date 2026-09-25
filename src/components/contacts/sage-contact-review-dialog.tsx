"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  listSageContactChangeProposals,
  reviewSageContactChange,
  type SageContactProposalListItem,
} from "@/app/actions/sage-contact-changes"
import {
  listSageContactLinkCandidates,
  reviewSageContactLinkCandidate,
  type SageContactLinkCandidate,
} from "@/app/actions/sage-contact-links"
import {
  listSageContactCreateProposals,
  reviewSageContactCreate,
  type SageContactCreateListItem,
} from "@/app/actions/sage-contact-creates"
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
  canCreateSagePeople,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly canApprove: boolean
  readonly canCreateSagePeople: boolean
}): React.ReactElement {
  const [proposals, setProposals] = React.useState<readonly SageContactProposalListItem[]>([])
  const [links, setLinks] = React.useState<readonly SageContactLinkCandidate[]>([])
  const [creates, setCreates] = React.useState<readonly SageContactCreateListItem[]>([])
  const [notes, setNotes] = React.useState<Readonly<Record<string, string>>>({})
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    try {
      const [nextProposals, nextLinks, nextCreates] = await Promise.all([
        listSageContactChangeProposals(), listSageContactLinkCandidates(), listSageContactCreateProposals(),
      ])
      setProposals(nextProposals)
      setLinks(nextLinks)
      setCreates(nextCreates)
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

  const decideLink = async (requestId: string, decision: "link" | "reject") => {
    setBusyId(requestId)
    try {
      const result = await reviewSageContactLinkCandidate(requestId, decision, notes[requestId] ?? "")
      if (!result.success) toast.error(result.error)
      else {
        toast.success(decision === "link" ? "Sage identity linked; fresh read queued" : "Sage candidate rejected")
        setNotes((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
        await reload()
      }
    } finally { setBusyId(null) }
  }

  const decideCreate = async (proposalId: string, decision: "approve" | "reject") => {
    setBusyId(proposalId)
    try {
      const result = await reviewSageContactCreate(proposalId, decision, notes[proposalId] ?? "")
      if (!result.success) toast.error(result.error)
      else {
        toast.success(decision === "approve" ? "New Sage person approved" : "New Sage person rejected")
        await reload()
      }
    } finally { setBusyId(null) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sage contact review</DialogTitle>
          <DialogDescription>Review exact Sage identities, proposed new people, and contact changes. Every Sage write requires an independent decision.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Sage identity links</h3>
          {links.length === 0 ? <p className="text-sm text-muted-foreground">No Sage identity lookups yet.</p> : null}
          {links.map((candidate) => (
            <section key={candidate.id} className="space-y-2 border-b pb-4">
              <div className="text-sm font-medium">{candidate.directoryName} · {candidate.kind.replaceAll("_", " ")} · {candidate.status}</div>
              <div className="text-xs text-muted-foreground">Requested Sage number {candidate.sageRecordNumber} · {new Date(candidate.requestedAt).toLocaleString()}</div>
              {candidate.errorMessage ? <p className="text-sm text-destructive">{candidate.errorMessage}</p> : null}
              {candidate.status === "awaiting_review" ? (
                <>
                  <p className="text-xs text-muted-foreground">Compare this exact Sage number, record ID, and contact information with the intended Compass record before linking. Matching names or emails alone are not proof of identity.</p>
                  <p className="break-all text-xs">Sage ID: {candidate.sageRecordId ?? "Unavailable"}</p>
                  <dl className="grid gap-1 text-sm">
                    {Object.entries(candidate.fields).map(([field, value]) => (
                      <div key={field} className="grid grid-cols-3 gap-2">
                        <dt className="font-medium">{field}</dt>
                        <dd className="col-span-2 break-words">{value || "(blank)"}</dd>
                      </div>
                    ))}
                  </dl>
                  {canApprove ? <Textarea value={notes[candidate.id] ?? ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [candidate.id]: event.target.value }))}
                    placeholder="Review note (optional)" aria-label={`Review note for ${candidate.directoryName}`} /> : null}
                  {canApprove ? <div className="flex gap-2">
                    <Button size="sm" onClick={() => void decideLink(candidate.id, "link")} disabled={busyId !== null}>Link exact Sage record</Button>
                    <Button size="sm" variant="outline" onClick={() => void decideLink(candidate.id, "reject")} disabled={busyId !== null}>Reject</Button>
                  </div> : <p className="text-xs text-muted-foreground">View-only review access.</p>}
                </>
              ) : null}
            </section>
          ))}
          {canCreateSagePeople || creates.length > 0 ? <h3 className="text-sm font-semibold">New Sage people</h3> : null}
          {canCreateSagePeople && creates.length === 0 ? <p className="text-sm text-muted-foreground">No new person proposals yet.</p> : null}
          {creates.map((proposal) => <section key={proposal.id} className="space-y-2 border-b pb-4">
            <div className="text-sm font-medium">{proposal.fields.name} · {proposal.companyName} · {proposal.status}</div>
            <div className="text-xs text-muted-foreground">{proposal.kind.replaceAll("_", " ")} · Requested {new Date(proposal.requestedAt).toLocaleString()}</div>
            {proposal.errorMessage ? <p className="text-sm text-destructive">{proposal.errorMessage}</p> : null}
            <dl className="grid gap-1 text-sm">{Object.entries(proposal.fields).map(([field, value]) => <div key={field} className="grid grid-cols-3 gap-2"><dt className="font-medium">{field}</dt><dd className="col-span-2 break-words">{value || "(blank)"}</dd></div>)}</dl>
            {proposal.status === "needs_reconciliation" ? <p className="text-xs text-destructive">Sage Add may have committed. Inspect the exact parent in Sage before any further addition; this will not retry automatically.</p> : null}
            {proposal.status === "pending" && canApprove ? <>
              <Textarea value={notes[proposal.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [proposal.id]: event.target.value }))} placeholder="Review note (optional)" aria-label={`Review note for ${proposal.fields.name}`} />
              <div className="flex gap-2"><Button size="sm" onClick={() => void decideCreate(proposal.id, "approve")} disabled={busyId !== null || !canCreateSagePeople}>Approve Add</Button><Button size="sm" variant="outline" onClick={() => void decideCreate(proposal.id, "reject")} disabled={busyId !== null}>Reject</Button></div>
            </> : null}
          </section>)}
          <h3 className="text-sm font-semibold">Contact change proposals</h3>
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
