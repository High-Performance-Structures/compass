"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import {
  IconArrowLeft,
  IconExternalLink,
  IconPhoto,
  IconUsers,
} from "@tabler/icons-react"

import {
  updateProjectPhotoPermissions,
  type ProjectPhotoLibrary,
  type ProjectPhotoLibraryItem,
} from "@/app/actions/project-photos"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"

type VisibilityFilter =
  | "all"
  | "internal"
  | "owner"
  | "subs_vendors"
  | "public"
  | "needs_review"
  | "approved"

type PhotoSort = "newest" | "oldest" | "phase_newest" | "phase_oldest"

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function kindLabel(value: string): string {
  return statusLabel(value)
}

function sourceLabel(value: string): string {
  switch (value) {
    case "buildertrend":
      return "Buildertrend"
    case "google_drive":
      return "Google Drive"
    case "telegram":
      return "Telegram"
    case "mobile":
      return "Mobile"
    default:
      return "Compass"
  }
}

function projectLabel(library: ProjectPhotoLibrary): string {
  return library.project.projectNumber ?? library.project.name
}

function browserHref(value: string | null): string | null {
  if (value === null) return null
  if (value.startsWith("https://") || value.startsWith("http://")) return value
  if (value.startsWith("/owner-update-photos/")) return value
  if (value.startsWith("/project-photo-previews/")) return value
  return null
}

function isInternalOnly(photo: ProjectPhotoLibraryItem): boolean {
  return (
    !photo.ownerVisible &&
    !photo.subVendorVisible &&
    !photo.publicShareable
  )
}

function matchesVisibility(
  photo: ProjectPhotoLibraryItem,
  filter: VisibilityFilter
): boolean {
  switch (filter) {
    case "internal":
      return isInternalOnly(photo)
    case "owner":
      return photo.ownerVisible
    case "subs_vendors":
      return photo.subVendorVisible
    case "public":
      return photo.publicShareable
    case "needs_review":
      return photo.reviewStatus === "needs_review"
    case "approved":
      return photo.reviewStatus === "approved"
    case "all":
      return true
  }
}

function visibilityFilterValue(value: string): VisibilityFilter {
  switch (value) {
    case "internal":
    case "owner":
    case "subs_vendors":
    case "public":
    case "needs_review":
    case "approved":
      return value
    default:
      return "all"
  }
}

function photoSortValue(value: string): PhotoSort {
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
  left: ProjectPhotoLibraryItem,
  right: ProjectPhotoLibraryItem,
  direction: "asc" | "desc"
): number {
  const result = left.photoDate.localeCompare(right.photoDate)
  if (result === 0) return left.fileName.localeCompare(right.fileName)
  return direction === "asc" ? result : -result
}

function compareByPhase(
  left: ProjectPhotoLibraryItem,
  right: ProjectPhotoLibraryItem,
  direction: "asc" | "desc"
): number {
  const phaseResult = left.schedulePhase.localeCompare(right.schedulePhase)
  if (phaseResult !== 0) return phaseResult
  return compareByDate(left, right, direction)
}

function nextSelectedIds(
  current: readonly string[],
  filteredPhotos: readonly ProjectPhotoLibraryItem[],
  photoId: string,
  event: React.MouseEvent,
  lastSelectedId: string | null
): readonly string[] {
  const next = new Set(current)

  if (event.shiftKey && lastSelectedId !== null) {
    const currentIndex = filteredPhotos.findIndex((photo) => photo.id === photoId)
    const lastIndex = filteredPhotos.findIndex(
      (photo) => photo.id === lastSelectedId
    )

    if (currentIndex >= 0 && lastIndex >= 0) {
      const start = Math.min(currentIndex, lastIndex)
      const end = Math.max(currentIndex, lastIndex)
      for (const photo of filteredPhotos.slice(start, end + 1)) {
        next.add(photo.id)
      }
      return [...next]
    }
  }

  if (event.metaKey || event.ctrlKey) {
    if (next.has(photoId)) {
      next.delete(photoId)
    } else {
      next.add(photoId)
    }
    return [...next]
  }

  if (next.has(photoId)) {
    next.delete(photoId)
  } else {
    next.add(photoId)
  }

  return [...next]
}

export function ProjectPhotoReview({
  library,
}: {
  readonly library: ProjectPhotoLibrary
}): React.ReactElement {
  const initialPhotoDate =
    library.photos
      .map((photo) => photo.photoDate)
      .sort((left, right) => right.localeCompare(left))[0] ?? ""
  const [photos, setPhotos] =
    React.useState<readonly ProjectPhotoLibraryItem[]>(library.photos)
  const [dateFilter, setDateFilter] = React.useState(initialPhotoDate)
  const [phaseFilter, setPhaseFilter] = React.useState("all")
  const [photoSort, setPhotoSort] = React.useState<PhotoSort>("newest")
  const [visibilityFilter, setVisibilityFilter] =
    React.useState<VisibilityFilter>("all")
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([])
  const [lastSelectedId, setLastSelectedId] = React.useState<string | null>(null)
  const [reviewStatus, setReviewStatus] = React.useState("needs_review")
  const [photoKind, setPhotoKind] = React.useState("progress")
  const [ownerVisible, setOwnerVisible] = React.useState(false)
  const [subVendorVisible, setSubVendorVisible] = React.useState(false)
  const [publicShareable, setPublicShareable] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [previewPhoto, setPreviewPhoto] =
    React.useState<ProjectPhotoLibraryItem | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const filteredPhotos = React.useMemo(() => {
    const filtered = photos.filter(
      (photo) =>
        (dateFilter.length === 0 || photo.photoDate === dateFilter) &&
        (phaseFilter === "all" || photo.schedulePhase === phaseFilter) &&
        matchesVisibility(photo, visibilityFilter)
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
  }, [dateFilter, phaseFilter, photoSort, photos, visibilityFilter])

  const counts = React.useMemo(
    () => ({
      total: photos.length,
      needsReview: photos.filter(
        (photo) => photo.reviewStatus === "needs_review"
      ).length,
      owner: photos.filter((photo) => photo.ownerVisible).length,
      subVendor: photos.filter((photo) => photo.subVendorVisible).length,
      internal: photos.filter(isInternalOnly).length,
    }),
    [photos]
  )

  function togglePhoto(photoId: string, event: React.MouseEvent): void {
    setSelectedIds((current) =>
      nextSelectedIds(current, filteredPhotos, photoId, event, lastSelectedId)
    )
    setLastSelectedId(photoId)
  }

  function selectFiltered(): void {
    setSelectedIds(filteredPhotos.map((photo) => photo.id))
    setLastSelectedId(filteredPhotos[0]?.id ?? null)
  }

  function clearSelection(): void {
    setSelectedIds([])
    setLastSelectedId(null)
  }

  function openPreview(photo: ProjectPhotoLibraryItem): void {
    setPreviewPhoto(photo)
  }

  function applyPermissions(): void {
    const photoIds = selectedIds
    const nextReviewStatus = reviewStatus
    const nextPhotoKind = photoKind
    const nextOwnerVisible = ownerVisible
    const nextSubVendorVisible = subVendorVisible
    const nextPublicShareable = publicShareable

    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectPhotoPermissions(library.project.id, {
        photoIds,
        reviewStatus: nextReviewStatus,
        ownerVisible: nextOwnerVisible,
        subVendorVisible: nextSubVendorVisible,
        publicShareable: nextPublicShareable,
        photoKind: nextPhotoKind,
      })

      if (result.success) {
        const updatedIds = new Set(photoIds)
        setPhotos((current) =>
          current.map((photo) =>
            updatedIds.has(photo.id)
              ? {
                  ...photo,
                  reviewStatus: nextReviewStatus,
                  ownerVisible: nextOwnerVisible,
                  subVendorVisible: nextSubVendorVisible,
                  publicShareable: nextPublicShareable,
                  photoKind: nextPhotoKind,
                }
              : photo
          )
        )
        setMessage(`Updated ${result.updatedCount} photos.`)
        clearSelection()
      } else {
        setMessage(result.error)
      }
    })
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href={`/dashboard/projects/${library.project.id}`}>
                <IconArrowLeft className="size-4" />
                Project
              </Link>
            </Button>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Photo Review
            </h1>
            <p className="text-sm text-muted-foreground">
              {projectLabel(library)} · Internal staff can review every project
              photo before owners, subs, vendors, or public links can see it.
            </p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                <strong className="font-semibold text-foreground">
                  {counts.total}
                </strong>{" "}
                photos
              </span>
              <span>
                <strong className="font-semibold text-foreground">
                  {counts.needsReview}
                </strong>{" "}
                need review
              </span>
              <span>
                <strong className="font-semibold text-foreground">
                  {counts.owner}
                </strong>{" "}
                owner-visible
              </span>
              <span>
                <strong className="font-semibold text-foreground">
                  {counts.subVendor}
                </strong>{" "}
                subs/vendors
              </span>
              <span>
                <strong className="font-semibold text-foreground">
                  {counts.internal}
                </strong>{" "}
                internal
              </span>
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <ProjectContextSwitcher
              currentProjectId={library.project.id}
              targetSection="photos"
              placeholder="Switch photo project..."
              className="w-full sm:w-[280px]"
            />
          </div>
        </div>

        <section className="border-y py-3">
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="w-full space-y-1 text-sm sm:w-56">
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
              <label className="w-full space-y-1 text-sm sm:w-56">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Visibility
                </span>
                <select
                  value={visibilityFilter}
                  onChange={(event) =>
                    setVisibilityFilter(visibilityFilterValue(event.target.value))
                  }
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">All photos</option>
                  <option value="internal">Internal only</option>
                  <option value="owner">Owner visible</option>
                  <option value="subs_vendors">Subs/vendors</option>
                  <option value="public">Public/shareable</option>
                  <option value="needs_review">Needs review</option>
                  <option value="approved">Approved</option>
                </select>
              </label>
              <label className="w-full space-y-1 text-sm sm:w-60">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Suggested phase
                </span>
                <select
                  value={phaseFilter}
                  onChange={(event) => setPhaseFilter(event.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">All phases</option>
                  {library.phases.map((phase) => (
                    <option key={phase.value} value={phase.value}>
                      {phase.label} ({phase.count})
                    </option>
                  ))}
                </select>
              </label>
              <label className="w-full space-y-1 text-sm sm:w-56">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Sort
                </span>
                <select
                  value={photoSort}
                  onChange={(event) => setPhotoSort(photoSortValue(event.target.value))}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="newest">Date, newest first</option>
                  <option value="oldest">Date, oldest first</option>
                  <option value="phase_newest">Phase, newest first</option>
                  <option value="phase_oldest">Phase, oldest first</option>
                </select>
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={selectFiltered}
                  disabled={filteredPhotos.length === 0}
                >
                  Select filtered
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearSelection}
                  disabled={selectedIds.length === 0}
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <span className="mr-1 text-sm font-medium">
                {selectedIds.length} selected
              </span>
              <select
                value={reviewStatus}
                onChange={(event) => setReviewStatus(event.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="needs_review">Needs review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <select
                value={photoKind}
                onChange={(event) => setPhotoKind(event.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="progress">Progress</option>
                <option value="issue">Issue</option>
                <option value="delivery">Delivery</option>
                <option value="selection">Selection</option>
                <option value="archive">Archive</option>
              </select>
              <label className="inline-flex h-9 items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={ownerVisible}
                  onChange={(event) => setOwnerVisible(event.target.checked)}
                />
                Owner
              </label>
              <label className="inline-flex h-9 items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={subVendorVisible}
                  onChange={(event) =>
                    setSubVendorVisible(event.target.checked)
                  }
                />
                Subs/vendors
              </label>
              <label className="inline-flex h-9 items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={publicShareable}
                  onChange={(event) =>
                    setPublicShareable(event.target.checked)
                  }
                />
                Public
              </label>
              <Button
                type="button"
                onClick={applyPermissions}
                disabled={selectedIds.length === 0 || isPending}
              >
                <IconUsers className="size-4" />
                Apply
              </Button>
              {message && (
                <p className="basis-full text-xs text-muted-foreground">
                  {message}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {filteredPhotos.length === 0 && (
            <div className="col-span-full rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground">
              No photos match the selected date, phase, and visibility filters.
            </div>
          )}
          {filteredPhotos.map((photo) => {
            const selected = selectedSet.has(photo.id)
            const href = browserHref(photo.driveUrl)
            const imageSrc = photo.thumbnailUrl ?? photo.driveUrl

            return (
              <article
                key={photo.id}
                className={`overflow-hidden rounded-md border bg-background ${
                  selected ? "ring-2 ring-primary" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => openPreview(photo)}
                  className="block w-full text-left"
                  aria-label={`Open larger preview for ${photo.caption ?? photo.fileName}`}
                >
                  <div className="relative aspect-[4/3] bg-muted">
                    {imageSrc ? (
                      <Image
                        src={imageSrc}
                        alt={photo.caption ?? photo.fileName}
                        fill
                        sizes="(min-width: 1280px) 20vw, (min-width: 768px) 33vw, 50vw"
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <IconPhoto className="size-8 text-muted-foreground" />
                      </div>
                    )}
                    <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
                      {photo.photoDate}
                    </span>
                    <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
                      {photo.schedulePhase} · {photo.schedulePhaseConfidence}%
                    </span>
                  </div>
                  <div className="space-y-2 p-2">
                    <p className="line-clamp-2 min-h-10 text-xs font-medium">
                      {photo.caption ?? photo.fileName}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline">{sourceLabel(photo.sourceSystem)}</Badge>
                      <Badge
                        variant={
                          photo.reviewStatus === "approved"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {statusLabel(photo.reviewStatus)}
                      </Badge>
                      <Badge variant="outline">{kindLabel(photo.photoKind)}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      {isInternalOnly(photo) && <span>Internal</span>}
                      {photo.ownerVisible && <span>Owner</span>}
                      {photo.subVendorVisible && <span>Subs/vendors</span>}
                      {photo.publicShareable && <span>Public</span>}
                    </div>
                  </div>
                </button>
                <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
                  <button
                    type="button"
                    onClick={(event) => togglePhoto(photo.id, event)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    aria-pressed={selected}
                  >
                    <span
                      className={`flex size-4 items-center justify-center rounded border ${
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background"
                      }`}
                    >
                      {selected ? "✓" : ""}
                    </span>
                    {selected ? "Selected" : "Select"}
                  </button>
                  <span className="truncate text-xs text-muted-foreground">
                    Suggested: {photo.schedulePhase}
                  </span>
                </div>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 border-t px-2 py-1.5 text-xs text-primary hover:bg-accent"
                  >
                    <IconExternalLink className="size-3" />
                    Open
                  </a>
                )}
              </article>
            )
          })}
        </section>

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
                    {previewPhoto.photoDate} · {previewPhoto.schedulePhase} ·{" "}
                    {previewPhoto.schedulePhaseConfidence}% confidence ·{" "}
                    {statusLabel(previewPhoto.reviewStatus)}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-col bg-muted/40">
                  <div className="relative min-h-[55vh] flex-1">
                    {previewPhoto.thumbnailUrl ?? previewPhoto.driveUrl ? (
                      <Image
                        src={previewPhoto.thumbnailUrl ?? previewPhoto.driveUrl ?? ""}
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
                        <Badge variant="outline">
                          {sourceLabel(previewPhoto.sourceSystem)}
                        </Badge>
                        <Badge variant="outline">
                          {kindLabel(previewPhoto.photoKind)}
                        </Badge>
                        <Badge variant="secondary">
                          Phase suggestion: {previewPhoto.schedulePhase}
                        </Badge>
                        {isInternalOnly(previewPhoto) && (
                          <Badge variant="secondary">Internal</Badge>
                        )}
                        {previewPhoto.ownerVisible && (
                          <Badge variant="secondary">Owner</Badge>
                        )}
                        {previewPhoto.subVendorVisible && (
                          <Badge variant="secondary">Subs/vendors</Badge>
                        )}
                        {previewPhoto.publicShareable && (
                          <Badge variant="secondary">Public</Badge>
                        )}
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
      </div>
    </main>
  )
}
