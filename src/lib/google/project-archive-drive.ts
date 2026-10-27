import { PDFDocument } from "pdf-lib"
import type { DriveFile } from "@/lib/google/client/types"
import type { ProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import type { ArchiveDeliverySettings } from "@/lib/feature-settings/registry"

export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
export type ArchiveDrive = Pick<ProjectDocumentDriveContext, "googleEmail"> & {
  readonly client: Pick<ProjectDocumentDriveContext["client"], "getFile" | "listPermissions" | "downloadFile">
}

/** Walk to the actual root: an excluded master ancestor wins over a nearer delivery folder. */
export async function verifyArchiveBoundary(drive: ArchiveDrive, fileId: string, settings: ArchiveDeliverySettings): Promise<DriveFile> {
  if (!settings.deliveryRootIds.length || !settings.excludedMasterRootIds.length) throw new Error("Configure private archive delivery and excluded master folders first.")
  const seen = new Set<string>()
  let current: string | null = fileId
  let file: DriveFile | null = null
  let allowed = false
  for (let depth = 0; current && depth < 50; depth += 1) {
    if (seen.has(current) || settings.excludedMasterRootIds.includes(current)) throw new Error("Internal master folders cannot be delivered.")
    seen.add(current)
    const item = await drive.client.getFile(drive.googleEmail, current)
    if (item.trashed || item.driveId) throw new Error("Archive delivery requires a private My Drive folder.")
    const permissions = await drive.client.listPermissions(drive.googleEmail, current)
    if (!permissions.length || permissions.some((p) => p.type !== "user" || p.role !== "owner" || p.emailAddress?.toLowerCase() !== drive.googleEmail.toLowerCase())) throw new Error("Archive files and folders must be private to the connected account.")
    if (!file) file = item
    if (settings.deliveryRootIds.includes(current) && current !== fileId && item.mimeType === "application/vnd.google-apps.folder") allowed = true
    const parents = item.parents ?? []
    if (parents.length > 1) throw new Error("Archive folder ancestry is ambiguous.")
    current = parents[0] ?? null
  }
  if (current || !allowed || !file || file.mimeType !== "application/pdf") throw new Error("Choose a PDF inside an approved private delivery folder.")
  const bytes = Number(file.size)
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_ARCHIVE_BYTES) throw new Error("Archive PDFs must be no larger than 20 MB. Split large volumes before publishing.")
  return file
}

export async function readArchivePdf(drive: ArchiveDrive, fileId: string, settings: ArchiveDeliverySettings): Promise<{
  readonly bytes: Uint8Array<ArrayBuffer>; readonly fileName: string; readonly byteSize: number; readonly sha256: string; readonly pageCount: number
}> {
  const file = await verifyArchiveBoundary(drive, fileId, settings)
  const response = await drive.client.downloadFile(drive.googleEmail, fileId)
  if (!response.ok || !response.body) throw new Error("The archive PDF could not be read.")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > MAX_ARCHIVE_BYTES) { await reader.cancel(); throw new Error("Archive PDF exceeds the size limit.") }
    chunks.push(part.value)
  }
  if (size !== Number(file.size)) throw new Error("The archive changed while being read. Try again.")
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("The archive is not a PDF.")
  const document = await PDFDocument.load(bytes)
  const pageCount = document.getPageCount()
  if (pageCount < 1) throw new Error("The archive PDF is empty.")
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  return { bytes, fileName: file.name, byteSize: size, sha256, pageCount }
}
