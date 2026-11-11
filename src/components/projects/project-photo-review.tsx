"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconUpload } from "@tabler/icons-react"

import {
  deleteProjectPhotos,
  updateProjectPhotoCaption,
  updateProjectPhotoPhase,
  updateProjectPhotoPermissions,
  type ProjectPhotoLibrary,
  type ProjectPhotoLibraryItem,
} from "@/app/actions/project-photos"
import { Button } from "@/components/ui/button"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { PageHeader } from "@/components/page-header"
import { PhotoDrawer, type PhotoDetailsInput } from "@/components/projects/photo-review/photo-drawer"
import { PhotoReviewCard } from "@/components/projects/photo-review/photo-review-card"
import { PhotoReviewToolbar } from "@/components/projects/photo-review/photo-review-toolbar"
import { PhotoUploadSheet } from "@/components/projects/photo-review/photo-upload-sheet"
import { usePhotoImageRetry } from "@/components/projects/photo-review/use-photo-image-retry"
import { usePhotoUpload } from "@/components/projects/photo-review/use-photo-upload"
import { adjacentPhoto } from "@/lib/photos/carousel"
import {
  filterAndSortPhotos,
  nextSelectedIds,
  NO_PHASE_VALUE,
  PHOTO_DELETE_BATCH_LIMIT,
  photoReviewCounts,
  photoWithPhase,
  type PhotoReviewCounts,
  type PhotoSort,
  type VisibilityFilter,
} from "@/lib/photos/review"

const PHOTO_CARD_BATCH_SIZE = 100

/** The photo, review and visibility counts under the page title. */
function PhotoReviewCountsMeta({
  counts,
}: {
  readonly counts: PhotoReviewCounts
}): React.ReactElement {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
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
    </span>
  )
}

export function ProjectPhotoReview({
  library,
}: {
  readonly library: ProjectPhotoLibrary
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const router = useRouter()
  const [photos, setPhotos] =
    React.useState<readonly ProjectPhotoLibraryItem[]>(library.photos)
  const [dateFilter, setDateFilter] = React.useState("")
  const [phaseFilter, setPhaseFilter] = React.useState("all")
  const [photoSort, setPhotoSort] = React.useState<PhotoSort>("newest")
  const [visibilityFilter, setVisibilityFilter] =
    React.useState<VisibilityFilter>("all")
  const [visiblePhotoCount, setVisiblePhotoCount] = React.useState(PHOTO_CARD_BATCH_SIZE)
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([])
  const [lastSelectedId, setLastSelectedId] = React.useState<string | null>(null)
  const [photoKind, setPhotoKind] = React.useState("progress")
  const [ownerVisible, setOwnerVisible] = React.useState(false)
  const [subVendorVisible, setSubVendorVisible] = React.useState(false)
  const [publicShareable, setPublicShareable] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [previewPhoto, setPreviewPhoto] =
    React.useState<ProjectPhotoLibraryItem | null>(null)
  const images = usePhotoImageRetry(library.project.id)
  const upload = usePhotoUpload({
    projectId: library.project.id,
    refresh: () => router.refresh(),
  })
  const [isPending, startTransition] = React.useTransition()

  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const filteredPhotos = React.useMemo(
    () => filterAndSortPhotos(photos, { dateFilter, phaseFilter, visibilityFilter, photoSort }),
    [dateFilter, phaseFilter, photoSort, photos, visibilityFilter]
  )

  const counts = React.useMemo(() => photoReviewCounts(photos), [photos])
  // Large archives must not server-render thousands of cards. Keep the full
  // library for filters, selection and the carousel; expand only the card grid.
  const visiblePhotos = filteredPhotos.slice(0, visiblePhotoCount)
  const remainingPhotoCount = filteredPhotos.length - visiblePhotos.length

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
            photo.id === photoId ? photoWithPhase(photo, result.phase) : photo
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

  /** Approves (with the chosen visibility) or rejects the selected photos. */
  function updateSelectedPhotos(reviewStatus: "approved" | "rejected"): void {
    const photoIds = selectedIds
    const approving = reviewStatus === "approved"
    const next = {
      reviewStatus,
      ownerVisible: approving && ownerVisible,
      subVendorVisible: approving && subVendorVisible,
      publicShareable: approving && publicShareable,
      photoKind,
    }

    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectPhotoPermissions(library.project.id, {
        photoIds,
        ...next,
      })

      if (result.success) {
        const updatedIds = new Set(photoIds)
        setPhotos((current) =>
          current.map((photo) =>
            updatedIds.has(photo.id) ? { ...photo, ...next } : photo
          )
        )
        setMessage(
          approving
            ? `Updated ${result.updatedCount} photos.`
            : `Rejected ${result.updatedCount} photos.`
        )
        clearSelection()
        setOwnerVisible(false)
        setSubVendorVisible(false)
        setPublicShareable(false)
      } else {
        setMessage(result.error)
      }
    })
  }

  /** Saves one photo's details from the drawer; saving approves it, as Apply does. */
  function savePhotoDetails(photo: ProjectPhotoLibraryItem, input: PhotoDetailsInput): void {
    const next = {
      reviewStatus: "approved",
      ownerVisible: input.ownerVisible,
      subVendorVisible: input.subVendorVisible,
      publicShareable: input.publicShareable,
      photoKind: input.photoKind,
    }
    setMessage(null)
    startTransition(async () => {
      let updated: ProjectPhotoLibraryItem = { ...photo, ...next }
      if (input.caption.trim() !== (photo.caption ?? "")) {
        const captionResult = await updateProjectPhotoCaption(library.project.id, photo.id, input.caption)
        if (!captionResult.success) {
          setMessage(captionResult.error)
          return
        }
        updated = { ...updated, caption: captionResult.caption }
      }
      if (input.phase !== (photo.schedulePhase || NO_PHASE_VALUE)) {
        const phaseResult = await updateProjectPhotoPhase(library.project.id, photo.id, input.phase)
        if (!phaseResult.success) {
          setMessage(phaseResult.error)
          return
        }
        updated = photoWithPhase(updated, phaseResult.phase)
      }
      const result = await updateProjectPhotoPermissions(library.project.id, { photoIds: [photo.id], ...next })
      if (!result.success) {
        setMessage(result.error)
        return
      }
      setPhotos((current) => current.map((item) => (item.id === photo.id ? updated : item)))
      setPreviewPhoto(updated)
      setMessage("Saved the photo.")
    })
  }

  /** Deletes the selected photos. */
  function deleteSelectedPhotos(): void {
    deletePhotos(selectedIds)
  }

  /** Deletes photos in parts the server accepts, stopping at the first error. */
  function deletePhotos(photoIds: readonly string[]): void {
    setMessage(null)
    startTransition(async () => {
      const removed = new Set<string>()
      let deleted = 0
      let kept = 0
      let driveFailed = 0
      let error: string | null = null
      for (let index = 0; index < photoIds.length; index += PHOTO_DELETE_BATCH_LIMIT) {
        const result = await deleteProjectPhotos(
          library.project.id,
          photoIds.slice(index, index + PHOTO_DELETE_BATCH_LIMIT)
        )
        if (!result.success) {
          error = result.error
          break
        }
        for (const id of result.deletedIds) removed.add(id)
        deleted += result.deletedCount
        kept += result.keptInUse
        driveFailed += result.driveTrashFailed
      }

      setPhotos((current) => current.filter((photo) => !removed.has(photo.id)))
      setSelectedIds((current) => current.filter((id) => !removed.has(id)))
      setPreviewPhoto((current) => (current && removed.has(current.id) ? null : current))
      const parts = [`Deleted ${deleted} photo${deleted === 1 ? "" : "s"}.`]
      if (kept > 0) parts.push(`Kept ${kept} shown in a client update or social post.`)
      if (driveFailed > 0) parts.push(`${driveFailed} Drive file${driveFailed === 1 ? "" : "s"} couldn't be moved to the trash.`)
      if (error) parts.push(error)
      setMessage(parts.join(" "))
    })
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <PageHeader
          className="mb-0"
          back={{ href: `/dashboard/projects/${library.project.id}`, label: "Project" }}
          eyebrow={library.project.projectNumber ?? library.project.name}
          title="Photo Review"
          meta={<PhotoReviewCountsMeta counts={counts} />}
          actions={
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <Button type="button" onClick={upload.openUploadSheet}>
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
          }
        />

        <PhotoReviewToolbar
          phases={library.phases}
          filters={{
            dateFilter,
            setDateFilter: (value) => {
              setDateFilter(value)
              setVisiblePhotoCount(PHOTO_CARD_BATCH_SIZE)
            },
            phaseFilter,
            setPhaseFilter: (value) => {
              setPhaseFilter(value)
              setVisiblePhotoCount(PHOTO_CARD_BATCH_SIZE)
            },
            photoSort,
            setPhotoSort: (value) => {
              setPhotoSort(value)
              setVisiblePhotoCount(PHOTO_CARD_BATCH_SIZE)
            },
            visibilityFilter,
            setVisibilityFilter: (value) => {
              setVisibilityFilter(value)
              setVisiblePhotoCount(PHOTO_CARD_BATCH_SIZE)
            },
          }}
          batch={{
            photoKind,
            setPhotoKind,
            ownerVisible,
            setOwnerVisible,
            subVendorVisible,
            setSubVendorVisible,
            publicShareable,
            setPublicShareable,
          }}
          filteredCount={filteredPhotos.length}
          selectedCount={selectedIds.length}
          isPending={isPending}
          message={message}
          onSelectFiltered={selectFiltered}
          onClearSelection={clearSelection}
          onApplyPermissions={() => updateSelectedPhotos("approved")}
          onRejectSelected={() => updateSelectedPhotos("rejected")}
          onDeleteSelected={deleteSelectedPhotos}
        />

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {filteredPhotos.length === 0 && (
            <div className="col-span-full rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground">
              No photos match the selected date, phase, and visibility filters.
            </div>
          )}
          {visiblePhotos.map((photo) => (
            <PhotoReviewCard
              key={photo.id}
              photo={photo}
              library={library}
              selected={selectedSet.has(photo.id)}
              images={images}
              developerModeEnabled={developerModeEnabled}
              isPending={isPending}
              onOpenPreview={() => setPreviewPhoto(photo)}
              onToggle={(event) => togglePhoto(photo.id, event)}
              onChangePhase={(value) => changePhotoPhase(photo.id, value)}
            />
          ))}
        </section>

        {filteredPhotos.length > PHOTO_CARD_BATCH_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm text-muted-foreground">
              Showing {visiblePhotos.length} of {filteredPhotos.length} photos
            </p>
            {remainingPhotoCount > 0 && (
              <Button
                variant="outline"
                onClick={() => setVisiblePhotoCount((current) => current + PHOTO_CARD_BATCH_SIZE)}
              >
                Show {Math.min(PHOTO_CARD_BATCH_SIZE, remainingPhotoCount)} more photos
              </Button>
            )}
          </div>
        )}

        <PhotoDrawer
          previewPhoto={previewPhoto}
          filteredPhotos={filteredPhotos}
          library={library}
          images={images}
          developerModeEnabled={developerModeEnabled}
          isPending={isPending}
          onClose={() => setPreviewPhoto(null)}
          onShowPhoto={(photoId) => setPreviewPhoto(filteredPhotos.find((photo) => photo.id === photoId) ?? null)}
          onShowAdjacent={showAdjacentPreview}
          onSave={savePhotoDetails}
          onDelete={(photo) => deletePhotos([photo.id])}
        />

        <PhotoUploadSheet upload={upload} phases={library.phases} />
      </div>
    </main>
  )
}
