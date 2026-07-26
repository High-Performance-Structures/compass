export interface PhotoCarouselItem {
  readonly id: string
}

export type PhotoCarouselDirection = "previous" | "next"

export function adjacentPhoto<T extends PhotoCarouselItem>(
  photos: readonly T[],
  activePhotoId: string,
  direction: PhotoCarouselDirection
): T | null {
  if (photos.length === 0) return null

  const activeIndex = photos.findIndex((photo) => photo.id === activePhotoId)
  if (activeIndex < 0) return null

  const offset = direction === "next" ? 1 : -1
  const nextIndex = (activeIndex + offset + photos.length) % photos.length
  return photos[nextIndex] ?? null
}
