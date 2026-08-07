export const MAX_PROJECT_VIDEO_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024
export const PROJECT_VIDEO_UPLOAD_LIMIT_LABEL = "10 GB"

const VIDEO_FILE_EXTENSION = /\.(?:3g2|3gp|avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/i

export function isProjectVideoFile(input: {
  readonly fileName: string
  readonly mimeType: string
}): boolean {
  return input.mimeType.startsWith("video/") || VIDEO_FILE_EXTENSION.test(input.fileName)
}

export function projectVideoMimeType(input: {
  readonly fileName: string
  readonly mimeType: string
}): string {
  if (input.mimeType.startsWith("video/")) return input.mimeType
  if (/\.mov$/i.test(input.fileName)) return "video/quicktime"
  if (/\.webm$/i.test(input.fileName)) return "video/webm"
  return "video/mp4"
}
