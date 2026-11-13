"use client"

/*
 * Replacing a selection that doesn't change in place: "Replace installed
 * item", "Owner changed selection after approval", "Owner changed selection
 * after purchase" and "Supplier couldn't fill". Staff pick the different
 * product from the selection's other choices (required to replace an
 * installed item) and say why. The selection stays on record as it is; a new
 * selection replaces it, and the job's project manager gets a to-do to write
 * its change order on the change-order screens.
 */
import * as React from "react"
import Link from "next/link"

import { ownerChangedSelectionAfterApproval, ownerChangedSelectionAfterPurchase, replaceInstalledSelection, supplierCouldntFillSelection } from "@/app/actions/selection-replacements"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type { SelectionChoiceView } from "@/lib/domain/selections/choices-read"
import { formatCents } from "@/lib/format"

// The radio value for "no new product yet" (choice ids are UUIDs).
const NOT_CHOSEN = "not-chosen"

export type SelectionReplaceKind = "installed" | "approved" | "ordered" | "unfilled"

const COPY: Readonly<Record<SelectionReplaceKind, { readonly title: string; readonly action: string; readonly pickLabel: string }>> = {
  installed: {
    title: "Replace installed item",
    action: "Replace installed item",
    pickLabel: "Replacement product",
  },
  approved: {
    title: "Owner changed selection after approval",
    action: "Make a new selection",
    pickLabel: "Owner's new choice (optional)",
  },
  ordered: {
    title: "Owner changed selection after purchase",
    action: "Make a new selection",
    pickLabel: "Owner's new choice (optional)",
  },
  unfilled: {
    title: "Supplier couldn't fill the order",
    action: "Make a new selection",
    pickLabel: "New product (optional)",
  },
}

export function SelectionReplaceDialog({
  projectId,
  selectionId,
  selectionName,
  kind,
  choices,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly projectId: string
  readonly selectionId: string
  readonly selectionName: string
  readonly kind: SelectionReplaceKind
  /** The selection's choices; the current pick can't be chosen again. */
  readonly choices: readonly SelectionChoiceView[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSaved: () => void
}): React.ReactElement {
  const [choiceId, setChoiceId] = React.useState<string | null>(null)
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<{ readonly todoId: string | null; readonly todoWarning: string | null } | null>(null)
  const [pending, startTransition] = React.useTransition()
  const formId = React.useId()
  const others = choices.filter((choice) => !choice.chosen)
  const copy = COPY[kind]

  React.useEffect(() => {
    if (open) {
      setChoiceId(null)
      setNote("")
      setError(null)
      setDone(null)
    }
  }, [open])

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    if (kind === "installed" && !choiceId) {
      setError("Choose the different product that replaces the installed item.")
      return
    }
    setError(null)
    startTransition(async () => {
      const trimmed = note.trim() || null
      const result =
        kind === "installed" && choiceId
          ? await replaceInstalledSelection(projectId, selectionId, choiceId, trimmed)
          : kind === "unfilled"
            ? await supplierCouldntFillSelection(projectId, selectionId, choiceId, trimmed)
            : kind === "approved"
              ? await ownerChangedSelectionAfterApproval(projectId, selectionId, choiceId, trimmed)
              : await ownerChangedSelectionAfterPurchase(projectId, selectionId, choiceId, trimmed)
      if (!result.success) {
        setError(result.error)
        return
      }
      setDone(result.data)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {selectionName} stays on record exactly as it is. A new selection replaces it
            {kind === "installed" ? " with the product you choose" : kind === "unfilled" ? " with a product that can be supplied" : ", for the owner's new choice"}, and the job&apos;s project manager gets a to-do to write its change order on the change-order screens.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>The new selection was made.</p>
            {done.todoId ? (
              <Link className="text-primary underline" href={`/dashboard/projects/${encodeURIComponent(projectId)}/todos?item=${encodeURIComponent(done.todoId)}`}>
                Open the to-do to write its change order
              </Link>
            ) : null}
            {done.todoWarning ? <p className="text-destructive">{done.todoWarning}</p> : null}
          </div>
        ) : (
          <form id={formId} onSubmit={submit} className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">{copy.pickLabel}</legend>
              {others.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {kind === "installed"
                    ? "Add the replacement product as a choice on this selection first."
                    : "No other choices yet. The owner's new choice can be added to the new selection."}
                </p>
              ) : (
                <RadioGroup value={choiceId ?? NOT_CHOSEN} onValueChange={(value) => setChoiceId(value === NOT_CHOSEN ? null : value)}>
                  {others.map((choice) => (
                    <div key={choice.id} className="flex items-center gap-2 text-sm">
                      <RadioGroupItem id={`${formId}-${choice.id}`} value={choice.id} />
                      <Label htmlFor={`${formId}-${choice.id}`} className="min-w-0 truncate font-normal">
                        {choice.title}
                      </Label>
                      {choice.ownerPriceCents !== null && <span className="text-muted-foreground">{formatCents(choice.ownerPriceCents)}</span>}
                    </div>
                  ))}
                  {kind !== "installed" && (
                    <div className="flex items-center gap-2 text-sm">
                      <RadioGroupItem id={`${formId}-none`} value={NOT_CHOSEN} />
                      <Label htmlFor={`${formId}-none`} className="font-normal text-muted-foreground">
                        Not chosen yet
                      </Label>
                    </div>
                  )}
                </RadioGroup>
              )}
            </fieldset>
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-note`}>Why</Label>
              <Textarea id={`${formId}-note`} value={note} maxLength={500} rows={3} onChange={(event) => setNote(event.target.value)} placeholder={kind === "installed" ? "e.g. damaged during install" : "e.g. owner prefers the brushed finish"} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done && (
            <Button type="submit" form={formId} disabled={pending || (kind === "installed" && others.length === 0)}>
              {copy.action}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
