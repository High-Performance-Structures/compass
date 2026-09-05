import type { DriveFile } from "@/lib/google/client/types"
import { isPublishableProjectDocumentMimeType } from "@/lib/project-documents"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const MAX_FOLDER_PUBLISH_DOCUMENTS = 100
const MAX_FOLDER_SCAN_ITEMS = 500

export async function collectPublishableProjectDocumentFolderFiles(input: {
  readonly folderId: string
  readonly listFolderItems: (
    folderId: string
  ) => Promise<readonly DriveFile[]>
}): Promise<{
  readonly files: readonly DriveFile[]
  readonly unsupportedCount: number
}> {
  const pendingFolderIds = [input.folderId]
  const visitedFolderIds = new Set<string>()
  const visitedFileIds = new Set<string>()
  const files: DriveFile[] = []
  let scannedItemCount = 0
  let unsupportedCount = 0

  while (pendingFolderIds.length > 0) {
    const folderId = pendingFolderIds.shift()
    if (!folderId || visitedFolderIds.has(folderId)) continue
    visitedFolderIds.add(folderId)
    const items = await input.listFolderItems(folderId)
    for (const item of items) {
      scannedItemCount += 1
      if (scannedItemCount > MAX_FOLDER_SCAN_ITEMS) {
        throw new Error(
          `That folder contains more than ${MAX_FOLDER_SCAN_ITEMS} items. Publish a smaller folder.`
        )
      }
      if (item.mimeType === GOOGLE_FOLDER_MIME_TYPE) {
        pendingFolderIds.push(item.id)
        continue
      }
      if (!isPublishableProjectDocumentMimeType(item.mimeType)) {
        unsupportedCount += 1
        continue
      }
      if (visitedFileIds.has(item.id)) continue
      visitedFileIds.add(item.id)
      files.push(item)
      if (files.length > MAX_FOLDER_PUBLISH_DOCUMENTS) {
        throw new Error(
          `That folder contains more than ${MAX_FOLDER_PUBLISH_DOCUMENTS} downloadable documents. Publish a smaller folder.`
        )
      }
    }
  }

  return { files, unsupportedCount }
}
