import {
  projectAudienceOwnerUpdateDocumentUrl,
  projectAudiencePhotoUrl,
} from "@/lib/photo-sources"

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
    /(?<![A-Za-z0-9])[A-Za-z0-9]{11}(?![A-Za-z0-9])/.test(value) ||
    /(?<![A-Za-z0-9])[A-Za-z0-9]{20,}(?![A-Za-z0-9])/.test(value)
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

export function safeCompassId(value: string): string {
  const trimmed = value.trim()
  const isCompassUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed
    )
  return trimmed.length > 0 &&
    (isCompassUuid ||
      (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(trimmed) &&
        trimmed.length <= 80 &&
        !containsProviderCapability(trimmed)))
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

function safeExternalDate(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(trimmed)
    ? trimmed.slice(0, 10)
    : null
}

function safeExternalTimestamp(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0 || Number.isNaN(Date.parse(trimmed))) return null
  return trimmed
}

function safeExternalTextOrFallback(value: string | null, fallback: string): string {
  return safeExternalText(value) ?? fallback
}

function safeExternalStatus(value: string): "published" | "sent" {
  return value === "sent" ? "sent" : "published"
}

function safeExternalChannel(value: string): string {
  return ["compass", "email", "sms"].includes(value) ? value : "compass"
}

export type OwnerUpdateExternalListItemInput = {
  readonly id: string
  readonly title: string
  readonly updateDate: string
  readonly status: string
  readonly channel: string
  readonly summary: string
  readonly publishedAt: string | null
  readonly sentAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type OwnerUpdateExternalListItem = {
  readonly id: string
  readonly title: string
  readonly updateDate: string
  readonly status: "published" | "sent"
  readonly channel: string
  readonly summary: string
  readonly publishedAt: string | null
  readonly sentAt: null
  readonly createdAt: ""
  readonly updatedAt: ""
}

export function ownerUpdateExternalListItem(
  update: OwnerUpdateExternalListItemInput
): OwnerUpdateExternalListItem {
  return {
    id: safeCompassId(update.id),
    title: safeExternalTextOrFallback(update.title, "Owner update"),
    updateDate: safeExternalDate(update.updateDate) ?? "1970-01-01",
    status: safeExternalStatus(update.status),
    channel: safeExternalChannel(update.channel),
    summary: safeExternalTextOrFallback(update.summary, "No summary provided."),
    publishedAt: safeExternalTimestamp(update.publishedAt),
    sentAt: null,
    createdAt: "",
    updatedAt: "",
  }
}

export type OwnerUpdateExternalUpdateInput = OwnerUpdateExternalListItemInput & {
  readonly recalledAt: string | null
  readonly revision: number
  readonly periodStart: string | null
  readonly periodEnd: string | null
}

export type OwnerUpdateExternalUpdate = OwnerUpdateExternalListItem & {
  readonly recalledAt: null
  readonly revision: 0
  readonly periodStart: string | null
  readonly periodEnd: string | null
}

export function ownerUpdateExternalUpdate(
  update: OwnerUpdateExternalUpdateInput
): OwnerUpdateExternalUpdate {
  const listItem = ownerUpdateExternalListItem(update)
  return {
    id: listItem.id,
    title: listItem.title,
    updateDate: listItem.updateDate,
    status: listItem.status,
    channel: listItem.channel,
    summary: listItem.summary,
    publishedAt: listItem.publishedAt,
    sentAt: null,
    recalledAt: null,
    revision: 0,
    updatedAt: "",
    createdAt: "",
    periodStart: safeExternalDate(update.periodStart),
    periodEnd: safeExternalDate(update.periodEnd),
  }
}

export type OwnerUpdateExternalProjectInput = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly address: string | null
  readonly clientName: string | null
  readonly projectManager: string | null
}

export type OwnerUpdateExternalProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly address: string | null
  readonly clientName: string | null
  readonly projectManager: null
}

export function ownerUpdateExternalProject(
  project: OwnerUpdateExternalProjectInput
): OwnerUpdateExternalProject {
  return {
    id: safeCompassId(project.id),
    name: safeExternalTextOrFallback(project.name, "Project"),
    projectNumber: safeExternalText(project.projectNumber),
    address: safeExternalText(project.address),
    clientName: safeExternalText(project.clientName),
    projectManager: null,
  }
}

export type OwnerUpdateExternalDailyLogInput = {
  readonly id: string
  readonly sourceSystem: string
  readonly logDate: string
  readonly workCompleted: string
  readonly weather: string | null
  readonly manpower: string | null
  readonly safetyNotes: string | null
  readonly issues: string | null
  readonly nextSteps: string | null
  readonly authorName: string | null
  readonly reviewStatus: string
  readonly isClientVisible: boolean
}

export type OwnerUpdateExternalDailyLog = {
  readonly id: string
  readonly sourceSystem: "Compass"
  readonly logDate: string
  readonly workCompleted: string
  readonly weather: string | null
  readonly manpower: string | null
  readonly safetyNotes: string | null
  readonly issues: string | null
  readonly nextSteps: string | null
  readonly authorName: string | null
  readonly reviewStatus: "approved"
  readonly isClientVisible: true
}

export function ownerUpdateExternalDailyLog(
  log: OwnerUpdateExternalDailyLogInput
): OwnerUpdateExternalDailyLog {
  return {
    id: safeCompassId(log.id),
    sourceSystem: "Compass",
    logDate: safeExternalDate(log.logDate) ?? "1970-01-01",
    workCompleted: safeExternalTextOrFallback(
      log.workCompleted,
      "No work details provided."
    ),
    weather: safeExternalText(log.weather),
    manpower: safeExternalText(log.manpower),
    safetyNotes: safeExternalText(log.safetyNotes),
    issues: safeExternalText(log.issues),
    nextSteps: safeExternalText(log.nextSteps),
    authorName: safeExternalText(log.authorName),
    reviewStatus: "approved",
    isClientVisible: true,
  }
}

export type OwnerUpdateExternalScheduleInput = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly status: string
  readonly percentComplete: number
  readonly notes: string
}

export type OwnerUpdateExternalSchedule = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly status: "COMPLETED" | "PENDING"
  readonly percentComplete: 0 | 100
  readonly notes: string
}

export function ownerUpdateExternalSchedule(
  item: OwnerUpdateExternalScheduleInput,
  index: number,
  completed: boolean
): OwnerUpdateExternalSchedule {
  return {
    id: safeCompassId(item.id) || `schedule-${index}`,
    title: safeExternalTextOrFallback(item.title, "Schedule item"),
    startDate: safeExternalDate(item.startDate) ?? "1970-01-01",
    endDate: safeExternalDate(item.endDate) ?? "1970-01-01",
    assignedTo: safeExternalText(item.assignedTo),
    status: completed ? "COMPLETED" : "PENDING",
    percentComplete: completed ? 100 : 0,
    notes: safeExternalText(item.notes) ?? "",
  }
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
    capturedAt: safeExternalDate(photo.capturedAt),
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
    compassUrl: projectAudienceOwnerUpdateDocumentUrl(projectId, id, "owner"),
    caption: safeExternalText(document.caption),
    capturedAt: safeExternalDate(document.capturedAt),
    sourceSystem: "Compass",
  }
}
