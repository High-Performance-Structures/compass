"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconArrowLeft,
  IconCompass,
  IconCompassFilled,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconCheck,
  IconHourglass,
  IconPhoto,
  IconUpload,
  IconUsers,
  IconX,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import {
  photoLinkHref,
  projectInternalPhotoUrl,
  resolvePhotoImageSource,
} from "@/lib/photo-sources"
import { adjacentPhoto } from "@/lib/photos/carousel"

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
const NO_PHASE_VALUE = "unassigned"

function phaseLabel(value: string): string {
  return value.length > 0 ? value : "No phase"
}

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

function sourceInitial(value: string): string {
  switch (value) {
    case "buildertrend":
      return "B"
    case "google_drive":
      return "G"
    case "telegram":
      return "T"
    case "mobile":
      return "A"
    default:
      return "C"
  }
}

function reviewStatusIcon(value: string): React.ReactElement {
  switch (value) {
    case "approved":
      return <IconCheck className="size-3.5" />
    case "rejected":
      return <IconX className="size-3.5" />
    default:
      return <IconHourglass className="size-3.5" />
  }
}

function projectLabel(library: ProjectPhotoLibrary): string {
  return library.project.projectNumber ?? library.project.name
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
  const [photoKind, setPhotoKind] = React.useState("progress")
  const [ownerVisible, setOwnerVisible] = React.useState(false)
  const [subVendorVisible, setSubVendorVisible] = React.useState(false)
  const [publicShareable, setPublicShareable] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [previewPhoto, setPreviewPhoto] =
    React.useState<ProjectPhotoLibraryItem | null>(null)
  const [failedImageIds, setFailedImageIds] = React.useState<readonly string[]>(
    []
  )
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [uploadFiles, setUploadFiles] = React.useState<readonly File[]>([])
  const [uploadCaption, setUploadCaption] = React.useState("")
  const [uploadCapturedDate, setUploadCapturedDate] = React.useState("")
  const [uploadPhotoKind, setUploadPhotoKind] = React.useState("progress")
  const [uploadPhase, setUploadPhase] = React.useState(NO_PHASE_VALUE)
  const [uploadMessage, setUploadMessage] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
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
            : photo.schedulePhase === phaseFilter)) &&
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

  function resetUploadForm(): void {
    setUploadFiles([])
    setUploadCaption("")
    setUploadCapturedDate(currentDateInputValue())
    setUploadPhotoKind("progress")
    setUploadPhase(NO_PHASE_VALUE)
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
                  schedulePhaseConfidence:
                    result.phase.length > 0 ? 100 : 0,
                  schedulePhaseReason:
                    result.phase.length > 0
                      ? "Phase was selected during upload or review."
                      : "No phase assigned.",
                }
              : photo
          )
        )
        setMessage(
          result.phase.length > 0
            ? `Updated phase to ${result.phase}.`
            : "Cleared the phase."
        )
      } else {
        setMessage(result.error)
      }
    })
  }

  function applyPermissions(): void {
    const photoIds = selectedIds
    const nextReviewStatus = "approved"
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
        setOwnerVisible(false)
        setSubVendorVisible(false)
        setPublicShareable(false)
      } else {
        setMessage(result.error)
      }
    })
  }

  function rejectSelectedPhotos(): void {
    const photoIds = selectedIds
    const nextPhotoKind = photoKind

    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectPhotoPermissions(library.project.id, {
        photoIds,
        reviewStatus: "rejected",
        ownerVisible: false,
        subVendorVisible: false,
        publicShareable: false,
        photoKind: nextPhotoKind,
      })

      if (result.success) {
        const updatedIds = new Set(photoIds)
        setPhotos((current) =>
          current.map((photo) =>
            updatedIds.has(photo.id)
              ? {
                  ...photo,
                  reviewStatus: "rejected",
                  ownerVisible: false,
                  subVendorVisible: false,
                  publicShareable: false,
                  photoKind: nextPhotoKind,
                }
              : photo
          )
        )
        setMessage(`Rejected ${result.updatedCount} photos.`)
        clearSelection()
        setOwnerVisible(false)
        setSubVendorVisible(false)
        setPublicShareable(false)
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
              {projectLabel(library)} · Review dates, phases, and visibility.
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
                <Select
                  value={visibilityFilter}
                  onValueChange={(value) =>
                    setVisibilityFilter(visibilityFilterValue(value))
                  }
                >
                  <SelectTrigger aria-label="Visibility" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All photos</SelectItem>
                    <SelectItem value="internal">Internal only</SelectItem>
                    <SelectItem value="owner">Owner visible</SelectItem>
                    <SelectItem value="subs_vendors">Subs/vendors</SelectItem>
                    <SelectItem value="public">Public/shareable</SelectItem>
                    <SelectItem value="needs_review">Needs review</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="w-full space-y-1 text-sm sm:w-60">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Phase
                </span>
                <Select
                  value={phaseFilter}
                  onValueChange={setPhaseFilter}
                >
                  <SelectTrigger aria-label="Phase" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All phases</SelectItem>
                    <SelectItem value={NO_PHASE_VALUE}>No phase</SelectItem>
                    {library.phases.map((phase) => (
                      <SelectItem key={phase.value} value={phase.value}>
                        {phase.label} ({phase.count})
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
                  onValueChange={(value) => setPhotoSort(photoSortValue(value))}
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
              <div className="mr-2 min-w-40">
                <p className="text-sm font-medium">
                  {selectedIds.length} selected
                </p>
                <p className="text-xs text-muted-foreground">
                  Apply updates visibility.
                </p>
              </div>
              <Select
                value={photoKind}
                onValueChange={setPhotoKind}
              >
                <SelectTrigger aria-label="Photo type" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="progress">Progress</SelectItem>
                  <SelectItem value="issue">Issue</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="selection">Selection</SelectItem>
                  <SelectItem value="archive">Archive</SelectItem>
                </SelectContent>
              </Select>
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
                Apply visibility
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={rejectSelectedPhotos}
                disabled={selectedIds.length === 0 || isPending}
              >
                Reject selected
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
            const internalUrl = projectInternalPhotoUrl(
              library.project.id,
              photo.id
            )
            const href = photoLinkHref(internalUrl)
            const resolvedImage = resolvePhotoImageSource({
              ...photo,
              thumbnailUrl: internalUrl,
            })
            const imageSrc = failedImageSet.has(photo.id)
              ? null
              : resolvedImage.src
            const sourceName = sourceLabel(photo.sourceSystem)

            return (
              <article
                key={photo.id}
                className={`relative overflow-hidden rounded-md border bg-background ${
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
                        onError={() => markImageFailed(photo.id)}
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
                        <IconPhoto className="size-8 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">
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
                    <div className="flex flex-wrap items-center gap-1">
                      <span
                        className={`flex size-5 items-center justify-center rounded border text-muted-foreground ${
                          photo.reviewStatus === "approved"
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : photo.reviewStatus === "rejected"
                              ? "border-destructive/30 bg-destructive/10 text-destructive"
                              : "border-border bg-muted/40"
                        }`}
                        title={`Review status: ${statusLabel(photo.reviewStatus)}`}
                        aria-label={`Review status: ${statusLabel(photo.reviewStatus)}`}
                      >
                        {reviewStatusIcon(photo.reviewStatus)}
                      </span>
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
                <button
                  type="button"
                  onClick={(event) => togglePhoto(photo.id, event)}
                  aria-pressed={selected}
                  aria-label={`${selected ? "Deselect" : "Select"} ${photo.caption ?? photo.fileName}`}
                  title={`${selected ? "Deselect" : "Select"} photo`}
                  className={`absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded border shadow-sm backdrop-blur transition ${
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background/90 text-muted-foreground hover:bg-background hover:text-foreground"
                  }`}
                >
                  {selected ? (
                    <IconCompassFilled className="size-4" />
                  ) : (
                    <IconCompass className="size-4" />
                  )}
                </button>
                <div className="border-t px-2 py-1.5">
                  <label className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0">Phase</span>
                    <Select
                      value={photo.schedulePhase || NO_PHASE_VALUE}
                      onValueChange={(value) => changePhotoPhase(photo.id, value)}
                      disabled={isPending}
                    >
                      <SelectTrigger
                        aria-label={`Phase for ${photo.caption ?? photo.fileName}`}
                        size="sm"
                        className="h-7 min-w-0 flex-1 px-1.5 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_PHASE_VALUE}>No phase</SelectItem>
                        {library.phases.map((phase) => (
                          <SelectItem key={phase.value} value={phase.value}>
                            {phase.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <IconExternalLink className="size-3" />
                      Open
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No link
                    </span>
                  )}
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded border border-border/70 bg-muted/40 text-[10px] font-semibold text-muted-foreground"
                    title={`Source: ${sourceName}`}
                    aria-label={`Source: ${sourceName}`}
                  >
                    {sourceInitial(photo.sourceSystem)}
                  </span>
                </div>
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
            {previewPhoto &&
              (() => {
                const resolvedImage = resolvePhotoImageSource({
                  ...previewPhoto,
                  thumbnailUrl: projectInternalPhotoUrl(
                    library.project.id,
                    previewPhoto.id
                  ),
                })
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
                        {previewPhoto.photoDate} · {phaseLabel(previewPhoto.schedulePhase)} ·{" "}
                        {statusLabel(previewPhoto.reviewStatus)}
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
                            <Badge variant="outline">
                              {sourceLabel(previewPhoto.sourceSystem)}
                            </Badge>
                            <Badge variant="outline">
                              {kindLabel(previewPhoto.photoKind)}
                            </Badge>
                            <Badge variant="secondary">
                              Phase: {phaseLabel(previewPhoto.schedulePhase)}
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
              })()}
          </DialogContent>
        </Dialog>

        <Sheet open={uploadOpen} onOpenChange={setUploadOpen}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>Upload Project Photos</SheetTitle>
              <SheetDescription>
                Saves originals to the project photo folder.
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
                  <Select
                    value={uploadPhotoKind}
                    onValueChange={setUploadPhotoKind}
                  >
                    <SelectTrigger aria-label="Upload photo type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="progress">Progress</SelectItem>
                      <SelectItem value="issue">Issue</SelectItem>
                      <SelectItem value="delivery">Delivery</SelectItem>
                      <SelectItem value="selection">Selection</SelectItem>
                      <SelectItem value="archive">Archive</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <label className="block space-y-2 text-sm">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Phase
                </span>
                <Select
                  value={uploadPhase}
                  onValueChange={setUploadPhase}
                >
                  <SelectTrigger aria-label="Upload phase" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PHASE_VALUE}>No phase</SelectItem>
                    {library.phases.map((phase) => (
                      <SelectItem key={phase.value} value={phase.value}>
                        {phase.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                Uploads start internal-only.
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
