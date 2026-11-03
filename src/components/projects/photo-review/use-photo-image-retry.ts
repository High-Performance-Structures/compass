"use client"

import * as React from "react"

import {
  projectInternalPhotoUrl,
  resolvePhotoImageSource,
} from "@/lib/photo-sources"
import {
  nextPhotoImageRetryAttempt,
  photoImageSourceForRetry,
} from "@/lib/photos/image-retry"
import type { ProjectPhotoLibraryItem } from "@/app/actions/project-photos"

type PhotoImage = {
  /** The resolved source and its fallback label. */
  readonly resolvedImage: ReturnType<typeof resolvePhotoImageSource>
  readonly retryAttempt: number
  /** The image URL to show, or null when it failed or there is none. */
  readonly imageSrc: string | null
}

export type PhotoImageRetry = {
  readonly imageFor: (photo: ProjectPhotoLibraryItem) => PhotoImage
  readonly markImageFailed: (photoId: string) => void
}

/** Retries a failed photo image a few times, then shows its fallback. */
export function usePhotoImageRetry(projectId: string): PhotoImageRetry {
  const [failedImageIds, setFailedImageIds] = React.useState<readonly string[]>(
    []
  )
  const [imageRetryAttempts, setImageRetryAttempts] = React.useState<
    Readonly<Record<string, number>>
  >({})
  const imageRetryAttemptsRef = React.useRef<Record<string, number>>({})
  const imageRetryTimersRef = React.useRef<Record<string, number>>({})

  React.useEffect(
    () => () => {
      for (const timerId of Object.values(imageRetryTimersRef.current)) {
        window.clearTimeout(timerId)
      }
    },
    []
  )

  const failedImageSet = React.useMemo(
    () => new Set(failedImageIds),
    [failedImageIds]
  )

  function markImageFailed(photoId: string): void {
    if (imageRetryTimersRef.current[photoId] !== undefined) return
    const currentAttempt = imageRetryAttemptsRef.current[photoId] ?? 0
    const nextAttempt = nextPhotoImageRetryAttempt(currentAttempt)
    if (nextAttempt === null) {
      setFailedImageIds((current) => {
        if (current.includes(photoId)) return current
        return [...current, photoId]
      })
      return
    }

    imageRetryAttemptsRef.current[photoId] = nextAttempt
    imageRetryTimersRef.current[photoId] = window.setTimeout(
      () => {
        delete imageRetryTimersRef.current[photoId]
        setImageRetryAttempts((current) => ({
          ...current,
          [photoId]: nextAttempt,
        }))
      },
      250 * nextAttempt
    )
  }

  function imageFor(photo: ProjectPhotoLibraryItem): PhotoImage {
    const resolvedImage = resolvePhotoImageSource({
      ...photo,
      thumbnailUrl: projectInternalPhotoUrl(projectId, photo.id),
    })
    const retryAttempt = imageRetryAttempts[photo.id] ?? 0
    const imageSrc =
      failedImageSet.has(photo.id) || resolvedImage.src === null
        ? null
        : photoImageSourceForRetry(resolvedImage.src, retryAttempt)
    return { resolvedImage, retryAttempt, imageSrc }
  }

  return { imageFor, markImageFailed }
}
