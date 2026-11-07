"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  recordDepositOnImportedDraw,
  removeDepositFromImportedDraw,
  type ImportedDrawDepositItem,
} from "@/app/actions/project-contract-deposits"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { IMPORTED_DEPOSIT_NOTE_MAX, IMPORTED_DEPOSIT_REASON_MAX } from "@/lib/financials/contract-deposits"
import { formatCents } from "@/lib/format"

/*
 * Records that a received deposit was already applied on an imported draw
 * (billed before Compass), so Compass does not apply it again on the next
 * draft; or removes that record with a reason.
 */

export type ImportedDrawDepositTarget =
  | { readonly mode: "record" }
  | { readonly mode: "remove"; readonly draw: ImportedDrawDepositItem }

function drawOptionLabel(draw: ImportedDrawDepositItem): string {
  return [draw.label, draw.periodTo ? `period to ${draw.periodTo}` : null, draw.sourceLabel].filter(Boolean).join(" · ")
}

export function ImportedDrawDepositDialog({
  projectId,
  target,
  draws,
  recordableCents,
  onClose,
}: {
  readonly projectId: string
  readonly target: ImportedDrawDepositTarget | null
  readonly draws: readonly ImportedDrawDepositItem[]
  readonly recordableCents: number
  readonly onClose: () => void
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const choices = draws.filter((draw) => draw.depositAppliedCents === 0)
  const [drawId, setDrawId] = useState(choices[0]?.id ?? "")
  const [text, setText] = useState("")
  const remove = target?.mode === "remove"

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!target) return
    const raw = String(new FormData(event.currentTarget).get("amount") ?? "").replaceAll(/[$,]/g, "").trim()
    startTransition(async () => {
      const result =
        target.mode === "remove"
          ? await removeDepositFromImportedDraw(projectId, target.draw.id, text)
          : await recordDepositOnImportedDraw(projectId, drawId, { amount: raw ? Number(raw) : null, note: text })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(target.mode === "remove" ? "Deposit removed from the imported draw." : "Deposit recorded on the imported draw.")
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {target?.mode === "remove" ? `Remove the deposit from ${target.draw.label}?` : "Deposit applied on an imported draw"}
          </DialogTitle>
          <DialogDescription>
            {remove
              ? "The deposit becomes available again, and draft pay applications that apply deposits automatically may take it. This is kept in Activity."
              : "Use this when a deposit received was already applied on a draw billed before Compass. Compass counts it as applied and won't apply it again on the next pay application. Nothing changes in Sage."}
          </DialogDescription>
        </DialogHeader>
        <form id="imported-draw-deposit-form" onSubmit={submit} className="grid gap-4">
          {!remove && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="importedDraw">Applied on imported draw</Label>
                <Select value={drawId} onValueChange={setDrawId}>
                  <SelectTrigger id="importedDraw"><SelectValue placeholder="Choose the draw" /></SelectTrigger>
                  <SelectContent>
                    {choices.map((draw) => (
                      <SelectItem key={draw.id} value={draw.id}>{drawOptionLabel(draw)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="importedDepositAmount">Deposit applied</Label>
                <Input
                  id="importedDepositAmount"
                  name="amount"
                  inputMode="decimal"
                  defaultValue={recordableCents > 0 ? (recordableCents / 100).toFixed(2) : ""}
                />
                <p className="text-xs text-muted-foreground">
                  {formatCents(recordableCents)} of received deposit is not yet applied on a billed draw.
                </p>
              </div>
            </>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="importedDepositText">{remove ? "Reason" : "Note (optional)"}</Label>
            <Textarea
              id="importedDepositText"
              rows={3}
              maxLength={remove ? IMPORTED_DEPOSIT_REASON_MAX : IMPORTED_DEPOSIT_NOTE_MAX}
              placeholder={remove ? "Recorded on the wrong draw…" : "Deposit shown on the G702 for this draw…"}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button
            type="submit"
            form="imported-draw-deposit-form"
            disabled={pending || (remove ? text.trim() === "" : drawId === "")}
          >
            {pending ? "Saving…" : remove ? "Remove deposit" : "Record as applied"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
