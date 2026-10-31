import type { DriveClient } from "@/lib/google/client/drive-client"
import type { DriveFile } from "@/lib/google/client/types"
import type { DriveFileForImport } from "@/lib/trade-docs/import-match"

const FOLDER_MIME = "application/vnd.google-apps.folder"
/** Enough for years of certificates; the scan says when it stopped short. */
const SCAN_FILE_LIMIT = 3000
const SCAN_DEPTH = 3

export type TradeDocFolderScan = {
  readonly folder: { readonly id: string; readonly name: string }
  readonly files: readonly DriveFileForImport[]
  readonly truncated: boolean
}

async function listAll(client: DriveClient, userEmail: string, folderId: string, driveId: string | null): Promise<readonly DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const page = await client.listFiles(userEmail, { folderId, pageSize: 1000, pageToken, driveId: driveId ?? undefined })
    files.push(...page.files)
    pageToken = page.nextPageToken
  } while (pageToken && files.length < SCAN_FILE_LIMIT)
  return files
}

/** Every file under a Drive folder, up to three folders deep, with its folder path. */
export async function scanTradeDocFolder(client: DriveClient, userEmail: string, folderId: string): Promise<TradeDocFolderScan> {
  const root = await client.getFile(userEmail, folderId)
  if (root.mimeType !== FOLDER_MIME) throw new Error("That link isn't a Drive folder.")
  const driveId = root.driveId ?? null
  const files: DriveFileForImport[] = []
  let truncated = false
  let level: { readonly id: string; readonly path: readonly string[] }[] = [{ id: root.id, path: [] }]
  for (let depth = 0; depth <= SCAN_DEPTH && level.length > 0; depth += 1) {
    const next: { readonly id: string; readonly path: readonly string[] }[] = []
    for (const folder of level) {
      for (const item of await listAll(client, userEmail, folder.id, driveId)) {
        if (item.mimeType === FOLDER_MIME) {
          if (depth < SCAN_DEPTH) next.push({ id: item.id, path: [...folder.path, item.name] })
          else truncated = true
          continue
        }
        if (files.length >= SCAN_FILE_LIMIT) {
          truncated = true
          break
        }
        files.push({
          id: item.id,
          name: item.name,
          mimeType: item.mimeType,
          modifiedTime: item.modifiedTime ?? null,
          webUrl: item.webViewLink ?? null,
          folderPath: folder.path,
        })
      }
    }
    level = next
  }
  return { folder: { id: root.id, name: root.name }, files, truncated }
}
