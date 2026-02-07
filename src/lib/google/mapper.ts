// maps google drive API responses to our FileItem type

import type { FileItem, FileType, SharedUser, SharedRole } from "@/lib/files-data"
import type { DriveFile } from "./client/types"

const GOOGLE_APPS_FOLDER = "application/vnd.google-apps.folder"
const GOOGLE_APPS_DOCUMENT = "application/vnd.google-apps.document"
const GOOGLE_APPS_SPREADSHEET =
  "application/vnd.google-apps.spreadsheet"
const GOOGLE_APPS_PRESENTATION =
  "application/vnd.google-apps.presentation"

function mimeTypeToFileType(mimeType: string): FileType {
  if (mimeType === GOOGLE_APPS_FOLDER) return "folder"
  if (mimeType === GOOGLE_APPS_DOCUMENT) return "document"
  if (mimeType === GOOGLE_APPS_SPREADSHEET)
    return "spreadsheet"
  if (mimeType === GOOGLE_APPS_PRESENTATION)
    return "document"
  if (mimeType === "application/pdf") return "pdf"
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  if (
    mimeType.includes("zip") ||
    mimeType.includes("compressed") ||
    mimeType.includes("archive") ||
    mimeType.includes("tar") ||
    mimeType.includes("gzip")
  )
    return "archive"
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType === "text/csv"
  )
    return "spreadsheet"
  if (
    mimeType.includes("document") ||
    mimeType.includes("word") ||
    mimeType === "text/plain" ||
    mimeType === "text/rtf"
  )
    return "document"
  if (
    mimeType.includes("javascript") ||
    mimeType.includes("json") ||
    mimeType.includes("xml") ||
    mimeType.includes("html") ||
    mimeType.includes("css") ||
    mimeType.includes("typescript")
  )
    return "code"
  return "unknown"
}

function mapPermissionRole(role: string): SharedRole {
  if (role === "writer" || role === "owner") return "editor"
  return "viewer"
}

export function mapDriveFileToFileItem(
  driveFile: DriveFile,
  starredIds: ReadonlySet<string>,
  parentId: string | null = null
): FileItem {
  const owner = driveFile.owners?.[0]
  const sharedWith: SharedUser[] = (
    driveFile.permissions ?? []
  )
    .filter(p => p.role !== "owner" && p.type === "user")
    .map(p => ({
      name: p.displayName ?? p.emailAddress ?? "Unknown",
      avatar: p.photoLink,
      role: mapPermissionRole(p.role),
    }))

  return {
    id: driveFile.id,
    name: driveFile.name,
    type: mimeTypeToFileType(driveFile.mimeType),
    mimeType: driveFile.mimeType,
    size: driveFile.size ? Number(driveFile.size) : 0,
    path: [],
    createdAt: driveFile.createdTime ?? new Date().toISOString(),
    modifiedAt:
      driveFile.modifiedTime ?? new Date().toISOString(),
    owner: {
      name: owner?.displayName ?? "Unknown",
      avatar: owner?.photoLink,
    },
    starred: starredIds.has(driveFile.id),
    shared: sharedWith.length > 0 || driveFile.shared === true,
    sharedWith:
      sharedWith.length > 0 ? sharedWith : undefined,
    trashed: driveFile.trashed ?? false,
    parentId,
    webViewLink: driveFile.webViewLink,
  }
}

// export types for google-native files
export function isGoogleNativeFile(mimeType: string): boolean {
  return mimeType.startsWith("application/vnd.google-apps.")
}

export function getExportMimeType(
  googleMimeType: string
): string | null {
  switch (googleMimeType) {
    case GOOGLE_APPS_DOCUMENT:
      return "application/pdf"
    case GOOGLE_APPS_SPREADSHEET:
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    case GOOGLE_APPS_PRESENTATION:
      return "application/pdf"
    default:
      return null
  }
}

export function getExportExtension(
  googleMimeType: string
): string {
  switch (googleMimeType) {
    case GOOGLE_APPS_DOCUMENT:
      return ".pdf"
    case GOOGLE_APPS_SPREADSHEET:
      return ".xlsx"
    case GOOGLE_APPS_PRESENTATION:
      return ".pdf"
    default:
      return ""
  }
}
