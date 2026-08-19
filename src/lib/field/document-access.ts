import type { DriveFile } from "@/lib/google/client/types"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

export const FIELD_DOCUMENT_ROOT_FOLDER_NAMES = [
  "04_PermittedPlansSpecifications",
  "05_SelectionsFinishes",
] as const

const FIELD_DOCUMENT_ROOT_FOLDER_NAME_SET = new Set<string>(
  FIELD_DOCUMENT_ROOT_FOLDER_NAMES
)

export function isFieldDocumentRootFolder(file: DriveFile): boolean {
  return (
    file.mimeType === GOOGLE_FOLDER_MIME_TYPE &&
    FIELD_DOCUMENT_ROOT_FOLDER_NAME_SET.has(file.name)
  )
}

export function filterFieldDocumentRootFolders(
  files: readonly DriveFile[]
): readonly DriveFile[] {
  return files.filter(isFieldDocumentRootFolder)
}
