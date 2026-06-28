export type PhotoSourceInput = {
  readonly thumbnailUrl: string | null
  readonly driveUrl?: string | null
  readonly driveFileId?: string | null
}

export type PhotoImageSource = {
  readonly src: string | null
  readonly reason: "ready" | "legacy_external" | "missing"
  readonly label: string
}

type PhotoLinkOptions = {
  readonly allowExternalSource?: boolean
}

function cleanUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://")
}

function isLocalRenderablePhotoUrl(value: string): boolean {
  return (
    value.startsWith("/api/google/download/") ||
    value.startsWith("/owner-update-photos/") ||
    value.startsWith("/project-photo-previews/")
  )
}

export function googleDriveDownloadUrl(fileId: string): string {
  return `/api/google/download/${encodeURIComponent(fileId)}`
}

export function isLegacyExternalPhotoUrl(value: string): boolean {
  if (!isHttpUrl(value)) return false

  try {
    const host = new URL(value).hostname.toLowerCase()
    return (
      host === "buildertrend.net" ||
      host.endsWith(".buildertrend.net") ||
      host === "buildertrend.com" ||
      host.endsWith(".buildertrend.com")
    )
  } catch {
    return false
  }
}

export function resolvePhotoImageSource(
  input: PhotoSourceInput
): PhotoImageSource {
  const thumbnailUrl = cleanUrl(input.thumbnailUrl)
  const driveUrl = cleanUrl(input.driveUrl)
  const driveFileId = cleanUrl(input.driveFileId)

  if (thumbnailUrl !== null) {
    if (isLocalRenderablePhotoUrl(thumbnailUrl)) {
      return { src: thumbnailUrl, reason: "ready", label: "Photo preview" }
    }

    if (isHttpUrl(thumbnailUrl) && !isLegacyExternalPhotoUrl(thumbnailUrl)) {
      return { src: thumbnailUrl, reason: "ready", label: "Photo preview" }
    }
  }

  if (driveFileId !== null) {
    return {
      src: googleDriveDownloadUrl(driveFileId),
      reason: "ready",
      label: "Photo preview",
    }
  }

  if (driveUrl !== null && isLocalRenderablePhotoUrl(driveUrl)) {
    return { src: driveUrl, reason: "ready", label: "Photo preview" }
  }

  if (
    (thumbnailUrl !== null && isLegacyExternalPhotoUrl(thumbnailUrl)) ||
    (driveUrl !== null && isLegacyExternalPhotoUrl(driveUrl))
  ) {
    return {
      src: null,
      reason: "legacy_external",
      label: "Needs Drive import",
    }
  }

  return { src: null, reason: "missing", label: "No preview" }
}

export function photoLinkHref(
  value: string | null | undefined,
  options: PhotoLinkOptions = {}
): string | null {
  const url = cleanUrl(value)
  if (url === null) return null
  if (isLocalRenderablePhotoUrl(url)) return url
  if (isHttpUrl(url)) return options.allowExternalSource === true ? url : null
  return null
}
