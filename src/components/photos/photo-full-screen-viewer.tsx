"use client"

/**
 * The full-screen photo viewer: the photo as large as the screen allows, a
 * strip of nearby photos underneath, previous/next by button or arrow key.
 * Staff open it from the photo drawer's "Full screen"; owners and vendors open
 * it from their photo galleries. Callers describe each photo (title, image
 * URLs) so the viewer works with any photo list. It uses the dark theme
 * tokens (`dark` class) so the photo stands out in either app theme.
 */

import * as React from "react"
import Image from "next/image"
import { IconChevronLeft, IconChevronRight, IconPhoto, IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export type ViewerPhoto = {
  readonly id: string
  readonly title: string
  readonly subtitle: string
  readonly alt: string
  /** Null when the image failed or there is none; `fallbackLabel` shows instead. */
  readonly src: string | null
  readonly thumbSrc: string | null
  readonly fallbackLabel: string
  /** Changes when the image is retried, so the <img> reloads. */
  readonly imageKey: string
}

/** How many photos the strip shows on each side of the current one. */
const STRIP_RADIUS = 6
/** A horizontal swipe longer than this moves to the next or previous photo. */
const SWIPE_DISTANCE = 40

export function PhotoFullScreenViewer<Photo extends { readonly id: string }>({
  photos,
  currentId,
  describe,
  onSelect,
  onClose,
  onImageError,
  actions,
  arrowKeys = true,
}: {
  readonly photos: readonly Photo[]
  /** The photo shown; null closes the viewer. */
  readonly currentId: string | null
  readonly describe: (photo: Photo) => ViewerPhoto
  readonly onSelect: (photoId: string) => void
  readonly onClose: () => void
  readonly onImageError?: (photoId: string) => void
  /** Extra header buttons, e.g. staff's "Edit details". */
  readonly actions?: React.ReactNode
  /** False when the page already moves through photos with the arrow keys. */
  readonly arrowKeys?: boolean
}): React.ReactElement {
  const index = currentId ? photos.findIndex((photo) => photo.id === currentId) : -1
  const current = index >= 0 ? photos[index] : undefined
  const view = current ? describe(current) : null

  const step = React.useCallback(
    (offset: number) => {
      if (index < 0 || photos.length < 2) return
      const next = photos[(index + offset + photos.length) % photos.length]
      if (next) onSelect(next.id)
    },
    [index, onSelect, photos]
  )

  React.useEffect(() => {
    if (!view || !arrowKeys) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        step(-1)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        step(1)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [arrowKeys, step, view])

  const swipeStartX = React.useRef<number | null>(null)
  const strip = index >= 0 ? photos.slice(Math.max(0, index - STRIP_RADIUS), index + STRIP_RADIUS + 1) : []

  return (
    <Dialog open={view !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        className="dark top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-background p-0 text-foreground sm:max-w-none"
      >
        {view ? (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <DialogTitle className="line-clamp-1 text-base">{view.title}</DialogTitle>
                <DialogDescription className="line-clamp-1">
                  {view.subtitle} · {index + 1} of {photos.length}
                </DialogDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {actions}
                <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close full screen">
                  <IconX className="size-5" />
                </Button>
              </div>
            </header>
            <div
              className="relative min-h-0 flex-1"
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
              {view.src ? (
                <Image
                  key={view.imageKey}
                  src={view.src}
                  alt={view.alt}
                  fill
                  sizes="100vw"
                  unoptimized
                  className="object-contain"
                  onError={() => onImageError?.(view.id)}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <IconPhoto className="size-12 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">{view.fallbackLabel}</p>
                </div>
              )}
              {photos.length > 1 ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={() => step(-1)}
                    aria-label="Show previous photo"
                    className="absolute left-4 top-1/2 z-10 size-11 -translate-y-1/2 rounded-full"
                  >
                    <IconChevronLeft className="size-6" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={() => step(1)}
                    aria-label="Show next photo"
                    className="absolute right-4 top-1/2 z-10 size-11 -translate-y-1/2 rounded-full"
                  >
                    <IconChevronRight className="size-6" />
                  </Button>
                </>
              ) : null}
            </div>
            {strip.length > 1 ? (
              <nav aria-label="Nearby photos" className="flex justify-center gap-2 overflow-x-auto border-t px-4 py-3">
                {strip.map((photo) => {
                  const thumb = describe(photo)
                  const isCurrent = photo.id === view.id
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => onSelect(photo.id)}
                      aria-label={`Show ${thumb.title}`}
                      aria-current={isCurrent}
                      className={cn(
                        "relative h-16 w-24 shrink-0 overflow-hidden rounded-md bg-muted",
                        isCurrent ? "ring-2 ring-foreground" : "opacity-70 hover:opacity-100"
                      )}
                    >
                      {thumb.thumbSrc ? (
                        <Image src={thumb.thumbSrc} alt="" fill sizes="96px" unoptimized className="object-cover" />
                      ) : (
                        <IconPhoto className="m-auto size-5 text-muted-foreground" />
                      )}
                    </button>
                  )
                })}
              </nav>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
