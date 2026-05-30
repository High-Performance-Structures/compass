"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconArrowLeft,
  IconExternalLink,
  IconPhoto,
  IconUpload,
  IconUsers,
} from "@tabler/icons-react"

import {
  updateProjectPhotoPhase,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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

const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024

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

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function currentDateInputValue(): string {
  return new Date().toISOString().slice(0, 10)
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
  const router = useRouter()
  const [photos, setPhotos] =
    React.useState<readonly ProjectPhotoLibraryItem[]>(library.photos)
  const [dateFilter, setDateFilter] = React.useState("")
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
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [uploadFiles, setUploadFiles] = React.useState<readonly File[]>([])
  const [uploadCaption, setUploadCaption] = React.useState("")
  const [uploadCapturedDate, setUploadCapturedDate] = React.useState("")
  const [uploadPhotoKind, setUploadPhotoKind] = React.useState("progress")
  const [uploadPhase, setUploadPhase] = React.useState("")
  const [uploadMessage, setUploadMessage] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
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

  function resetUploadForm(): void {
    setUploadFiles([])
    setUploadCaption("")
    setUploadCapturedDate(currentDateInputValue())
    setUploadPhotoKind("progress")
    setUploadPhase("")
  }

  function openUploadSheet(): void {
    if (uploadCapturedDate.length === 0) {
      setUploadCapturedDate(currentDateInputValue())
    }
    setUploadOpen(true)
  }

  async function uploadSelectedPhotos(): Promise<void> {
    if (uploadFiles.length === 0) {
      setUploadMessage("Choose at least one image to upload.")
      return
    }

    const oversizedFile = uploadFiles.find(
      (file) => file.size > MAX_UPLOAD_FILE_BYTES
    )
    if (oversizedFile) {
      setUploadMessage(
        `${oversizedFile.name} is ${formatBytes(oversizedFile.size)}. Upload photos under 50 MB each.`
      )
      return
    }

    const filesToUpload = uploadFiles

    setUploading(true)
    setUploadMessage(null)
    try {
      let uploadedCount = 0

      for (const [index, file] of filesToUpload.entries()) {
        setUploadMessage(
          `Uploading ${index + 1} of ${filesToUpload.length}: ${file.name}`
        )

        const formData = new FormData()
        formData.append("files", file)
        formData.set("caption", uploadCaption)
        formData.set("capturedDate", uploadCapturedDate)
        formData.set("photoKind", uploadPhotoKind)
        formData.set("schedulePhase", uploadPhase)

        const response = await fetch(
          `/api/projects/${library.project.id}/photos/upload`,
          {
            method: "POST",
            body: formData,
          }
        )
        const result: unknown = await response.json()

        if (
          typeof result === "object" &&
          result !== null &&
          "success" in result &&
          result.success === true
        ) {
          uploadedCount += 1
          continue
        }

        const error =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "Unable to upload photo."
        setUploadFiles(filesToUpload.slice(index))
        setUploadMessage(
          `Uploaded ${uploadedCount} of ${filesToUpload.length}. ${file.name}: ${error}`
        )
        router.refresh()
        return
      }

      setUploadMessage(
        `Uploaded ${uploadedCount} photo${uploadedCount === 1 ? "" : "s"} to Drive and queued for review.`
      )
      resetUploadForm()
      setUploadOpen(false)
      router.refresh()
    } catch {
      setUploadMessage("Unable to upload photos.")
    } finally {
      setUploading(false)
    }
  }

  function changePhotoPhase(photoId: string, phase: string): void {
    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectPhotoPhase(
        library.project.id,
        photoId,
        phase
      )

      if (result.success) {
        setPhotos((current) =>
          current.map((photo) =>
            photo.id === photoId
              ? {
                  ...photo,
                  schedulePhase: result.phase,
                  schedulePhaseConfidence: 100,
                  schedulePhaseReason:
                    "Phase was manually assigned during photo review.",
                }
              : photo
          )
        )
        setMessage(`Updated phase to ${result.phase}.`)
      } else {
        setMessage(result.error)
      }
    })
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
            <Button type="button" onClick={openUploadSheet}>
              <IconUpload className="size-4" />
              Upload photos
            </Button>
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
                  <label className="flex min-w-0 flex-1 items-center justify-end gap-1 text-xs text-muted-foreground">
                    <span className="shrink-0">Phase</span>
                    <select
                      value={photo.schedulePhase}
                      onChange={(event) =>
                        changePhotoPhase(photo.id, event.target.value)
                      }
                      disabled={isPending}
                      className="h-7 min-w-0 max-w-[150px] rounded border bg-background px-1.5 text-xs text-foreground"
                    >
                      {library.phases.map((phase) => (
                        <option key={phase.value} value={phase.value}>
                          {phase.label}
                        </option>
                      ))}
                    </select>
                  </label>
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

        <Sheet open={uploadOpen} onOpenChange={setUploadOpen}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>Upload Project Photos</SheetTitle>
              <SheetDescription>
                Originals are saved to the mapped Google Drive photo folder.
                Compass keeps review status, phase, and visibility metadata.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4">
              <label className="block space-y-2 text-sm">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Images
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) =>
                    setUploadFiles(
                      Array.from(event.currentTarget.files ?? [])
                    )
                  }
                  className="block w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
                />
              </label>

              {uploadFiles.length > 0 && (
                <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {uploadFiles.length} selected ·{" "}
                    {formatBytes(
                      uploadFiles.reduce((sum, file) => sum + file.size, 0)
                    )}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {uploadFiles.slice(0, 5).map((file) => (
                      <li key={`${file.name}-${file.size}`} className="truncate">
                        {file.name}
                      </li>
                    ))}
                  </ul>
                  {uploadFiles.length > 5 && (
                    <p className="mt-1">+{uploadFiles.length - 5} more</p>
                  )}
                </div>
              )}

              <label className="block space-y-2 text-sm">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Caption or note
                </span>
                <textarea
                  value={uploadCaption}
                  onChange={(event) => setUploadCaption(event.target.value)}
                  rows={3}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="Optional note for this batch"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-2 text-sm">
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    Photo date
                  </span>
                  <input
                    type="date"
                    value={uploadCapturedDate}
                    onChange={(event) =>
                      setUploadCapturedDate(event.target.value)
                    }
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  />
                </label>
                <label className="block space-y-2 text-sm">
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    Photo type
                  </span>
                  <select
                    value={uploadPhotoKind}
                    onChange={(event) => setUploadPhotoKind(event.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="progress">Progress</option>
                    <option value="issue">Issue</option>
                    <option value="delivery">Delivery</option>
                    <option value="selection">Selection</option>
                    <option value="archive">Archive</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-2 text-sm">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Phase
                </span>
                <select
                  value={uploadPhase}
                  onChange={(event) => setUploadPhase(event.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Let Compass suggest</option>
                  {library.phases.map((phase) => (
                    <option key={phase.value} value={phase.value}>
                      {phase.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                Uploaded photos start as internal-only and need review before
                owners, subs, vendors, or public links can see them.
              </div>

              {uploadMessage && (
                <p className="text-sm text-muted-foreground">{uploadMessage}</p>
              )}
            </div>
            <SheetFooter>
              <Button
                type="button"
                onClick={uploadSelectedPhotos}
                disabled={uploading || uploadFiles.length === 0}
              >
                <IconUpload className="size-4" />
                {uploading ? "Uploading..." : "Upload to Drive"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUploadOpen(false)}
                disabled={uploading}
              >
                Cancel
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </main>
  )
}
