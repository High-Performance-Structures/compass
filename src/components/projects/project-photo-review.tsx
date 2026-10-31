"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconUpload } from "@tabler/icons-react"

import {
  updateProjectPhotoPhase,
  updateProjectPhotoPermissions,
  type ProjectPhotoLibrary,
  type ProjectPhotoLibraryItem,
} from "@/app/actions/project-photos"
import { Button } from "@/components/ui/button"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { PageHeader } from "@/components/page-header"
import { PhotoPreviewDialog } from "@/components/projects/photo-review/photo-preview-dialog"
import { PhotoReviewCard } from "@/components/projects/photo-review/photo-review-card"
import { PhotoReviewToolbar } from "@/components/projects/photo-review/photo-review-toolbar"
import { PhotoUploadSheet } from "@/components/projects/photo-review/photo-upload-sheet"
import { usePhotoImageRetry } from "@/components/projects/photo-review/use-photo-image-retry"
import { usePhotoUpload } from "@/components/projects/photo-review/use-photo-upload"
import { adjacentPhoto } from "@/lib/photos/carousel"
import {
  filterAndSortPhotos,
  nextSelectedIds,
  photoReviewCounts,
  photoWithPhase,
  type PhotoReviewCounts,
  type PhotoSort,
  type VisibilityFilter,
} from "@/lib/photos/review"

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
            setDateFilter,
            phaseFilter,
            setPhaseFilter,
            photoSort,
            setPhotoSort,
            visibilityFilter,
            setVisibilityFilter,
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
        />

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {filteredPhotos.length === 0 && (
            <div className="col-span-full rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground">
              No photos match the selected date, phase, and visibility filters.
            </div>
          )}
          {filteredPhotos.map((photo) => (
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

        <PhotoPreviewDialog
          previewPhoto={previewPhoto}
          filteredPhotos={filteredPhotos}
          images={images}
          developerModeEnabled={developerModeEnabled}
          onClose={() => setPreviewPhoto(null)}
          onShowAdjacent={showAdjacentPreview}
        />

        <PhotoUploadSheet upload={upload} phases={library.phases} />
      </div>
    </main>
  )
}
