"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconCheck, IconPhoto, IconRefresh, IconX } from "@tabler/icons-react"

import {
  updateOwnerProjectUpdateDraft,
  type OwnerProjectUpdateDocument,
} from "@/app/actions/project-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { resolvePhotoImageSource } from "@/lib/photo-sources"

type DraftStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }

export function OwnerUpdateDraftEditor({
  document,
}: {
  readonly document: OwnerProjectUpdateDocument
}): React.ReactElement {
  const router = useRouter()
  const [title, setTitle] = React.useState(document.update.title)
  const [updateDate, setUpdateDate] = React.useState(document.update.updateDate)
  const [periodStart, setPeriodStart] = React.useState(
    document.update.periodStart ?? document.update.updateDate
  )
  const [periodEnd, setPeriodEnd] = React.useState(
    document.update.periodEnd ?? document.update.updateDate
  )
  const [summary, setSummary] = React.useState(document.update.summary)
  const [selectedPhotoIds, setSelectedPhotoIds] = React.useState<readonly string[]>(
    document.update.selectedPhotoIds
  )
  const [status, setStatus] = React.useState<DraftStatus>({ kind: "idle" })
  const [failedImageIds, setFailedImageIds] = React.useState<readonly string[]>(
    []
  )
  const selectedPhotoIdSet = new Set(selectedPhotoIds)
  const failedImageSet = new Set(failedImageIds)

  function togglePhoto(photoId: string, checked: boolean): void {
    setSelectedPhotoIds((current) => {
      if (checked) return Array.from(new Set([...current, photoId]))
      return current.filter((id) => id !== photoId)
    })
  }

  function selectAllPhotos(): void {
    setSelectedPhotoIds(document.availablePhotos.map((photo) => photo.id))
  }

  function clearPhotos(): void {
    setSelectedPhotoIds([])
  }

  function markImageFailed(photoId: string): void {
    setFailedImageIds((current) => {
      if (current.includes(photoId)) return current
      return [...current, photoId]
    })
  }

  async function saveDraft(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    setStatus({ kind: "saving" })

    try {
      const result = await updateOwnerProjectUpdateDraft(
        document.project.id,
        document.update.id,
        {
          title,
          updateDate,
          periodStart,
          periodEnd,
          summary,
          selectedPhotoIds,
        }
      )

      if (!result.success) {
        setStatus({ kind: "error", message: result.error })
        return
      }

      setStatus({ kind: "saved", message: "Draft updated." })
      router.refresh()
    } catch {
      setStatus({
        kind: "error",
        message: "Unable to save this draft. Please try again.",
      })
    }
  }

  return (
    <section className="bg-background p-5 shadow-sm sm:p-6 print:hidden">
      <form onSubmit={saveDraft} className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
          <div>
            <h2 className="text-sm font-semibold">Edit Draft</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Adjust the owner-facing text and selected photos before publishing.
            </p>
          </div>
          <Button type="submit" disabled={status.kind === "saving"}>
            {status.kind === "saved" ? (
              <IconCheck className="size-4" />
            ) : (
              <IconRefresh className="size-4" />
            )}
            {status.kind === "saving" ? "Saving..." : "Save draft"}
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <div className="space-y-2">
            <Label htmlFor="owner-update-title">Title</Label>
            <Input
              id="owner-update-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="owner-update-date">Update date</Label>
            <Input
              id="owner-update-date"
              type="date"
              value={updateDate}
              onChange={(event) => setUpdateDate(event.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="owner-update-period-start">
              Reporting period starts
            </Label>
            <Input
              id="owner-update-period-start"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="owner-update-period-end">
              Reporting period ends
            </Label>
            <Input
              id="owner-update-period-end"
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              required
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {document.update.sourceDailyLogIds.length} approved owner-visible daily
          {document.update.sourceDailyLogIds.length === 1 ? " log is" : " logs are"}{" "}
          included. Saving refreshes the Looking Ahead schedule for the end of
          this period.
        </p>

        <div className="space-y-2">
          <Label htmlFor="owner-update-summary">Summary</Label>
          <Textarea
            id="owner-update-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            className="min-h-36"
            required
          />
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <IconPhoto className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Photos</h3>
              <span className="text-sm text-muted-foreground">
                {selectedPhotoIds.length} selected
              </span>
            </div>
            {(document.availablePhotos.length > 0 ||
              selectedPhotoIds.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {document.availablePhotos.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={selectAllPhotos}
                  >
                    Select all
                  </Button>
                )}
                {selectedPhotoIds.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearPhotos}
                  >
                    <IconX className="size-4" />
                    Clear
                  </Button>
                )}
              </div>
            )}
          </div>

          {document.availablePhotos.length === 0 ? (
            <p className="border px-3 py-3 text-sm text-muted-foreground">
              No approved owner-visible photos are available yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {document.availablePhotos.map((photo) => {
                const checked = selectedPhotoIdSet.has(photo.id)
                const resolvedImage = resolvePhotoImageSource(photo)
                const src = failedImageSet.has(photo.id)
                  ? null
                  : resolvedImage.src

                return (
                  <label
                    key={photo.id}
                    className="group relative cursor-pointer overflow-hidden border bg-muted/20"
                  >
                    <div className="absolute left-2 top-2 z-10 rounded-sm bg-background/90 p-1 shadow-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          togglePhoto(photo.id, value === true)
                        }
                        aria-label={`Select ${photo.fileName}`}
                      />
                    </div>
                    {src ? (
                      <img
                        src={src}
                        alt={photo.caption ?? photo.fileName}
                        className="aspect-[4/3] w-full object-cover"
                        onError={() => markImageFailed(photo.id)}
                      />
                    ) : (
                      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
                        <IconPhoto className="size-6" />
                        {resolvedImage.label}
                      </div>
                    )}
                    <div className="border-t bg-background px-2 py-1.5">
                      <p className="truncate text-xs font-medium">
                        {photo.caption ?? photo.fileName}
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {status.kind === "saved" && (
          <p className="border-l-2 border-l-brand-hps-primary px-3 py-2 text-sm text-brand-hps-primary">
            {status.message}
          </p>
        )}
        {status.kind === "error" && (
          <p className="border-l-2 border-l-destructive px-3 py-2 text-sm text-destructive">
            {status.message}
          </p>
        )}
      </form>
    </section>
  )
}
