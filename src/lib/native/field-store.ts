import { z } from "zod/v4"

import {
  fieldOutboxSchema,
  fieldProjectPacketSchema,
  fieldProjectSchema,
  fieldUserProfileSchema,
  type FieldOutboxItem,
  type FieldProject,
  type FieldProjectPacket,
  type FieldQueuedAttachment,
  type FieldUserProfile,
} from "@/lib/field/types"
import { isNative } from "@/lib/native/platform"

const PROJECTS_KEY = "compass_field_projects_v1"
const ACTIVE_PROJECT_KEY = "compass_field_active_project_v1"
const OUTBOX_KEY = "compass_field_outbox_v1"
const PACKET_PREFIX = "compass_field_packet_v1"
const DOCUMENTS_KEY = "compass_field_documents_v1"
const PROFILE_KEY = "compass_field_profile_v1"
const FIELD_ATTACHMENT_DIRECTORY = "compass-field-attachments"
export const MAX_FIELD_ATTACHMENT_BYTES = 50 * 1024 * 1024

const nativeDocumentSchema = z.object({
  projectId: z.string(),
  fileId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  path: z.string(),
  savedAt: z.string(),
})

const nativeDocumentsSchema = z.array(nativeDocumentSchema)

export type NativeFieldDocument = z.infer<typeof nativeDocumentSchema>

function packetKey(projectId: string): string {
  return `${PACKET_PREFIX}.${projectId}`
}

async function readJson(key: string): Promise<unknown> {
  const { Preferences } = await import("@capacitor/preferences")
  const result = await Preferences.get({ key })
  if (!result.value) return null
  try {
    return JSON.parse(result.value)
  } catch {
    return null
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  const { Preferences } = await import("@capacitor/preferences")
  await Preferences.set({ key, value: JSON.stringify(value) })
}

export async function cacheNativeFieldState(
  projects: readonly FieldProject[],
  packet: FieldProjectPacket
): Promise<void> {
  if (!isNative()) return
  await Promise.all([
    writeJson(PROJECTS_KEY, projects),
    writeJson(packetKey(packet.project.id), packet),
    writeJson(ACTIVE_PROJECT_KEY, packet.project.id),
  ])
}

export async function cacheNativeFieldProfile(
  profile: FieldUserProfile
): Promise<void> {
  if (!isNative()) return
  await writeJson(PROFILE_KEY, profile)
}

export async function readNativeFieldProfile(): Promise<FieldUserProfile | null> {
  if (!isNative()) return null
  const result = fieldUserProfileSchema.safeParse(await readJson(PROFILE_KEY))
  return result.success ? result.data : null
}

export async function readNativeFieldProjects(): Promise<readonly FieldProject[]> {
  if (!isNative()) return []
  const result = z.array(fieldProjectSchema).safeParse(await readJson(PROJECTS_KEY))
  return result.success ? result.data : []
}

export async function readNativeFieldPacket(
  projectId: string
): Promise<FieldProjectPacket | null> {
  if (!isNative()) return null
  const result = fieldProjectPacketSchema.safeParse(
    await readJson(packetKey(projectId))
  )
  return result.success ? result.data : null
}

export async function readNativeFieldOutbox(): Promise<readonly FieldOutboxItem[]> {
  if (!isNative()) return []
  const result = fieldOutboxSchema.safeParse(await readJson(OUTBOX_KEY))
  return result.success ? result.data : []
}

export async function addNativeFieldOutboxItem(
  item: FieldOutboxItem
): Promise<void> {
  if (!isNative()) return
  const existing = await readNativeFieldOutbox()
  if (existing.some((queued) => queued.id === item.id)) return
  await writeJson(OUTBOX_KEY, [...existing, item])
}

export async function replaceNativeFieldOutboxItem(
  item: FieldOutboxItem
): Promise<void> {
  if (!isNative()) return
  const existing = await readNativeFieldOutbox()
  await writeJson(OUTBOX_KEY, [
    ...existing.filter((queued) => queued.id !== item.id),
    item,
  ])
}

export async function removeNativeFieldOutboxItem(itemId: string): Promise<void> {
  if (!isNative()) return
  const existing = await readNativeFieldOutbox()
  await writeJson(
    OUTBOX_KEY,
    existing.filter((item) => item.id !== itemId)
  )
}

export async function readNativeFieldDocuments(): Promise<
  readonly NativeFieldDocument[]
> {
  if (!isNative()) return []
  const result = nativeDocumentsSchema.safeParse(await readJson(DOCUMENTS_KEY))
  return result.success ? result.data : []
}

function fileExtension(mimeType: string): string {
  if (mimeType === "application/pdf") return ".pdf"
  if (mimeType.includes("spreadsheet")) return ".xlsx"
  if (mimeType.includes("wordprocessingml")) return ".docx"
  if (mimeType.startsWith("image/jpeg")) return ".jpg"
  if (mimeType.startsWith("image/png")) return ".png"
  return ""
}

function safeFileName(name: string, mimeType: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  const extension = fileExtension(mimeType)
  if (!extension || cleaned.toLowerCase().endsWith(extension)) return cleaned
  return `${cleaned}${extension}`
}

function attachmentFileName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return cleaned.length > 0 ? cleaned : "field-attachment"
}

async function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`))
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      const base64 = value.split(",")[1] ?? ""
      if (base64.length === 0) reject(new Error(`${file.name} was empty.`))
      else resolve(base64)
    }
    reader.readAsDataURL(file)
  })
}

function base64Blob(value: string, mimeType: string): Blob {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

export async function saveNativeFieldAttachments(
  projectId: string,
  files: readonly File[]
): Promise<readonly FieldQueuedAttachment[]> {
  if (!isNative()) return []
  const { Directory, Filesystem } = await import("@capacitor/filesystem")
  const attachments: FieldQueuedAttachment[] = []

  for (const file of files) {
    if (file.size > MAX_FIELD_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} is larger than 50 MB.`)
    }
    const id = crypto.randomUUID()
    const path = `${FIELD_ATTACHMENT_DIRECTORY}/${projectId}/${id}-${attachmentFileName(file.name)}`
    await Filesystem.writeFile({
      path,
      data: await fileBase64(file),
      directory: Directory.Data,
      recursive: true,
    })
    attachments.push({
      id,
      localPath: path,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
      capturedAt: new Date().toISOString(),
    })
  }

  return attachments
}

export async function removeNativeFieldAttachment(
  attachment: FieldQueuedAttachment
): Promise<void> {
  if (!isNative()) return
  const { Directory, Filesystem } = await import("@capacitor/filesystem")
  await Filesystem.deleteFile({
    path: attachment.localPath,
    directory: Directory.Data,
  }).catch(() => undefined)
}

export async function uploadNativeFieldAttachment(input: {
  readonly projectId: string
  readonly dailyLogId: string
  readonly logDate: string
  readonly attachment: FieldQueuedAttachment
}): Promise<void> {
  if (!isNative()) {
    throw new Error("Native attachment storage is unavailable.")
  }
  const { Directory, Filesystem } = await import("@capacitor/filesystem")
  const result = await Filesystem.readFile({
    path: input.attachment.localPath,
    directory: Directory.Data,
  })
  const blob = typeof result.data === "string"
    ? base64Blob(result.data, input.attachment.mimeType)
    : result.data
  const file = new File([blob], input.attachment.fileName, {
    type: input.attachment.mimeType,
  })
  const formData = new FormData()
  formData.append("files", file)
  formData.set("dailyLogId", input.dailyLogId)
  formData.set("capturedDate", input.logDate)
  formData.set("photoKind", "progress")

  const response = await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/photos/upload`,
    { method: "POST", body: formData }
  )
  const responseBody: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof responseBody === "object" &&
      responseBody !== null &&
      "error" in responseBody &&
      typeof responseBody.error === "string"
        ? responseBody.error
        : `Unable to upload ${input.attachment.fileName}.`
    throw new Error(message)
  }

  await removeNativeFieldAttachment(input.attachment)
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Unable to read the downloaded file."))
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      const base64 = value.split(",")[1] ?? ""
      if (!base64) reject(new Error("The downloaded file was empty."))
      else resolve(base64)
    }
    reader.readAsDataURL(blob)
  })
}

export async function saveNativeFieldDocument(input: {
  readonly projectId: string
  readonly fileId: string
  readonly name: string
}): Promise<void> {
  if (!isNative()) return
  const url = `/api/google/download/${encodeURIComponent(input.fileId)}?projectId=${encodeURIComponent(input.projectId)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error("The document could not be downloaded.")

  const mimeType = response.headers.get("Content-Type") ?? "application/octet-stream"
  const blob = await response.blob()
  const data = await blobToBase64(blob)
  const path = `compass-field-documents/${input.projectId}/${safeFileName(input.name, mimeType)}`
  const { Directory, Filesystem } = await import("@capacitor/filesystem")
  await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Data,
    recursive: true,
  })

  const documents = await readNativeFieldDocuments()
  const nextDocument: NativeFieldDocument = {
    projectId: input.projectId,
    fileId: input.fileId,
    name: input.name,
    mimeType,
    path,
    savedAt: new Date().toISOString(),
  }
  await writeJson(DOCUMENTS_KEY, [
    ...documents.filter(
      (document) =>
        document.projectId !== input.projectId || document.fileId !== input.fileId
    ),
    nextDocument,
  ])
}

export async function openNativeFieldDocument(
  projectId: string,
  fileId: string
): Promise<boolean> {
  if (!isNative()) return false
  const document = (await readNativeFieldDocuments()).find(
    (item) => item.projectId === projectId && item.fileId === fileId
  )
  if (!document) return false

  const { Directory, Filesystem } = await import("@capacitor/filesystem")
  const { uri } = await Filesystem.getUri({
    path: document.path,
    directory: Directory.Data,
  })
  const { FileViewer } = await import("@capacitor/file-viewer")
  await FileViewer.openDocumentFromLocalPath({ path: uri })
  return true
}
