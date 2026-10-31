"use client"

import * as React from "react"
import Image from "next/image"
import {
  IconChevronLeft,
  IconChevronRight,
  IconPhoto,
} from "@tabler/icons-react"

import type { ProjectPhotoLibraryItem } from "@/app/actions/project-photos"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { PhotoImageRetry } from "@/components/projects/photo-review/use-photo-image-retry"
import {
  isInternalOnly,
  kindLabel,
  phaseLabel,
  sourceLabel,
  statusLabel,
} from "@/lib/photos/review"

/** The larger preview of one photo, with previous/next through the filtered photos. */
export function PhotoPreviewDialog({
  previewPhoto,
  filteredPhotos,
  images,
  developerModeEnabled,
  onClose,
  onShowAdjacent,
}: {
  readonly previewPhoto: ProjectPhotoLibraryItem | null
  readonly filteredPhotos: readonly ProjectPhotoLibraryItem[]
  readonly images: PhotoImageRetry
  readonly developerModeEnabled: boolean
  readonly onClose: () => void
  readonly onShowAdjacent: (direction: "previous" | "next") => void
}): React.ReactElement {
  return (
    <Dialog
      open={previewPhoto !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-5xl">
        {previewPhoto && (
          <PhotoPreviewBody
            previewPhoto={previewPhoto}
            filteredPhotos={filteredPhotos}
            images={images}
            developerModeEnabled={developerModeEnabled}
            onClose={onClose}
            onShowAdjacent={onShowAdjacent}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function PhotoPreviewBody({
  previewPhoto,
  filteredPhotos,
  images,
  developerModeEnabled,
  onClose,
  onShowAdjacent,
}: {
  readonly previewPhoto: ProjectPhotoLibraryItem
  readonly filteredPhotos: readonly ProjectPhotoLibraryItem[]
  readonly images: PhotoImageRetry
  readonly developerModeEnabled: boolean
  readonly onClose: () => void
  readonly onShowAdjacent: (direction: "previous" | "next") => void
}): React.ReactElement {
  const { resolvedImage, retryAttempt, imageSrc } = images.imageFor(previewPhoto)

  return (
    <div className="grid max-h-[92vh] grid-rows-[auto_minmax(0,1fr)]">
      <DialogHeader className="border-b px-4 py-3">
        <DialogTitle className="line-clamp-1 text-base">
          {previewPhoto.caption ?? previewPhoto.fileName}
        </DialogTitle>
        <DialogDescription>
          {previewPhoto.photoDate ?? "Capture date unknown"} · {phaseLabel(previewPhoto.schedulePhase)} ·{" "}
          {statusLabel(previewPhoto.reviewStatus)}
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-col bg-muted/40">
        <div className="relative min-h-[55vh] flex-1">
          {imageSrc ? (
            <Image
              key={`${previewPhoto.id}-${retryAttempt}`}
              src={imageSrc}
              alt={previewPhoto.caption ?? previewPhoto.fileName}
              fill
              sizes="90vw"
              unoptimized
              className="object-contain"
              onError={() => images.markImageFailed(previewPhoto.id)}
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
                onClick={() => onShowAdjacent("previous")}
                aria-label="Show previous photo"
                className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow-md"
              >
                <IconChevronLeft className="size-5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => onShowAdjacent("next")}
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
              {developerModeEnabled && (
                <Badge variant="outline">
                  {sourceLabel(previewPhoto.sourceSystem)}
                </Badge>
              )}
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
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
