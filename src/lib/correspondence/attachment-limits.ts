export const MAX_CORRESPONDENCE_ATTACHMENTS = 10
export const MAX_CORRESPONDENCE_FILE_BYTES = 25 * 1024 * 1024
export const MAX_CORRESPONDENCE_TOTAL_BYTES = 50 * 1024 * 1024
// Leave room for MIME encoding and the message body within mail-provider limits.
export const MAX_PROJECT_EMAIL_ATTACHMENT_BYTES = 18 * 1024 * 1024

export async function boundedAttachmentBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new Error("The attachment could not be downloaded.")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > limit) throw new Error("The attachment exceeds the size limit.")
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
