"use client"

import * as React from "react"
import Image from "next/image"
import {
  IconChevronLeft,
  IconChevronRight,
  IconPhoto,
  IconSearch,
} from "@tabler/icons-react"

import type { AudiencePhoto } from "@/app/actions/project-audience-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SearchableCombobox } from "@/components/searchable-combobox"
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
import { resolvePhotoImageSource } from "@/lib/photo-sources"
import { adjacentPhoto } from "@/lib/photos/carousel"

type AudiencePhotoSort = "newest" | "oldest" | "phase_newest" | "phase_oldest"
const NO_PHASE_VALUE = "unassigned"

function phaseLabel(value: string): string {
  return value.length > 0 ? value : "No phase"
}

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
    const value = photo.schedulePhase.length > 0 ? photo.schedulePhase : NO_PHASE_VALUE
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
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
  const [failedImageIds, setFailedImageIds] = React.useState<readonly string[]>(
    []
  )

  const phases = React.useMemo(() => phaseOptions(photos), [photos])
  const failedImageSet = React.useMemo(
    () => new Set(failedImageIds),
    [failedImageIds]
  )
  const filteredPhotos = React.useMemo(() => {
    const filtered = photos.filter(
      (photo) =>
        (dateFilter.length === 0 || photo.photoDate === dateFilter) &&
        (phaseFilter === "all" ||
          (phaseFilter === NO_PHASE_VALUE
            ? photo.schedulePhase.length === 0
            : photo.schedulePhase === phaseFilter))
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

  const showAdjacentPreview = React.useCallback(
    (direction: "previous" | "next"): void => {
      if (!previewPhoto) return
      const adjacent = adjacentPhoto(filteredPhotos, previewPhoto.id, direction)
      if (adjacent) setPreviewPhoto(adjacent)
    },
    [filteredPhotos, previewPhoto]
  )

  React.useEffect(() => {
    if (!previewPhoto || filteredPhotos.length < 2) return

    function handlePreviewKeyDown(event: KeyboardEvent): void {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        showAdjacentPreview("previous")
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        showAdjacentPreview("next")
      }
    }

    window.addEventListener("keydown", handlePreviewKeyDown)
    return () => window.removeEventListener("keydown", handlePreviewKeyDown)
  }, [filteredPhotos.length, previewPhoto, showAdjacentPreview])

  function markImageFailed(photoId: string): void {
    setFailedImageIds((current) => {
      if (current.includes(photoId)) return current
      return [...current, photoId]
    })
  }

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
              <SearchableCombobox
                ariaLabel="Photo phase"
                options={[
                  { value: "all", label: "All phases" },
                  ...phases.map((phase) => ({
                    value: phase.value,
                    label: `${phaseLabel(
                      phase.value === NO_PHASE_VALUE ? "" : phase.value
                    )} (${phase.count})`,
                    keywords: phase.value,
                  })),
                ]}
                value={phaseFilter}
                onValueChange={setPhaseFilter}
                placeholder="All phases"
                searchPlaceholder="Search phases..."
                emptyMessage="No matching phases."
                groupHeading="Phases"
                className="h-9"
              />
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
              {filteredPhotos.map((photo) => {
                const resolvedImage = resolvePhotoImageSource(photo)
                const imageSrc = failedImageSet.has(photo.id)
                  ? null
                  : resolvedImage.src

                return (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setPreviewPhoto(photo)}
                    className="overflow-hidden rounded-md border bg-background text-left transition hover:-translate-y-1 hover:border-primary/50 hover:bg-muted/30 hover:shadow-md"
                    aria-label={`Open larger preview for ${photo.caption ?? photo.fileName}`}
                  >
                    <div className="relative flex aspect-[4/3] items-center justify-center bg-muted/50">
                      {imageSrc ? (
                        <Image
                          src={imageSrc}
                          alt={photo.caption ?? photo.fileName}
                          fill
                          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                          unoptimized
                          className="object-cover"
                          onError={() => markImageFailed(photo.id)}
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
                          <IconPhoto className="size-8 text-muted-foreground" />
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {resolvedImage.label}
                          </span>
                        </div>
                      )}
                      <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
                        {photo.photoDate}
                      </span>
                      <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
                        {phaseLabel(photo.schedulePhase)}
                      </span>
                    </div>
                    <div className="space-y-2 p-2">
                      <p className="line-clamp-2 min-h-10 text-xs font-medium">
                        {photo.caption ?? photo.fileName}
                      </p>
                    </div>
                  </button>
                )
              })}
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
            (() => {
              const resolvedImage = resolvePhotoImageSource(previewPhoto)
              const imageSrc = failedImageSet.has(previewPhoto.id)
                ? null
                : resolvedImage.src

              return (
            <div className="grid max-h-[92vh] grid-rows-[auto_minmax(0,1fr)]">
              <DialogHeader className="border-b px-4 py-3">
                <DialogTitle className="line-clamp-1 text-base">
                  {previewPhoto.caption ?? previewPhoto.fileName}
                </DialogTitle>
                <DialogDescription>
                  {formatDate(previewPhoto.photoDate)} ·{" "}
                  {phaseLabel(previewPhoto.schedulePhase)}
                </DialogDescription>
              </DialogHeader>
              <div className="flex min-h-0 flex-col bg-muted/40">
                <div className="relative min-h-[55vh] flex-1">
                  {imageSrc ? (
                    <Image
                      src={imageSrc}
                      alt={previewPhoto.caption ?? previewPhoto.fileName}
                      fill
                      sizes="90vw"
                      unoptimized
                      className="object-contain"
                      onError={() => markImageFailed(previewPhoto.id)}
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                      <IconPhoto className="size-12 text-muted-foreground" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {resolvedImage.label}
                      </p>
                    </div>
                  )}
                  {filteredPhotos.length > 1 && (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        onClick={() => showAdjacentPreview("previous")}
                        aria-label="Show previous photo"
                        className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow-md"
                      >
                        <IconChevronLeft className="size-5" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        onClick={() => showAdjacentPreview("next")}
                        aria-label="Show next photo"
                        className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow-md"
                      >
                        <IconChevronRight className="size-5" />
                      </Button>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-3">
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {filteredPhotos.findIndex(
                        (photo) => photo.id === previewPhoto.id
                      ) + 1}{" "}
                      of {filteredPhotos.length}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary">
                        Phase: {phaseLabel(previewPhoto.schedulePhase)}
                      </Badge>
                    </div>
                    {previewPhoto.schedulePhase.length > 0 && (
                      <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
                        {previewPhoto.schedulePhaseReason}
                      </p>
                    )}
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
              )
            })()
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
