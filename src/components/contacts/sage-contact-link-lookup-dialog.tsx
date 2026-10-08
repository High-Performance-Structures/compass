"use client"

import * as React from "react"
import { toast } from "sonner"

import { requestSageContactLinkCandidate } from "@/app/actions/sage-contact-links"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SageContactKind } from "@/lib/sage/contact-change-proposal"

export type SageContactLinkLookupTarget = {
  readonly kind: SageContactKind
  readonly entityId: string
  readonly name: string
  readonly sageRecordNumber: string | null
}

export function SageContactLinkLookupDialog({
  target,
  onOpenChange,
  onRequested,
}: {
  readonly target: SageContactLinkLookupTarget | null
  readonly onOpenChange: (open: boolean) => void
  readonly onRequested: () => void
}): React.ReactElement {
  const [number, setNumber] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => { setNumber(target?.sageRecordNumber ?? "") }, [target])

  const request = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!target) return
    setBusy(true)
    try {
      const result = await requestSageContactLinkCandidate(target.kind, target.entityId, number)
      if (!result.success) { toast.error(result.error); return }
      toast.success(result.disposition === "existing"
        ? result.status === "awaiting_review"
          ? "This Sage read-back is already awaiting review"
          : "A lookup for this Sage number is already in progress"
        : result.disposition === "refreshed"
          ? "Fresh Sage read-back queued"
          : "Exact Sage lookup queued for review")
      onOpenChange(false)
      onRequested()
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify Sage link</DialogTitle>
          <DialogDescription>
            Look up the exact Sage number for {target?.name}. This does not link or overwrite the Compass contact. An authorized reviewer must compare the Sage read-back and approve the link.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void request(event)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sage-link-number">
              {target?.kind === "client_person" || target?.kind === "vendor_person" ? "Sage contact line number" : "Sage record number"}
            </Label>
            <Input id="sage-link-number" inputMode="numeric" pattern="[1-9][0-9]*" value={number}
              onChange={(event) => setNumber(event.target.value)} required disabled={busy} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>Look up in Sage</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
