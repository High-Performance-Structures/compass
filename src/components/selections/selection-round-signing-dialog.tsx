"use client"

/*
 * A Selection Phase's owner signature (a "round" in code), from its card: the
 * totals and what the difference becomes (change order or variance), Print Selection Phase, the owners to
 * sign (the shared recipient picker, limited to the job's owner contacts),
 * and the round's signatures so far. Sending prepares the Foxit envelope
 * and opens Foxit to review and send it; Foxit emails the signers.
 */
import * as React from "react"

import { getRoundSigning, sendRoundForSignature } from "@/app/actions/selection-round-signing"
import { EmailRecipientPicker } from "@/components/email/email-recipient-picker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { RoundSigningView } from "@/lib/domain/selections/round-signing"
import { formatCents, formatDate } from "@/lib/format"
import { printPreviewHref } from "@/lib/print/print-documents"

const STATUS_LABELS = { preparing: "Not sent yet", sent: "Out for signature", signed: "Signed", declined: "Declined", cancelled: "Cancelled" } as const

export function SelectionRoundSigningDialog({
  projectId,
  roundKey,
  roundName,
  open,
  onOpenChange,
}: {
  readonly projectId: string
  readonly roundKey: string
  readonly roundName: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const [view, setView] = React.useState<RoundSigningView | null>(null)
  const [signers, setSigners] = React.useState<readonly string[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setView(null)
    void getRoundSigning(projectId, roundKey).then((result) => {
      if (!result.success) {
        setError(result.error)
        return
      }
      setView(result.data)
      setSigners(result.data.ownerContacts.slice(0, 1).map((contact) => contact.email))
    })
  }, [open, projectId, roundKey])

  function send(): void {
    setError(null)
    startTransition(async () => {
      const result = await sendRoundForSignature(projectId, roundKey, signers)
      if (!result.success) {
        setError(result.error)
        return
      }
      window.open(result.data.embeddedSessionUrl, "_blank", "noopener")
      onOpenChange(false)
    })
  }

  const doc = view?.document ?? null
  const outForSignature = view?.signatures.some((signature) => signature.status === "sent") ?? false
  const printHref = printPreviewHref({ projectId, document: "selections-round", params: { round: roundKey }, number: `${roundName} Selection Phase` })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{roundName} Selection Phase: owner signature</DialogTitle>
          <DialogDescription>
            The owner signs one document listing each selection with its photo, link and price, the total against the allowance, and the change order or
            variance for the difference.
          </DialogDescription>
        </DialogHeader>
        {!view || !doc ? (
          <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border p-3 text-sm">
              <p>
                {doc.toSign.length} selection{doc.toSign.length === 1 ? "" : "s"} to sign · allowance {formatCents(doc.allowanceCents)} · selections{" "}
                {formatCents(doc.ownerTotalCents)}
              </p>
              <p className="font-semibold">
                {doc.deltaCents === 0
                  ? "On allowance"
                  : `${formatCents(Math.abs(doc.deltaCents))} ${doc.deltaCents > 0 ? "over" : "under"} the allowance`}
                {doc.treatment !== "none" &&
                  ` → ${doc.treatment === "change_order" ? "change order" : "variance"}${doc.deltaPercent !== null ? ` (${doc.deltaPercent.toFixed(1)}%; ${view.contractKind === "fixed_price" ? "fixed price" : `threshold ${view.thresholdPercent}%`})` : ""}`}
              </p>
              {doc.lines.some((line) => line.signedEarlier) && (
                <p className="text-xs text-muted-foreground">
                  {doc.lines.filter((line) => line.signedEarlier).length} already signed; only changed or new picks are signed again.
                </p>
              )}
            </div>
            {doc.blocker && <p className="text-sm text-destructive">{doc.blocker}</p>}

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={printHref} target="_blank" rel="noopener noreferrer">
                  Print Selection Phase
                </a>
              </Button>
            </div>

            {view.ownerContacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add the owner with an email address to the job&apos;s contacts to send for signature.</p>
            ) : (
              <EmailRecipientPicker
                id={`round-signers-${roundKey}`}
                label="Owners to sign"
                options={view.ownerContacts.map((contact) => ({
                  id: contact.email,
                  email: contact.email,
                  displayName: contact.name,
                  companyName: null,
                  category: "client",
                  recommended: true,
                }))}
                value={signers}
                onChange={setSigners}
                placeholder="Choose the job's owner contacts…"
                required
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={pending || Boolean(doc.blocker) || signers.length === 0 || outForSignature} onClick={send}>
                {pending ? "Preparing…" : "Send for signature"}
              </Button>
              {outForSignature && <span className="text-xs text-muted-foreground">Out for signature now; cancel it in Foxit to send a new one.</span>}
            </div>

            {view.signatures.length > 0 && (
              <ul className="flex flex-col gap-1 border-t pt-3 text-sm">
                {view.signatures.map((signature) => (
                  <li key={signature.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <Badge variant={signature.status === "signed" ? "default" : "outline"}>{STATUS_LABELS[signature.status]}</Badge>{" "}
                      {formatDate(signature.signedAt ?? signature.sentAt ?? signature.createdAt)} · {signature.itemCount} item{signature.itemCount === 1 ? "" : "s"}
                      {signature.changeOrderNumber && ` · ${signature.changeOrderNumber}`}
                    </span>
                    {signature.signedDocumentHref ? (
                      <a href={signature.signedDocumentHref} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        Signed PDF
                      </a>
                    ) : signature.foxitSessionUrl ? (
                      <a href={signature.foxitSessionUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        Open in Foxit
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
