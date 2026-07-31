import type { FileUIPart } from "@/components/ai/types"

export const JARVIS_VISUAL_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type JarvisVisualMediaType =
  (typeof JARVIS_VISUAL_MEDIA_TYPES)[number]

export type JarvisVisualAttachment = {
  readonly filename: string
  readonly mediaType: JarvisVisualMediaType
  readonly dataUrl: string
}

export const MAX_JARVIS_VISUALS = 2
export const MAX_JARVIS_VISUAL_DATA_URL_CHARACTERS = 700_000
const MAX_VISUAL_DIMENSION = 1_600

export function isJarvisVisualMediaType(
  value: string,
): value is JarvisVisualMediaType {
  return JARVIS_VISUAL_MEDIA_TYPES.some((mediaType) => mediaType === value)
}

function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("The selected image could not be read."))
    image.src = url
  })
}

function scaledDimensions(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const largestDimension = Math.max(width, height)
  if (largestDimension <= MAX_VISUAL_DIMENSION) return { width, height }

  const scale = MAX_VISUAL_DIMENSION / largestDimension
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function compressedDataUrl(file: FileUIPart): Promise<string> {
  if (
    isJarvisVisualMediaType(file.mediaType) &&
    file.url.length <= MAX_JARVIS_VISUAL_DATA_URL_CHARACTERS
  ) {
    return file.url
  }

  const image = await imageFromUrl(file.url)
  const dimensions = scaledDimensions(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement("canvas")
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("This browser cannot prepare the selected screenshot.")
  }
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height)

  for (const quality of [0.84, 0.72, 0.6, 0.48]) {
    const candidate = canvas.toDataURL("image/webp", quality)
    if (candidate.length <= MAX_JARVIS_VISUAL_DATA_URL_CHARACTERS) {
      return candidate
    }
  }

  throw new Error(
    "That image is still too large after optimization. Crop it or attach a smaller screenshot.",
  )
}

export async function prepareJarvisVisuals(
  files: readonly FileUIPart[],
): Promise<readonly JarvisVisualAttachment[]> {
  if (files.length > MAX_JARVIS_VISUALS) {
    throw new Error(`Attach no more than ${MAX_JARVIS_VISUALS} images at once.`)
  }

  const visuals: JarvisVisualAttachment[] = []
  for (const file of files) {
    if (!file.mediaType.startsWith("image/")) {
      throw new Error("Jarvis currently accepts image attachments only.")
    }
    const dataUrl = await compressedDataUrl(file)
    const mediaType = dataUrl.startsWith("data:image/webp;")
      ? "image/webp"
      : file.mediaType
    if (!isJarvisVisualMediaType(mediaType)) {
      throw new Error("Use a PNG, JPEG, or WebP image.")
    }
    visuals.push({
      filename: file.filename?.trim() || "compass-screenshot",
      mediaType,
      dataUrl,
    })
  }

  return visuals
}
