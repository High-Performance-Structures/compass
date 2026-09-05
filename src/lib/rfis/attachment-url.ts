export type RfiAttachmentUrlInput = {
  readonly storageUrl: string | null
  readonly storageStatus: string
}

/** Return only attachment URLs that Compass can still serve after cutover. */
export function viewableRfiAttachmentUrl(
  attachment: RfiAttachmentUrlInput
): string | null {
  const value = attachment.storageUrl?.trim() ?? ""
  if (
    value.length === 0 ||
    attachment.storageStatus === "source_reference_unavailable"
  ) {
    return null
  }

  try {
    const url = new URL(value, "https://compass.openrangeconstruction.ltd")
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    const hostname = url.hostname.toLowerCase()
    if (hostname === "buildertrend.net" || hostname.endsWith(".buildertrend.net")) {
      return null
    }
  } catch {
    return null
  }

  return value
}
