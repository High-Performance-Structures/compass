"use client"

import * as React from "react"
import Image from "next/image"
import {
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
  IconMaximize,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { ProjectAudienceDashboardPlaceholder } from "@/components/projects/project-audience-dashboard-placeholder"

export type AudienceDashboardPhoto = {
  readonly id: string
  readonly src: string
  readonly alt: string
  /** Shown under the photo in the larger viewer, e.g. "Oct 9, 2026". */
  readonly dateLabel: string
}

/** How many of the newest photos the header slideshow cycles through. */
const SLIDESHOW_PHOTOS = 6
/** A horizontal swipe longer than this moves to the next or previous photo. */
const SWIPE_DISTANCE = 40

/**
 * The project photo beside the dashboard greeting: a slideshow of the newest
 * photos (or a default photo before there are any). Clicking it opens a larger
 * viewer that steps through every photo the viewer can see.
 */
export function ProjectAudienceDashboardPhoto({
  photos,
  className,
}: {
  /** Newest first; already limited to photos this viewer may see. */
  readonly photos: readonly AudienceDashboardPhoto[]
  readonly className?: string
}): React.ReactElement {
  const [failedIds, setFailedIds] = React.useState<readonly string[]>([])
  const [index, setIndex] = React.useState(0)
  const [paused, setPaused] = React.useState(false)
  const [reducedMotion, setReducedMotion] = React.useState(true)
  const [viewerIndex, setViewerIndex] = React.useState<number | null>(null)
  const available = photos.filter((photo) => !failedIds.includes(photo.id))
  const slides = available.slice(0, SLIDESHOW_PHOTOS)
  const currentIndex = slides.length > 0 ? index % slides.length : 0
  const viewerOpen = viewerIndex !== null
  const playing = !paused && !reducedMotion && !viewerOpen

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = (): void => setReducedMotion(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  React.useEffect(() => {
    if (!playing || slides.length < 2) return
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((value) => (value + 1) % slides.length)
    }, 6500)
    return () => window.clearInterval(timer)
  }, [playing, slides.length])

  function markFailed(photoId: string): void {
    setFailedIds((ids) => (ids.includes(photoId) ? ids : [...ids, photoId]))
  }

  return (
    <div
      className={cn("relative overflow-hidden rounded-lg border bg-muted", className)}
      role="region"
      aria-label="Project photos"
      aria-roledescription="carousel"
    >
      {slides.length > 0 ? (
        <button
          type="button"
          className="group absolute inset-0 cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          onClick={() => setViewerIndex(currentIndex)}
          aria-label={`Open project photos (${available.length})`}
        >
          {slides.map((photo, photoIndex) => (
            <Image
              key={photo.id}
              src={photo.src}
              alt={photo.alt}
              fill
              sizes="(min-width: 640px) 240px, 100vw"
              unoptimized
              aria-hidden={photoIndex !== currentIndex}
              className={cn(
                "object-cover transition-opacity duration-[1500ms] motion-reduce:transition-none",
                photoIndex === currentIndex ? "opacity-100" : "opacity-0"
              )}
              onError={() => markFailed(photo.id)}
            />
          ))}
          <span className="absolute top-2 right-2 grid size-7 place-items-center rounded-md bg-background/85 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <IconMaximize className="size-3.5" aria-hidden="true" />
          </span>
        </button>
      ) : (
        <ProjectAudienceDashboardPlaceholder compact />
      )}
      {slides.length > 1 && (
        <div className="absolute bottom-2 left-2 z-20 flex items-center rounded-md border bg-background text-foreground shadow-sm">
          {!reducedMotion && (
            <button
              type="button"
              className="grid size-8 place-items-center rounded-l-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => setPaused((value) => !value)}
              aria-label={playing ? "Pause project photos" : "Play project photos"}
            >
              {playing ? (
                <IconPlayerPause className="size-3.5" />
              ) : (
                <IconPlayerPlay className="size-3.5" />
              )}
            </button>
          )}
          <span className="px-2 text-xs tabular-nums" aria-live="off">
            {currentIndex + 1} / {slides.length}
          </span>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-r-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              setPaused(true)
              setIndex((value) => value + 1)
            }}
            aria-label="Next project photo"
          >
            <IconArrowRight className="size-3.5" />
          </button>
        </div>
      )}
      <ProjectPhotoViewer
        photos={available}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
        onFailed={markFailed}
      />
    </div>
  )
}

/** A larger view of the project photos, with previous/next, arrow keys, swipe and thumbnails. */
function ProjectPhotoViewer({
  photos,
  index,
  onIndexChange,
  onFailed,
}: {
  readonly photos: readonly AudienceDashboardPhoto[]
  readonly index: number | null
  readonly onIndexChange: (index: number | null) => void
  readonly onFailed: (photoId: string) => void
}): React.ReactElement {
  const thumbnailRefs = React.useRef<Record<string, HTMLButtonElement | null>>({})
  const swipeStartX = React.useRef<number | null>(null)
  const open = index !== null && photos.length > 0
  const current = open ? photos[index % photos.length] : undefined
  const position = open ? index % photos.length : 0

  const step = React.useCallback(
    (direction: 1 | -1): void => {
      if (index === null || photos.length < 2) return
      onIndexChange((index + direction + photos.length) % photos.length)
    },
    [index, onIndexChange, photos.length]
  )

  React.useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        step(-1)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        step(1)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, step])

  // Keep the current thumbnail in view as the viewer steps through photos.
  React.useEffect(() => {
    if (!current) return
    thumbnailRefs.current[current.id]?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [current])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onIndexChange(null))}>
      <DialogContent className="max-h-[94vh] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        {current ? (
          <div className="grid max-h-[94vh] grid-rows-[auto_minmax(0,1fr)_auto]">
            <DialogHeader className="border-b px-4 py-3 pr-12">
              <DialogTitle className="line-clamp-1 text-base">{current.alt}</DialogTitle>
              <DialogDescription>
                {current.dateLabel} · {position + 1} of {photos.length}
              </DialogDescription>
            </DialogHeader>
            <div
              className="relative min-h-[50vh] bg-muted/40 sm:min-h-[62vh]"
              onPointerDown={(event) => {
                swipeStartX.current = event.clientX
              }}
              onPointerUp={(event) => {
                const start = swipeStartX.current
                swipeStartX.current = null
                if (start === null) return
                const distance = event.clientX - start
                if (Math.abs(distance) >= SWIPE_DISTANCE) step(distance < 0 ? 1 : -1)
              }}
            >
              <Image
                key={current.id}
                src={current.src}
                alt={current.alt}
                fill
                sizes="(min-width: 1024px) 1024px, 100vw"
                unoptimized
                draggable={false}
                className="select-none object-contain"
                onError={() => onFailed(current.id)}
              />
              {photos.length > 1 && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={() => step(-1)}
                    aria-label="Previous photo"
                    className="absolute top-1/2 left-3 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow-md"
                  >
                    <IconChevronLeft className="size-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={() => step(1)}
                    aria-label="Next photo"
                    className="absolute top-1/2 right-3 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow-md"
                  >
                    <IconChevronRight className="size-5" />
                  </Button>
                </>
              )}
            </div>
            {photos.length > 1 && (
              <div
                className="flex gap-2 overflow-x-auto border-t bg-background px-4 py-3"
                aria-label="All project photos"
              >
                {photos.map((photo, photoIndex) => (
                  <button
                    key={photo.id}
                    ref={(element) => {
                      thumbnailRefs.current[photo.id] = element
                    }}
                    type="button"
                    onClick={() => onIndexChange(photoIndex)}
                    aria-label={`Show photo ${photoIndex + 1}: ${photo.alt}`}
                    aria-current={photoIndex === position ? "true" : undefined}
                    className={cn(
                      "relative h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 focus-visible:outline-2 focus-visible:outline-ring",
                      photoIndex === position ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"
                    )}
                  >
                    <Image
                      src={photo.src}
                      alt=""
                      fill
                      sizes="80px"
                      unoptimized
                      className="object-cover"
                      onError={() => onFailed(photo.id)}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
