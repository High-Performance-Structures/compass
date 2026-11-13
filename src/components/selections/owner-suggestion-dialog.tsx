"use client"

/*
 * The owner's "Add my own choice" form (and editing one of their own
 * suggestions until the builder prices it): a name, an optional product
 * link and a note. The link's page fills in the picture; the price stays
 * "Pending staff pricing" until the builder sets it. Also the confirmation
 * before the owner deletes their suggestion.
 */
import * as React from "react"

import { addOwnerSuggestedChoice, updateOwnerSuggestedChoice } from "@/app/actions/selection-owner-choices"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { SelectionChoiceView } from "@/lib/domain/selections/choices-read"
import { OWNER_SUGGESTION_NAME_MAX, OWNER_SUGGESTION_NOTE_MAX } from "@/lib/domain/selections/owner-suggestion-rules"

export function OwnerSuggestionDialog({
  projectId,
  selectionId,
  selectionName,
  choice,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly projectId: string
  readonly selectionId: string
  readonly selectionName: string
  /** The owner's own suggestion being edited; null adds a new one. */
  readonly choice: SelectionChoiceView | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSaved: () => void
}): React.ReactElement {
  const [name, setName] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const formId = React.useId()

  React.useEffect(() => {
    if (!open) return
    setName(choice?.title ?? "")
    setUrl(choice?.links.find((link) => link.addedByAudience === "owner")?.url ?? "")
    setNote(choice?.description ?? "")
    setError(null)
  }, [open, choice])

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const input = { name, url, note }
      const result = choice ? await updateOwnerSuggestedChoice(projectId, choice.id, input) : await addOwnerSuggestedChoice(projectId, selectionId, input)
      if (!result.success) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{choice ? "Edit your choice" : "Add my own choice"}</DialogTitle>
          <DialogDescription>
            Your own choice for {selectionName}. Your builder prices it (the price on a product page isn&apos;t the price you pay); until then it shows
            &quot;Pending staff pricing&quot;. You can pick it like any other choice.
          </DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input id={`${formId}-name`} value={name} maxLength={OWNER_SUGGESTION_NAME_MAX} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-url`}>Product link (optional)</Label>
            <Input id={`${formId}-url`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" inputMode="url" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-note`}>Note (optional)</Label>
            <Textarea id={`${formId}-note`} value={note} maxLength={OWNER_SUGGESTION_NOTE_MAX} onChange={(event) => setNote(event.target.value)} rows={3} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending || !name.trim()}>
            {pending ? "Saving…" : choice ? "Save" : "Add choice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Confirms deleting the owner's own suggestion (open while `choiceTitle` is set). */
export function OwnerSuggestionDeleteDialog({
  choiceTitle,
  selectionName,
  onCancel,
  onConfirm,
}: {
  readonly choiceTitle: string | null
  readonly selectionName: string
  readonly onCancel: () => void
  readonly onConfirm: () => void
}): React.ReactElement {
  return (
    <AlertDialog
      open={choiceTitle !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your suggested choice?</AlertDialogTitle>
          <AlertDialogDescription>
            {choiceTitle} will be removed from {selectionName}, with its product link. Your builder hasn&apos;t priced it yet.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
