"use client"

/*
 * The small dialogs behind the staff detail panel: paste a supplier product
 * link, attach project photos, and pick the follow-up selections a choice
 * opens. Each saves through the selection choice actions.
 */
import * as React from "react"

import {
  addSelectionLink,
  attachSelectionPhotos,
  detachSelectionPhoto,
  getAttachableSelectionPhotos,
  setChoiceDependentSelections,
  setSelectionChoiceChosen,
} from "@/app/actions/selection-choices"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SelectionPhotoView } from "@/lib/domain/selections/choices-read"
import { projectInternalPhotoUrl } from "@/lib/photo-sources"

type DialogProps = {
  readonly projectId: string
  readonly selectionId: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSaved: () => void
}

/** Paste a supplier's product page; Compass reads its name, image and price for the card. */
export function PasteLinkDialog({
  projectId,
  selectionId,
  choiceId,
  targetLabel,
  audience = "staff",
  open,
  onOpenChange,
  onSaved,
}: DialogProps & {
  /** The choice the link is for; null puts it on the selection. */
  readonly choiceId: string | null
  readonly targetLabel: string
  readonly audience?: "staff" | "owner"
}): React.ReactElement {
  const [url, setUrl] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const inputId = React.useId()

  React.useEffect(() => {
    if (open) {
      setUrl("")
      setError(null)
    }
  }, [open])

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await addSelectionLink(projectId, selectionId, choiceId, url, audience)
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
          <DialogTitle>{audience === "owner" ? "Suggest an item" : "Paste product link"}</DialogTitle>
          <DialogDescription>
            {audience === "owner"
              ? `Paste a link to a product page for ${targetLabel}. Your builder will look at it and price it.`
              : `Paste a supplier's product page for ${targetLabel}. Compass shows its name, picture and price when the page lists them.`}
          </DialogDescription>
        </DialogHeader>
        <form id={inputId} onSubmit={submit} className="grid gap-1.5">
          <Label htmlFor={`${inputId}-url`}>Link</Label>
          <Input id={`${inputId}-url`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" inputMode="url" required />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={inputId} disabled={pending || !url.trim()}>
            {pending ? "Reading the page…" : "Add link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Attach this job's photos to a choice or the selection, and remove ones already attached. */
export function AttachPhotosDialog({
  projectId,
  selectionId,
  choiceId,
  targetLabel,
  attached,
  open,
  onOpenChange,
  onSaved,
}: DialogProps & {
  readonly choiceId: string | null
  readonly targetLabel: string
  readonly attached: readonly SelectionPhotoView[]
}): React.ReactElement {
  const [photos, setPhotos] = React.useState<readonly { readonly id: string; readonly fileName: string }[] | null>(null)
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set())
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open) return
    setPicked(new Set())
    setError(null)
    let live = true
    void getAttachableSelectionPhotos(projectId).then((result) => {
      if (!live) return
      if (result.success) setPhotos(result.data)
      else setError(result.error)
    })
    return () => {
      live = false
    }
  }, [open, projectId])

  const attachedIds = new Set(attached.map((photo) => photo.photoId))
  const available = (photos ?? []).filter((photo) => !attachedIds.has(photo.id))

  function toggle(id: string, on: boolean): void {
    setPicked((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function attach(): void {
    startTransition(async () => {
      const result = await attachSelectionPhotos(projectId, selectionId, choiceId, [...picked])
      if (!result.success) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      onSaved()
    })
  }

  function detach(linkId: string): void {
    startTransition(async () => {
      const result = await detachSelectionPhoto(projectId, linkId)
      if (!result.success) setError(result.error)
      else onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Photos for {targetLabel}</DialogTitle>
          <DialogDescription>Pick photos from this job. Owners only see photos marked owner-visible in Photos.</DialogDescription>
        </DialogHeader>
        {attached.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attached.map((photo) => (
              <figure key={photo.linkId} className="flex w-24 flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- project photo served by the photos route */}
                <img src={projectInternalPhotoUrl(projectId, photo.photoId)} alt={photo.fileName} className="size-24 rounded-md object-cover" />
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => detach(photo.linkId)}>
                  Remove
                </Button>
              </figure>
            ))}
          </div>
        )}
        <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
          {photos === null ? (
            <p className="col-span-full text-sm text-muted-foreground">Loading photos…</p>
          ) : available.length === 0 ? (
            <p className="col-span-full text-sm text-muted-foreground">No other photos on this job yet.</p>
          ) : (
            available.map((photo) => (
              <label key={photo.id} className="relative flex cursor-pointer flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- project photo served by the photos route */}
                <img src={projectInternalPhotoUrl(projectId, photo.id)} alt={photo.fileName} loading="lazy" className="aspect-square w-full rounded-md object-cover" />
                <Checkbox
                  className="absolute left-1 top-1 bg-background"
                  checked={picked.has(photo.id)}
                  onCheckedChange={(value) => toggle(photo.id, value === true)}
                  aria-label={`Attach ${photo.fileName}`}
                />
              </label>
            ))
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={pending || picked.size === 0} onClick={attach}>
            Attach {picked.size || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Which other selections on the job this choice opens when the owner picks it. */
export function FollowUpsDialog({
  projectId,
  choiceId,
  choiceTitle,
  selectionId,
  current,
  options,
  open,
  onOpenChange,
  onSaved,
}: DialogProps & {
  readonly choiceId: string
  readonly choiceTitle: string
  readonly current: readonly string[]
  readonly options: readonly { readonly id: string; readonly label: string }[]
}): React.ReactElement {
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set(current))
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (open) {
      setPicked(new Set(current))
      setError(null)
    }
  }, [open, current])

  function toggle(id: string, on: boolean): void {
    setPicked((now) => {
      const next = new Set(now)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function save(): void {
    startTransition(async () => {
      const result = await setChoiceDependentSelections(projectId, choiceId, [...picked])
      if (!result.success) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      onSaved()
    })
  }

  const choices = options.filter((option) => option.id !== selectionId)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Follow-ups for {choiceTitle}</DialogTitle>
          <DialogDescription>Choosing this opens these selections too (a vanity opens its hardware and top).</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-80 gap-1.5 overflow-y-auto">
          {choices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add the follow-up selections to this job first.</p>
          ) : (
            choices.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={picked.has(option.id)} onCheckedChange={(value) => toggle(option.id, value === true)} />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            ))
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={save}>
            Save follow-ups
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Staff marking the owner's pick for them, with an optional note such as "per phone call". */
export function PickForOwnerDialog({
  projectId,
  choiceId,
  choiceTitle,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly projectId: string
  readonly choiceId: string
  readonly choiceTitle: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSaved: () => void
}): React.ReactElement {
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const inputId = React.useId()

  React.useEffect(() => {
    if (open) {
      setNote("")
      setError(null)
    }
  }, [open])

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await setSelectionChoiceChosen(projectId, choiceId, true, "staff", note)
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
          <DialogTitle>Mark the owner&apos;s pick</DialogTitle>
          <DialogDescription>
            Records that you picked {choiceTitle} for the owner, with your name and today&apos;s date. The owner still signs for the round.
          </DialogDescription>
        </DialogHeader>
        <form id={inputId} onSubmit={submit} className="grid gap-1.5">
          <Label htmlFor={`${inputId}-note`}>Note (optional)</Label>
          <Input id={`${inputId}-note`} value={note} maxLength={500} placeholder="e.g. per phone call" onChange={(event) => setNote(event.target.value)} />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={inputId} disabled={pending}>
            Mark as owner&apos;s pick
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
