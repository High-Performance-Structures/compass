import { NextRequest } from "next/server"
import { getCloudflareContext } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { getDb } from "@/db"
import { projects, users } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { eq } from "drizzle-orm"
import { decrypt } from "@/lib/crypto"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  isGoogleNativeFile,
  getExportMimeType,
  getExportExtension,
} from "@/lib/google/mapper"
import { assertProjectAccess } from "@/lib/project-access"
import { isDriveItemWithinProjectFolder } from "@/lib/google/project-folder-boundary"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
): Promise<Response> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "read")

    let googleEmail = user.googleEmail ?? user.email
    const projectId = request.nextUrl.searchParams.get("projectId")
    let allowedParentId: string | null = null

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)

    const auth = await db
      .select()
      .from(googleAuth)
      .limit(1)
      .then(rows => rows[0] ?? null)
    if (!auth) {
      return new Response("Google Drive not connected", {
        status: 404,
      })
    }

    if (projectId) {
      await assertProjectAccess(db, user, projectId)
      const project = await db
        .select({ folderId: projects.googleDriveFolderId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)
        .then((rows) => rows[0] ?? null)
      if (!project?.folderId) {
        return new Response("Project folder is not mapped", { status: 404 })
      }

      const connectedBy = await db
        .select({ email: users.email, googleEmail: users.googleEmail })
        .from(users)
        .where(eq(users.id, auth.connectedBy))
        .limit(1)
        .then((rows) => rows[0] ?? null)
      if (!connectedBy) {
        return new Response("Google Drive connection owner not found", {
          status: 503,
        })
      }
      googleEmail = connectedBy.googleEmail ?? connectedBy.email
      allowedParentId = project.folderId
    }

    const keyJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey,
      getGoogleCryptoSalt()
    )
    const serviceAccountKey = parseServiceAccountKey(keyJson)
    const client = new DriveClient({ serviceAccountKey })

    const { fileId } = await params

    // get file metadata to determine type
    const fileMeta = await client.getFile(
      googleEmail,
      fileId
    )
    if (allowedParentId) {
      const withinProject = await isDriveItemWithinProjectFolder({
        client,
        googleEmail,
        itemId: fileId,
        projectFolderId: allowedParentId,
      })
      if (!withinProject) {
        return new Response("Document is outside the selected project", {
          status: 403,
        })
      }
    }

    let response: Response
    let fileName = fileMeta.name
    let contentType: string

    if (isGoogleNativeFile(fileMeta.mimeType)) {
      const exportMime = getExportMimeType(fileMeta.mimeType)
      if (!exportMime) {
        return new Response("Cannot export this file type", {
          status: 400,
        })
      }
      const ext = getExportExtension(fileMeta.mimeType)
      fileName = `${fileMeta.name}${ext}`
      contentType = exportMime
      response = await client.exportFile(
        googleEmail,
        fileId,
        exportMime
      )
    } else {
      contentType = fileMeta.mimeType
      response = await client.downloadFile(
        googleEmail,
        fileId
      )
    }

    if (!response.ok) {
      return new Response("Failed to download file", {
        status: response.status,
      })
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (err) {
    console.error("Download error:", err)
    return new Response("Download failed", { status: 500 })
  }
}
