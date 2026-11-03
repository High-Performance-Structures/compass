"use client"

import * as React from "react"
import Image from "next/image"
import {
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconFileText,
  IconPhoto,
} from "@tabler/icons-react"

import type {
  ProjectDailyLogItem,
  ProjectDailyLogPhoto,
} from "@/app/actions/project-field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  photoLinkHref,
  projectInternalPhotoUrl,
  resolvePhotoImageSource,
} from "@/lib/photo-sources"
import { adjacentPhoto } from "@/lib/photos/carousel"
import { statusLabel } from "@/lib/daily-logs/workspace-view"

export function DailyLogPhotoThumb({
  photo,
  projectId,
}: {
  readonly photo: ProjectDailyLogPhoto
  readonly projectId: string
}): React.ReactElement {
  const [imageFailed, setImageFailed] = React.useState(false)
  const resolvedImage = resolvePhotoImageSource({
    ...photo,
    thumbnailUrl: projectInternalPhotoUrl(projectId, photo.id),
  })
  const imageSrc = imageFailed ? null : resolvedImage.src

  if (imageSrc !== null) {
    return (
      <Image
        src={imageSrc}
        alt={photo.caption ?? photo.fileName}
        fill
        sizes="160px"
        unoptimized
        className="object-cover transition-transform group-hover:scale-[1.03]"
        onError={() => setImageFailed(true)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
      <IconFileText className="size-6" />
      <span className="line-clamp-3 break-words">
        {resolvedImage.reason === "missing"
          ? photo.caption ?? photo.fileName
          : resolvedImage.label}
      </span>
    </div>
  )
}

export function PhotoStrip({
  log,
  projectId,
}: {
  readonly log: ProjectDailyLogItem
  readonly projectId: string
}): React.ReactElement | null {
  const [previewPhotoId, setPreviewPhotoId] = React.useState<string | null>(null)
  const [failedPreviewIds, setFailedPreviewIds] = React.useState<readonly string[]>(
    []
  )
  const touchStartX = React.useRef<number | null>(null)
  const previewPhoto =
    log.photos.find((photo) => photo.id === previewPhotoId) ?? null

  const showAdjacentPreview = React.useCallback(
    (direction: "previous" | "next"): void => {
      if (!previewPhotoId) return
      const adjacent = adjacentPhoto(log.photos, previewPhotoId, direction)
      if (adjacent) setPreviewPhotoId(adjacent.id)
    },
    [log.photos, previewPhotoId]
  )

  React.useEffect(() => {
    if (!previewPhoto || log.photos.length < 2) return

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
  }, [log.photos.length, previewPhoto, showAdjacentPreview])

  if (log.photos.length === 0) return null

  const ownerVisibleCount = log.photos.filter((photo) => photo.ownerVisible).length
  const previewIndex = previewPhoto
    ? log.photos.findIndex((photo) => photo.id === previewPhoto.id)
    : -1
  const previewImage = previewPhoto
    ? resolvePhotoImageSource({
        ...previewPhoto,
        thumbnailUrl: projectInternalPhotoUrl(projectId, previewPhoto.id),
      })
    : null
  const previewImageSrc =
    previewPhoto && !failedPreviewIds.includes(previewPhoto.id)
      ? previewImage?.src ?? null
      : null
  const previewHref = previewPhoto
    ? photoLinkHref(projectInternalPhotoUrl(projectId, previewPhoto.id))
    : null

  function markPreviewFailed(photoId: string): void {
    setFailedPreviewIds((current) =>
      current.includes(photoId) ? current : [...current, photoId]
    )
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>): void {
    touchStartX.current = event.touches.item(0)?.clientX ?? null
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>): void {
    const endX = event.changedTouches.item(0)?.clientX ?? null
    const startX = touchStartX.current
    touchStartX.current = null
    if (startX === null || endX === null || log.photos.length < 2) return
    const distance = endX - startX
    if (Math.abs(distance) < 48) return
    showAdjacentPreview(distance > 0 ? "previous" : "next")
  }

  return (
    <>
      <div className="mt-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <IconPhoto className="size-3.5" />
          <span>
            {log.photos.length} file{log.photos.length === 1 ? "" : "s"} tied to
            this log
          </span>
          <span>&middot;</span>
          <span>{ownerVisibleCount} owner visible</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {log.photos.slice(0, 6).map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setPreviewPhotoId(photo.id)}
              aria-label={`Preview ${photo.caption ?? photo.fileName}`}
              className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-md border bg-muted text-left"
            >
              <DailyLogPhotoThumb photo={photo} projectId={projectId} />
              <div className="absolute inset-x-0 bottom-0 bg-background/85 px-2 py-1 text-xs">
                {photo.ownerVisible
                  ? "Owner visible"
                  : statusLabel(photo.reviewStatus)}
              </div>
            </button>
          ))}
        </div>
      </div>

      <Dialog
        open={previewPhoto !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewPhotoId(null)
        }}
      >
        <DialogContent className="max-h-[94vh] overflow-hidden p-0 sm:max-w-5xl">
          {previewPhoto && (
            <div className="grid max-h-[94vh] grid-rows-[auto_minmax(0,1fr)_auto]">
              <DialogHeader className="border-b px-4 py-3 pr-12">
                <DialogTitle className="line-clamp-1 text-base">
                  {previewPhoto.caption ?? previewPhoto.fileName}
                </DialogTitle>
                <DialogDescription>
                  Photo {previewIndex + 1} of {log.photos.length} in this daily log
                </DialogDescription>
              </DialogHeader>

              <div
                className="relative min-h-[55vh] bg-muted/40"
                style={{ touchAction: "pan-y" }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {previewImageSrc ? (
                  <Image
                    src={previewImageSrc}
                    alt={previewPhoto.caption ?? previewPhoto.fileName}
                    fill
                    sizes="92vw"
                    unoptimized
                    className="object-contain"
                    onError={() => markPreviewFailed(previewPhoto.id)}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <IconFileText className="size-12 text-muted-foreground" />
                    <p className="text-sm font-medium text-muted-foreground">
                      {previewImage?.label ?? previewPhoto.fileName}
                    </p>
                  </div>
                )}

                {log.photos.length > 1 && (
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
                <p className="text-xs text-muted-foreground">
                  Use the arrows, keyboard, or swipe to review this log’s photos.
                </p>
                <div className="flex items-center gap-2">
                  {previewHref && (
                    <Button asChild type="button" variant="outline" size="sm">
                      <a href={previewHref} target="_blank" rel="noreferrer">
                        <IconExternalLink className="size-4" />
                        Open original
                      </a>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewPhotoId(null)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
