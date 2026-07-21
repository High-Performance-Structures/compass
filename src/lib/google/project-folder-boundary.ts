import type { DriveClient } from "@/lib/google/client/drive-client"

const MAX_PARENT_DEPTH = 50

export async function isDriveItemWithinProjectFolder({
  client,
  googleEmail,
  itemId,
  projectFolderId,
}: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly itemId: string
  readonly projectFolderId: string
}): Promise<boolean> {
  if (itemId === projectFolderId) return true

  const visited = new Set<string>()
  let currentId: string | null = itemId

  for (let depth = 0; depth < MAX_PARENT_DEPTH && currentId; depth += 1) {
    if (visited.has(currentId)) return false
    visited.add(currentId)

    const item = await client.getFile(googleEmail, currentId)
    const parentId = item.parents?.[0] ?? null
    if (!parentId) return false
    if (parentId === projectFolderId) return true
    currentId = parentId
  }

  return false
}
