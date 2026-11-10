"use client"

import * as React from "react"
import Image from "next/image"
import {
  IconArrowRight,
  IconMaximize,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react"

import { PhotoFullScreenViewer } from "@/components/photos/photo-full-screen-viewer"
import { cn } from "@/lib/utils"
import { ProjectAudienceDashboardPlaceholder } from "@/components/projects/project-audience-dashboard-placeholder"

export type AudienceDashboardPhoto = {
  readonly id: string
  /** The original photo, for the larger viewer. */
  readonly src: string
  /** A small copy for the slideshow and film strip (see photo-rendition.ts). */
  readonly thumbnailSrc: string
  readonly alt: string
  /** Shown under the photo in the larger viewer, e.g. "Oct 9, 2026". */
  readonly dateLabel: string
}

/** How many of the newest photos the header slideshow cycles through. */
const SLIDESHOW_PHOTOS = 6

/**
 * The project photo beside the dashboard greeting: a slideshow of the newest
 * photos (or a default photo before there are any). Clicking it opens the
 * full-screen viewer, which steps through every photo the viewer can see.
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
              src={photo.thumbnailSrc}
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
      <PhotoFullScreenViewer
        photos={available}
        currentId={viewerIndex === null ? null : (available[viewerIndex % available.length]?.id ?? null)}
        describe={(photo) => ({
          id: photo.id,
          title: photo.alt,
          subtitle: photo.dateLabel,
          alt: photo.alt,
          src: photo.src,
          thumbSrc: photo.thumbnailSrc,
          fallbackLabel: "Photo unavailable",
          imageKey: photo.id,
        })}
        onSelect={(photoId) => setViewerIndex(available.findIndex((photo) => photo.id === photoId))}
        onClose={() => setViewerIndex(null)}
        onImageError={markFailed}
      />
    </div>
  )
}
