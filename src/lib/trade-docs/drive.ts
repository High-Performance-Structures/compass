import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { googleAuth } from "@/db/schema-google"
import { updateVendorById } from "@/lib/domain/contacts/store"
import type { AuthUser } from "@/lib/auth"
import type { DriveClient } from "@/lib/google/client/drive-client"
import type { DriveFile } from "@/lib/google/client/types"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"

const FOLDER_MIME = "application/vnd.google-apps.folder"

export type TradeDocsDrive = {
  readonly client: DriveClient
  readonly userEmail: string
  readonly folderId: string
  readonly driveId: string | null
}

/** A Drive folder name for a vendor; Drive allows most characters, but not '/'. */
function vendorFolderName(vendorName: string): string {
  return vendorName.replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Vendor"
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

/**
 * The vendor's trade docs folder in Drive, found or created under the folder
 * set in Settings → Trade docs (or the company's Drive root). An existing
 * folder with the vendor's name is reused, so files kept there before Compass
 * stay together.
 */
export async function ensureVendorTradeDocsFolder(input: {
  readonly db: ReturnType<typeof getDb>
  readonly environment: unknown
  readonly organizationId: string
  /** The staff member Drive acts as; for a vendor's docs link, whoever sent it. */
  readonly user: Pick<AuthUser, "email" | "googleEmail">
  readonly vendor: { readonly id: string; readonly name: string; readonly tradeDocsFolderId: string | null }
  readonly rootFolderId: string | null
}): Promise<TradeDocsDrive> {
  const drive = await getOrganizationDriveContext(input)
  const auth = await input.db
    .select({ sharedDriveId: googleAuth.sharedDriveId })
    .from(googleAuth)
    .where(eq(googleAuth.organizationId, input.organizationId))
    .get()
  const rootId = input.rootFolderId ?? auth?.sharedDriveId ?? null
  const root = rootId ? await drive.client.getFile(drive.userEmail, rootId) : null
  const driveId = root?.driveId ?? auth?.sharedDriveId ?? null

  if (input.vendor.tradeDocsFolderId) {
    const current = await drive.client.getFile(drive.userEmail, input.vendor.tradeDocsFolderId).catch(() => null)
    if (current && !current.trashed) {
      return { client: drive.client, userEmail: drive.userEmail, folderId: current.id, driveId: current.driveId ?? driveId }
    }
  }

  const name = vendorFolderName(input.vendor.name)
  const existing = root
    ? await drive.client.listFiles(drive.userEmail, {
        folderId: root.id,
        query: `mimeType = '${FOLDER_MIME}' and name = '${escapeQuery(name)}'`,
        pageSize: 5,
        driveId: driveId ?? undefined,
      })
    : null
  const found: DriveFile | undefined = existing?.files[0]
  const folder = found ?? (await drive.client.createFolder(drive.userEmail, {
    name,
    parentId: root?.id,
    driveId: driveId ?? undefined,
  }))
  await updateVendorById(input.db, {
    vendorId: input.vendor.id,
    values: { tradeDocsFolderId: folder.id, updatedAt: new Date().toISOString() },
  })
  return { client: drive.client, userEmail: drive.userEmail, folderId: folder.id, driveId }
}
