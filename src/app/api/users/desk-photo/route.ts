import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getDb } from "@/db"
import { organizationMembers, organizations, users } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { getCurrentUser } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { isDemoUser } from "@/lib/demo"
import { getCloudflareContext } from "@/lib/db"
import { DriveClient } from "@/lib/google/client/drive-client"
import type { DriveFile } from "@/lib/google/client/types"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  controlledDeskPhotoUrl,
  parseControlledDeskPhoto,
  type DeskPhotoSlot,
} from "@/lib/user-photo-storage"

function requestedSlot(value: string | null): DeskPhotoSlot | null {
  return value === "dashboard" || value === "sidebar" ? value : null
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  })
}

async function loadWorkspaceDrive(organizationId: string): Promise<{
  readonly client: DriveClient
  readonly googleEmail: string
  readonly driveId: string | null
}> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const auth = await db
    .select({
      serviceAccountKeyEncrypted: googleAuth.serviceAccountKeyEncrypted,
      sharedDriveId: googleAuth.sharedDriveId,
      connectorGoogleEmail: users.googleEmail,
      connectorEmail: users.email,
    })
    .from(googleAuth)
    .innerJoin(users, eq(users.id, googleAuth.connectedBy))
    .innerJoin(organizations, eq(organizations.id, googleAuth.organizationId))
    .where(
      and(
        eq(googleAuth.organizationId, organizationId),
        eq(organizations.isActive, true),
        eq(organizations.type, "internal")
      )
    )
    .limit(1)
    .get()

  if (!auth) throw new Error("Google Workspace storage is not connected")
  const driveId = auth.sharedDriveId?.trim()
  if (!driveId) throw new Error("A Shared Drive is required for workspace photos")

  const config = getGoogleConfig(env)
  const keyJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )

  return {
    client: new DriveClient({
      serviceAccountKey: parseServiceAccountKey(keyJson),
    }),
    googleEmail: auth.connectorGoogleEmail ?? auth.connectorEmail,
    driveId,
  }
}

function isOwnedWorkspacePhoto(
  metadata: DriveFile,
  input: {
    readonly organizationId: string
    readonly userId: string
    readonly slot: DeskPhotoSlot
    readonly driveId: string | null
  }
): boolean {
  const properties = metadata.appProperties
  return (
    metadata.trashed !== true &&
    (metadata.mimeType === "image/jpeg" ||
      metadata.mimeType === "image/png" ||
      metadata.mimeType === "image/webp") &&
    (!input.driveId ? !metadata.driveId : metadata.driveId === input.driveId) &&
    properties?.compassResource === "workspace-desk-photo" &&
    properties.organizationId === input.organizationId &&
    properties.userId === input.userId &&
    properties.slot === input.slot
  )
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getCurrentUser()
  if (
    !user ||
    isDemoUser(user.id) ||
    !isInternalStaffRole(user.role) ||
    !user.organizationId
  ) {
    return notFound()
  }

  const slot = requestedSlot(request.nextUrl.searchParams.get("slot"))
  const fileId = request.nextUrl.searchParams.get("file")
  if (!slot || !fileId || parseControlledDeskPhoto(
    controlledDeskPhotoUrl(slot, fileId),
    slot
  ) === null) {
    return notFound()
  }

  try {
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const photo = await db
      .select({
        value:
          slot === "dashboard"
            ? users.dashboardDeskPhotoUrl
            : users.sidebarDeskPhotoUrl,
        organizationId:
          slot === "dashboard"
            ? users.dashboardDeskPhotoOrganizationId
            : users.sidebarDeskPhotoOrganizationId,
      })
      .from(users)
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.userId, users.id),
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.role, user.role)
        )
      )
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId)
      )
      .where(
        and(
          eq(users.id, user.id),
          eq(users.isActive, true),
          eq(organizations.isActive, true),
          eq(organizations.type, "internal")
        )
      )
      .limit(1)
      .get()

    const expectedUrl = controlledDeskPhotoUrl(slot, fileId)
    if (photo?.value !== expectedUrl || photo.organizationId !== organizationId) {
      return notFound()
    }

    const drive = await loadWorkspaceDrive(organizationId)
    const metadata = await drive.client.getFile(drive.googleEmail, fileId)
    if (
      !isOwnedWorkspacePhoto(metadata, {
        organizationId,
        userId: user.id,
        slot,
        driveId: drive.driveId,
      })
    ) {
      return notFound()
    }

    const response = await drive.client.downloadFile(drive.googleEmail, fileId)
    if (!response.ok) return notFound()

    return new Response(response.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": metadata.mimeType,
        ...(metadata.size ? { "Content-Length": metadata.size } : {}),
      },
    })
  } catch (error: unknown) {
    console.error("Unable to load workspace photo", error)
    return notFound()
  }
}
