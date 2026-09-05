"use client"

import * as React from "react"
import Image from "next/image"
import {
  IconArrowRight,
  IconHome,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react"

import { cn } from "@/lib/utils"

export type AudienceDashboardPhoto = {
  readonly id: string
  readonly src: string
  readonly alt: string
}

export function ProjectAudienceDashboardPhoto({
  photos,
}: {
  readonly photos: readonly AudienceDashboardPhoto[]
}): React.ReactElement {
  const [failedIds, setFailedIds] = React.useState<readonly string[]>([])
  const [index, setIndex] = React.useState(0)
  const [paused, setPaused] = React.useState(false)
  const [reducedMotion, setReducedMotion] = React.useState(true)
  const available = photos.filter((photo) => !failedIds.includes(photo.id))
  const currentIndex = available.length > 0 ? index % available.length : 0
  const playing = !paused && !reducedMotion

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = (): void => setReducedMotion(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  React.useEffect(() => {
    if (!playing || available.length < 2) return
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((value) => (value + 1) % available.length)
    }, 6500)
    return () => window.clearInterval(timer)
  }, [playing, available.length])

  return (
    <div
      className="relative min-h-52 overflow-hidden bg-background after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-16 after:bg-gradient-to-r after:from-transparent after:to-background"
      role="region"
      aria-label="Project photos"
      aria-roledescription="carousel"
    >
      {available.length > 0 ? (
        available.map((photo, photoIndex) => (
          <Image
            key={photo.id}
            src={photo.src}
            alt={photo.alt}
            fill
            sizes="(min-width: 1280px) 240px, (min-width: 768px) 300px, 45vw"
            unoptimized
            aria-hidden={photoIndex !== currentIndex}
            className={cn(
              "object-cover transition-opacity duration-[1500ms] motion-reduce:transition-none",
              photoIndex === currentIndex ? "opacity-100" : "opacity-0"
            )}
            onError={() =>
              setFailedIds((ids) =>
                ids.includes(photo.id) ? ids : [...ids, photo.id]
              )
            }
          />
        ))
      ) : (
        <div className="flex h-full min-h-52 flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/15 via-muted/30 to-background p-4 pr-10 text-center text-primary">
          <IconHome className="size-8" aria-hidden="true" />
          <span className="text-xs text-muted-foreground">
            Project photos will appear here
          </span>
        </div>
      )}
      {available.length > 1 && (
        <div className="absolute bottom-3 left-2 z-20 flex items-center rounded-md border bg-background text-foreground shadow-sm">
          {!reducedMotion && (
            <button
              type="button"
              className="grid size-9 place-items-center rounded-l-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => setPaused((value) => !value)}
              aria-label={
                playing ? "Pause project photos" : "Play project photos"
              }
            >
              {playing ? (
                <IconPlayerPause className="size-3.5" />
              ) : (
                <IconPlayerPlay className="size-3.5" />
              )}
            </button>
          )}
          <span className="px-2 text-xs tabular-nums" aria-live="off">
            {currentIndex + 1} / {available.length}
          </span>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-r-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
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
    </div>
  )
}
