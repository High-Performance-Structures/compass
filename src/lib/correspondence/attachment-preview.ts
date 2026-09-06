export type AttachmentPreviewKind = "image" | "pdf" | "text" | "audio" | "video"

/** Only inert browser formats may be served inline; HTML, SVG and unknown files stay downloads. */
export function attachmentPreviewKind(
  contentType: string,
): AttachmentPreviewKind | null {
  const type = contentType.split(";")[0]?.trim().toLowerCase()
  if (
    [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/avif",
      "image/bmp",
    ].includes(type ?? "")
  )
    return "image"
  if (type === "application/pdf") return "pdf"
  if (type === "text/plain") return "text"
  if (
    [
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
      "audio/ogg",
      "audio/webm",
    ].includes(type ?? "")
  )
    return "audio"
  if (["video/mp4", "video/webm", "video/ogg"].includes(type ?? ""))
    return "video"
  return null
}
