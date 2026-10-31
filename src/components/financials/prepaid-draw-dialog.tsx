"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  markImportedDrawPaidBeforeCompass,
  undoImportedDrawPaidBeforeCompass,
} from "@/app/actions/received-payments"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ReceivableRow } from "@/lib/domain/financials/receivables"
import { PREPAID_NOTE_MAX, VOID_REASON_MAX } from "@/lib/domain/financials/rules"

/*
 * Marks an imported draw "Paid before Compass" (settled outside Compass, no
 * payment details), or undoes that mark with a reason. Both need the
 * financials update permission, like voiding a payment.
 */

export type PrepaidDrawTarget = { readonly mode: "mark" | "undo"; readonly item: ReceivableRow }

export function PrepaidDrawDialog({
  projectId,
  target,
  onClose,
  onMessage,
}: {
  readonly projectId: string
  readonly target: PrepaidDrawTarget | null
  readonly onClose: () => void
  readonly onMessage: (message: string) => void
}): React.ReactElement {
  const router = useRouter()
  const [text, setText] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  const undo = target?.mode === "undo"

  React.useEffect(() => {
    setText("")
  }, [target])

  function confirm(): void {
    if (!target) return
    const { item, mode } = target
    startTransition(async () => {
      const result = mode === "mark"
        ? await markImportedDrawPaidBeforeCompass(projectId, item.id, text)
        : await undoImportedDrawPaidBeforeCompass(projectId, item.id, text)
      if (!result.success) {
        onMessage(result.error)
        return
      }
      onMessage(mode === "mark" ? `${item.label} marked paid before Compass.` : `${item.label} is no longer marked paid before Compass.`)
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {undo ? `Undo paid before Compass on ${target?.item.label ?? ""}?` : `Mark ${target?.item.label ?? ""} paid before Compass?`}
          </DialogTitle>
          <DialogDescription>
            {undo
              ? "Its paid status goes back to unconfirmed, and the owner no longer sees it as paid. The mark stays on record."
              : "Use this when the draw was paid outside Compass. It shows as paid to staff and the owner, with no payment details. Nothing is entered in Sage."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="prepaid-draw-text">{undo ? "Reason" : "Note (optional)"}</Label>
          <Textarea
            id="prepaid-draw-text"
            rows={3}
            maxLength={undo ? VOID_REASON_MAX : PREPAID_NOTE_MAX}
            placeholder={undo ? "Marked by mistake, payment found…" : "Paid by check in 2025, per Sage…"}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={confirm} disabled={pending || (undo && text.trim() === "")}>
            {undo ? "Undo mark" : "Mark paid before Compass"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
