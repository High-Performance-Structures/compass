import type { DriveClient } from "@/lib/google/client/drive-client"
import { mapDriveFileToFileItem } from "@/lib/google/mapper"
import type { FileItem } from "@/lib/files-data"
import {
  PROJECT_FILE_SOURCES,
  getProjectFolderMatch,
  isProjectFolderName,
  withProjectFileSource,
  withProjectFolderMetadata,
} from "@/lib/project-files"

/*
 * Listings the Files page builds from several Drive calls: the business-line
 * project roots pinned at the top of "My Drive" and "Shared", and the
 * "Projects" view of every job folder under those roots.
 * PROJECT_FILE_SOURCES (src/lib/project-files.ts) lists the roots.
 */

/** The project roots themselves, as files to pin above a listing. */
export async function listProjectSourceFileItems(
  client: DriveClient,
  googleEmail: string,
  starredIds: ReadonlySet<string>
): Promise<FileItem[]> {
  const files: FileItem[] = []

  for (const source of PROJECT_FILE_SOURCES) {
    try {
      const driveFile = await client.getFile(
        googleEmail,
        source.folderId
      )
      files.push(
        withProjectFileSource(
          mapDriveFileToFileItem(driveFile, starredIds, null),
          source
        )
      )
    } catch {
      files.push({
        id: source.folderId,
        name: source.label,
        type: "folder",
        size: 0,
        path: [],
        createdAt: "2026-04-06T00:00:00.000Z",
        modifiedAt: "2026-04-06T00:00:00.000Z",
        owner: { name: "HPS" },
        starred: false,
        shared: true,
        trashed: false,
        parentId: null,
        webViewLink: `https://drive.google.com/drive/folders/${source.folderId}`,
        projectFile: {
          kind: "source",
          sourceKey: source.key,
          sourceLabel: source.label,
        },
      })
    }
  }

  return files
}

/** Pinned items first; a file in both lists appears once. */
export function mergePinnedProjectSources(
  files: FileItem[],
  pinnedSources: FileItem[]
): FileItem[] {
  const seen = new Set<string>()
  const merged: FileItem[] = []

  for (const file of [...pinnedSources, ...files]) {
    if (seen.has(file.id)) continue
    seen.add(file.id)
    merged.push(file)
  }

  return merged
}

/**
 * Every job folder under every project root. One unreadable root is skipped;
 * only when all of them fail does the first error surface.
 */
export async function listProjectDriveFolders(
  client: DriveClient,
  googleEmail: string,
  starredIds: ReadonlySet<string>
): Promise<FileItem[]> {
  const projectFolders: FileItem[] = []
  const errors: string[] = []

  for (const source of PROJECT_FILE_SOURCES) {
    try {
      let pageToken: string | undefined

      do {
        const result = await client.listFiles(googleEmail, {
          folderId: source.folderId,
          query: "mimeType = 'application/vnd.google-apps.folder'",
          orderBy: "modifiedTime desc",
          pageSize: 100,
          pageToken,
        })

        for (const driveFile of result.files) {
          if (!isProjectFolderName(driveFile.name)) continue
          const match = getProjectFolderMatch(driveFile.name)
          if (!match || match.source.key !== source.key) continue

          projectFolders.push(
            withProjectFolderMetadata(
              mapDriveFileToFileItem(
                driveFile,
                starredIds,
                source.folderId
              ),
              match
            )
          )
        }

        pageToken = result.nextPageToken ?? undefined
      } while (pageToken)
    } catch (err) {
      errors.push(
        err instanceof Error ? err.message : "Unknown Drive error"
      )
      // A missing business-line root should not prevent other roots
      // from loading.
    }
  }

  if (
    projectFolders.length === 0 &&
    errors.length === PROJECT_FILE_SOURCES.length
  ) {
    throw new Error(errors[0])
  }

  return projectFolders
}
