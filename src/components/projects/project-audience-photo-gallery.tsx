"use client"

import * as React from "react"
import Image from "next/image"
import { IconPhoto, IconSearch } from "@tabler/icons-react"

import type { AudiencePhoto } from "@/app/actions/project-audience-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type AudiencePhotoSort = "newest" | "oldest" | "phase_newest" | "phase_oldest"

function formatDate(value: string | null): string {
  if (!value) return "Unscheduled"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function sortValue(value: string): AudiencePhotoSort {
  switch (value) {
    case "oldest":
    case "phase_newest":
    case "phase_oldest":
      return value
    default:
      return "newest"
  }
}

function compareByDate(
  left: AudiencePhoto,
  right: AudiencePhoto,
  direction: "asc" | "desc"
): number {
  const result = left.photoDate.localeCompare(right.photoDate)
  if (result === 0) return left.fileName.localeCompare(right.fileName)
  return direction === "asc" ? result : -result
}

function compareByPhase(
  left: AudiencePhoto,
  right: AudiencePhoto,
  direction: "asc" | "desc"
): number {
  const phaseResult = left.schedulePhase.localeCompare(right.schedulePhase)
  if (phaseResult !== 0) return phaseResult
  return compareByDate(left, right, direction)
}

function phaseOptions(
  photos: readonly AudiencePhoto[]
): readonly {
  readonly value: string
  readonly count: number
}[] {
  const counts = new Map<string, number>()

  for (const photo of photos) {
    counts.set(photo.schedulePhase, (counts.get(photo.schedulePhase) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort(([left], [right]) => {
      if (left === "Unassigned phase") return 1
      if (right === "Unassigned phase") return -1
      return left.localeCompare(right)
    })
    .map(([value, count]) => ({ value, count }))
}

function latestPhotoDate(photos: readonly AudiencePhoto[]): string {
  return (
    photos
      .map((photo) => photo.photoDate)
      .sort((left, right) => right.localeCompare(left))[0] ?? ""
  )
}

export function ProjectAudiencePhotoGallery({
  photos,
  title,
  emptyMessage,
}: {
  readonly photos: readonly AudiencePhoto[]
  readonly title: string
  readonly emptyMessage: string
}): React.ReactElement {
  const [dateFilter, setDateFilter] = React.useState(latestPhotoDate(photos))
  const [phaseFilter, setPhaseFilter] = React.useState("all")
  const [photoSort, setPhotoSort] = React.useState<AudiencePhotoSort>("newest")
  const [previewPhoto, setPreviewPhoto] = React.useState<AudiencePhoto | null>(
    null
  )

  const phases = React.useMemo(() => phaseOptions(photos), [photos])
  const filteredPhotos = React.useMemo(() => {
    const filtered = photos.filter(
      (photo) =>
        (dateFilter.length === 0 || photo.photoDate === dateFilter) &&
        (phaseFilter === "all" || photo.schedulePhase === phaseFilter)
    )

    return [...filtered].sort((left, right) => {
      switch (photoSort) {
        case "oldest":
          return compareByDate(left, right, "asc")
        case "phase_newest":
          return compareByPhase(left, right, "desc")
        case "phase_oldest":
          return compareByPhase(left, right, "asc")
        case "newest":
          return compareByDate(left, right, "desc")
      }
    })
  }, [dateFilter, phaseFilter, photoSort, photos])

  return (
    <section
      id="photos"
      className="scroll-mt-6 rounded-lg border bg-background p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconPhoto className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        <Badge variant="outline">{photos.length} photos</Badge>
      </div>

      {photos.length > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-3 border-y py-3">
            <label className="w-full space-y-1 text-sm sm:w-52">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                Date
              </span>
              <input
                type="date"
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <label className="w-full space-y-1 text-sm sm:w-64">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                Phase
              </span>
              <Select
                value={phaseFilter}
                onValueChange={setPhaseFilter}
              >
                <SelectTrigger aria-label="Photo phase" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All phases</SelectItem>
                  {phases.map((phase) => (
                    <SelectItem key={phase.value} value={phase.value}>
                      {phase.value} ({phase.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="w-full space-y-1 text-sm sm:w-56">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                Sort
              </span>
              <Select
                value={photoSort}
                onValueChange={(value) => setPhotoSort(sortValue(value))}
              >
                <SelectTrigger aria-label="Sort photos" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Date, newest first</SelectItem>
                  <SelectItem value="oldest">Date, oldest first</SelectItem>
                  <SelectItem value="phase_newest">
                    Phase, newest first
                  </SelectItem>
                  <SelectItem value="phase_oldest">
                    Phase, oldest first
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div className="flex flex-wrap gap-2">
              {dateFilter.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDateFilter("")}
                >
                  All dates
                </Button>
              )}
              {phaseFilter !== "all" && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPhaseFilter("all")}
                >
                  All phases
                </Button>
              )}
            </div>
          </div>

          {filteredPhotos.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {filteredPhotos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setPreviewPhoto(photo)}
                  className="overflow-hidden rounded-md border bg-background text-left transition hover:-translate-y-1 hover:border-primary/50 hover:bg-muted/30 hover:shadow-md"
                  aria-label={`Open larger preview for ${photo.caption ?? photo.fileName}`}
                >
                  <div className="relative flex aspect-[4/3] items-center justify-center bg-muted/50">
                    {photo.thumbnailUrl ? (
                      <Image
                        src={photo.thumbnailUrl}
                        alt={photo.caption ?? photo.fileName}
                        fill
                        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
                        <IconPhoto className="size-8 text-muted-foreground" />
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          Photo preview
                        </span>
                      </div>
                    )}
                    <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
                      {photo.photoDate}
                    </span>
                    <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
                      {photo.schedulePhase}
                    </span>
                  </div>
                  <div className="space-y-2 p-2">
                    <p className="line-clamp-2 min-h-10 text-xs font-medium">
                      {photo.caption ?? photo.fileName}
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline">
                        {photo.schedulePhaseConfidence}% match
                      </Badge>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <IconSearch className="size-4" />
                No photos match the selected date and phase.
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}

      <Dialog
        open={previewPhoto !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewPhoto(null)
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-5xl">
          {previewPhoto && (
            <div className="grid max-h-[92vh] grid-rows-[auto_minmax(0,1fr)]">
              <DialogHeader className="border-b px-4 py-3">
                <DialogTitle className="line-clamp-1 text-base">
                  {previewPhoto.caption ?? previewPhoto.fileName}
                </DialogTitle>
                <DialogDescription>
                  {formatDate(previewPhoto.photoDate)} ·{" "}
                  {previewPhoto.schedulePhase} ·{" "}
                  {previewPhoto.schedulePhaseConfidence}% match
                </DialogDescription>
              </DialogHeader>
              <div className="flex min-h-0 flex-col bg-muted/40">
                <div className="relative min-h-[55vh] flex-1">
                  {previewPhoto.thumbnailUrl ? (
                    <Image
                      src={previewPhoto.thumbnailUrl}
                      alt={previewPhoto.caption ?? previewPhoto.fileName}
                      fill
                      sizes="90vw"
                      unoptimized
                      className="object-contain"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <IconPhoto className="size-12 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-3">
                  <div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary">
                        Phase: {previewPhoto.schedulePhase}
                      </Badge>
                      <Badge variant="outline">
                        {previewPhoto.schedulePhaseConfidence}% match
                      </Badge>
                    </div>
                    <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
                      {previewPhoto.schedulePhaseReason}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPreviewPhoto(null)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
