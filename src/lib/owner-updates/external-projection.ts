import { projectAudiencePhotoUrl } from "@/lib/photo-sources"

export type OwnerUpdateExternalPhotoInput = {
  readonly id: string
  readonly sourceSystem: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly reviewStatus: string
  readonly ownerVisible: boolean
}

export type OwnerUpdateExternalPhoto = Omit<
  OwnerUpdateExternalPhotoInput,
  "driveFileId" | "driveUrl" | "thumbnailUrl"
> & {
  readonly driveFileId: null
  readonly driveUrl: null
  readonly thumbnailUrl: string
}

export type OwnerUpdateExternalDocumentInput = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly sourceSystem: string
}

export type OwnerUpdateExternalDocument = Omit<
  OwnerUpdateExternalDocumentInput,
  "driveFileId" | "driveUrl"
> & {
  readonly driveFileId: null
  readonly driveUrl: null
  readonly compassUrl: string
}

const SAFE_MIME_TYPES = new Set([
  "application/pdf",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/png",
  "image/webp",
])

function containsProviderCapability(value: string): boolean {
  return (
    /(?:https?:)?\/\/(?:(?:[a-z0-9-]+\.)*(?:google\.com|googleusercontent\.com|youtube\.com|youtu\.be))(?:[/:?#]|$)/i.test(
      value
    ) ||
    /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{11}(?![A-Za-z0-9_-])/.test(value) ||
    /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/.test(value)
  )
}

function safeExternalText(value: string | null): string | null {
  if (value === null) return null
  const lines = value
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !containsProviderCapability(line))
  const result = lines.join("\n").trim()
  return result.length > 0 ? result : null
}

function safeCompassId(value: string): string {
  const trimmed = value.trim()
  const isCompassUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed
    )
  return trimmed.length > 0 &&
    (isCompassUuid ||
      (trimmed.length < 20 && !containsProviderCapability(trimmed)))
    ? trimmed
    : ""
}

function safeFileName(value: string, fallback: string): string {
  return safeExternalText(value) ?? fallback
}

function safeMimeType(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase() ?? ""
  return SAFE_MIME_TYPES.has(trimmed) ? trimmed : null
}

function safeCapturedAt(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(trimmed)
    ? trimmed.slice(0, 10)
    : null
}

export function selectCurrentOwnerVisibleDocuments<
  T extends {
    readonly id: string
    readonly reviewStatus: string
    readonly ownerVisible: boolean
  }
>(
  selectedIds: readonly string[],
  rows: readonly T[]
): readonly T[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  return selectedIds.flatMap((id) => {
    const row = rowsById.get(id)
    return row !== undefined &&
      row.reviewStatus === "approved" &&
      row.ownerVisible
      ? [row]
      : []
  })
}

export function ownerUpdateExternalPhoto(
  projectId: string,
  photo: OwnerUpdateExternalPhotoInput
): OwnerUpdateExternalPhoto {
  const id = safeCompassId(photo.id)
  return {
    id,
    sourceSystem: "Compass",
    fileName: safeFileName(photo.fileName, "Project photo"),
    mimeType: safeMimeType(photo.mimeType),
    driveFileId: null,
    driveUrl: null,
    thumbnailUrl: projectAudiencePhotoUrl(projectId, id, "owner"),
    caption: safeExternalText(photo.caption),
    capturedAt: safeCapturedAt(photo.capturedAt),
    reviewStatus: "approved",
    ownerVisible: true,
  }
}

export function ownerUpdateExternalDocument(
  projectId: string,
  document: OwnerUpdateExternalDocumentInput
): OwnerUpdateExternalDocument {
  const id = safeCompassId(document.id)
  return {
    id,
    fileName: safeFileName(document.fileName, "Project document"),
    mimeType: safeMimeType(document.mimeType),
    driveFileId: null,
    driveUrl: null,
    compassUrl: projectAudiencePhotoUrl(projectId, id, "owner"),
    caption: safeExternalText(document.caption),
    capturedAt: safeCapturedAt(document.capturedAt),
    sourceSystem: "Compass",
  }
}
