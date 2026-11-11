"use client"

import { SAGE_FIELD_LABELS } from "@/lib/sage/sage-linked-edit-fields"
import * as React from "react"
import { toast } from "sonner"

import {
  listSageContactChangeProposals,
  reapplySageContactChange,
  reviewSageContactChange,
  type SageContactProposalListItem,
} from "@/app/actions/sage-contact-changes"
import {
  listSageContactLinkCandidates,
  requestSageContactLinkCandidate,
  reviewSageContactLinkCandidate,
  type SageContactLinkCandidate,
} from "@/app/actions/sage-contact-links"
import {
  listSageContactCreateProposals,
  reviewSageContactCreate,
  type SageContactCreateListItem,
} from "@/app/actions/sage-contact-creates"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { StaffSageLinksSection } from "@/components/contacts/staff-sage-links-section"

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
  const [confirmMismatch, setConfirmMismatch] = React.useState<SageContactLinkCandidate | null>(null)

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

  const needsDecision = proposals.filter((proposal) => proposal.state.stage !== "sending")
  const sending = proposals.filter((proposal) => proposal.state.stage === "sending")

  /** Toast for an approval or reapply: sent, checking Sage first, or Sage changed underneath. */
  const announceApproved = (status: string) => {
    if (status === "conflict") toast.warning("Sage changed these fields since the request. See the change for Sage's values.")
    else if (status === "checking_sage") toast.success("Approved. Compass is checking Sage's current values, then sends it.")
    else toast.success("Approved; Sage gets the new values shortly")
  }

  const reapply = async (proposalId: string) => {
    setBusyId(proposalId)
    try {
      const result = await reapplySageContactChange(proposalId)
      if (!result.success) toast.error(result.error)
      else {
        announceApproved(result.status)
        await reload()
      }
    } finally { setBusyId(null) }
  }

  const decide = async (proposalId: string, decision: "approve" | "reject") => {
    setBusyId(proposalId)
    try {
      const result = await reviewSageContactChange(proposalId, decision, notes[proposalId] ?? "")
      if (!result.success) toast.error(result.error)
      else {
        if (decision === "approve") announceApproved(result.status)
        else toast.success("Change rejected")
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

  const decideLink = async (requestId: string, decision: "link" | "reject", confirmDifferentName = false) => {
    setBusyId(requestId)
    try {
      const result = await reviewSageContactLinkCandidate(requestId, decision, "", confirmDifferentName)
      if (!result.success) toast.error(result.error)
      else {
        toast.success(decision === "link" ? "Sage identity linked; fresh read queued" : "Sage candidate rejected")
        await reload()
      }
    } finally { setBusyId(null) }
  }

  const refreshLink = async (candidate: SageContactLinkCandidate) => {
    setBusyId(candidate.id)
    try {
      const result = await requestSageContactLinkCandidate(
        candidate.kind, candidate.entityId, candidate.sageRecordNumber
      )
      if (!result.success) toast.error(result.error)
      else {
        toast.success("Fresh Sage read-back queued")
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
          <DialogDescription>Review exact Sage identities, proposed new people, and contact changes. Every Sage write needs an approval by someone with Sage review access; Settings › Workflows › Sage contact review decides whether that may be the person who asked.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <StaffSageLinksSection open={open} />
          <h3 className="text-sm font-semibold">Sage identity links</h3>
          {links.length === 0 ? <p className="text-sm text-muted-foreground">No Sage identity lookups yet.</p> : null}
          {links.map((candidate) => (
            <section key={candidate.id} className="space-y-2 border-b pb-4">
              <div className="text-sm font-medium">{candidate.directoryName} · {candidate.kind.replaceAll("_", " ")} · {candidate.status}</div>
              <div className="text-xs text-muted-foreground">Requested Sage number {candidate.sageRecordNumber} · {new Date(candidate.requestedAt).toLocaleString()}</div>
              {candidate.errorMessage ? <p className="text-sm text-destructive">{candidate.errorMessage}</p> : null}
              {candidate.status === "awaiting_review" ? (
                <>
                  {candidate.kind === "employee" ? (
                    <div className="space-y-1 text-sm">
                      <p>Compass employee: <strong>{candidate.directoryName}</strong></p>
                      <p>Sage employee #{candidate.sageRecordNumber}: <strong>{candidate.sageIdentityName ?? "Name not returned"}</strong></p>
                      {!candidate.sageIdentityName ? <p className="text-destructive">This lookup cannot be linked without a Sage employee name. Refresh the read-back; if the name is still blank, check the employee record in Sage.</p>
                        : !candidate.employeeNamesMatch ? <p className="text-destructive">Names differ. Confirm the exact Sage employee number and both names before linking.</p> : null}
                    </div>
                  ) : candidate.kind === "client_company" ? <div className="space-y-1 text-sm">
                    <p>Compass client: <strong>{candidate.directoryName}</strong></p>
                    <p>Sage client #{candidate.sageRecordNumber}: <strong>{candidate.sageIdentityName ?? "Name not returned"}</strong></p>
                    {!candidate.sageIdentityName ? <p className="text-destructive">Refresh the Sage read-back to see the exact client name before linking.</p> : null}
                    <p className="text-xs text-muted-foreground">Confirm these are the same legal client. A name match alone is not proof of identity.</p>
                  </div> : <p className="text-xs text-muted-foreground">Compare the exact Sage number and returned contact information with the intended Compass record before linking. Matching names or emails alone are not proof of identity.</p>}
                  {candidate.reviewExpired ? <p className="text-sm text-destructive">This Sage read-back is older than 15 minutes. Refresh it before linking.</p> : null}
                  {candidate.reviewExpired || !candidate.sageRecordId ||
                    ((candidate.kind === "employee" || candidate.kind === "client_company") && !candidate.sageIdentityName) ? (
                    <Button size="sm" variant="outline" onClick={() => void refreshLink(candidate)}
                      disabled={busyId !== null}>Refresh Sage read-back</Button>
                  ) : null}
                  <details className="text-xs text-muted-foreground"><summary>Technical Sage ID</summary><p className="break-all">{candidate.sageRecordId ?? "Unavailable"}</p></details>
                  <dl className="grid gap-1 text-sm">
                    {Object.entries(candidate.fields).map(([field, value]) => (
                      <div key={field} className="grid grid-cols-3 gap-2">
                        <dt className="font-medium">{field}</dt>
                        <dd className="col-span-2 break-words">{value || "(blank)"}</dd>
                      </div>
                    ))}
                  </dl>
                  {canApprove ? <div className="flex gap-2">
                    <Button size="sm" onClick={() => {
                      if (candidate.kind === "employee" && !candidate.employeeNamesMatch) setConfirmMismatch(candidate)
                      else void decideLink(candidate.id, "link")
                    }}
                      disabled={busyId !== null || candidate.reviewExpired ||
                        ((candidate.kind === "employee" || candidate.kind === "client_company") && !candidate.sageIdentityName)}>Link exact Sage record</Button>
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
          <h3 className="text-sm font-semibold">Contact changes</h3>
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contact changes need a decision. Finished changes are in Activity.</p>
          ) : null}
          {sending.length > 0 ? (
            <div className="space-y-1 border-b pb-4 text-xs text-muted-foreground">
              {sending.map((proposal) => (
                <p key={proposal.id}>
                  <span className="font-medium text-foreground">{proposal.entityName ?? proposal.kindLabel}</span> · {proposal.kindLabel} · {proposal.state.label}
                </p>
              ))}
            </div>
          ) : null}
          {needsDecision.map((proposal) => (
            <section key={proposal.id} className="space-y-3 border-b pb-4 last:border-b-0">
              <div className="text-sm font-medium">{proposal.entityName ?? "Unnamed record"} · {proposal.kindLabel} · {proposal.state.label}</div>
              <div className="text-xs text-muted-foreground">Requested {new Date(proposal.requestedAt).toLocaleString()} by {proposal.requestedByName}</div>
              {proposal.problem ? <p className="text-sm text-destructive">{proposal.problem}</p> : null}
              {proposal.reviewNote ? <p className="text-sm text-muted-foreground">Review note: {proposal.reviewNote}</p> : null}
              <dl className="grid gap-1 text-sm">
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <span>Field</span><span>In Sage now</span><span>Requested</span>
                </div>
                {proposal.changes.map((change) => (
                  <div key={change.field} className="grid grid-cols-3 gap-2">
                    <dt className="font-medium">{SAGE_FIELD_LABELS[change.field]}</dt>
                    <dd className="text-muted-foreground break-words">{change.before ?? "(blank)"}</dd>
                    <dd className="break-words">{change.after ?? "(blank)"}</dd>
                  </div>
                ))}
              </dl>
              {proposal.state.stage === "decide" && canApprove ? <Textarea value={notes[proposal.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [proposal.id]: event.target.value }))} placeholder="Review note (optional)" aria-label={`Review note for ${proposal.entityName ?? proposal.kindLabel}`} /> : null}
              {proposal.state.stage === "decide" && canApprove ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void decide(proposal.id, "approve")} disabled={busyId !== null}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => void decide(proposal.id, "reject")} disabled={busyId !== null}>Reject</Button>
                </div>
              ) : proposal.state.stage === "fix" && canApprove ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Reapply sends the requested values over what Sage holds now. Reject {proposal.kind === "employee" ? "closes the request." : "puts Sage's values back in Compass."}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void reapply(proposal.id)} disabled={busyId !== null}>Reapply</Button>
                    <Button size="sm" variant="outline" onClick={() => void decide(proposal.id, "reject")} disabled={busyId !== null}>Reject</Button>
                  </div>
                </div>
              ) : <p className="text-xs text-muted-foreground">View-only review access.</p>}
            </section>
          ))}
        </div>
        <AlertDialog open={confirmMismatch !== null} onOpenChange={(nextOpen) => { if (!nextOpen) setConfirmMismatch(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm different employee names</AlertDialogTitle>
              <AlertDialogDescription>
                Compass: {confirmMismatch?.directoryName}. Sage employee #{confirmMismatch?.sageRecordNumber}: {confirmMismatch?.sageIdentityName}.
                Confirm these are the same person before linking. This decision is recorded.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={busyId !== null} onClick={() => {
                const candidate = confirmMismatch
                setConfirmMismatch(null)
                if (candidate) void decideLink(candidate.id, "link", true)
              }}>Confirm exact employee</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
