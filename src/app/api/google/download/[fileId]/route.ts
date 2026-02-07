import { NextRequest } from "next/server"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { getDb } from "@/db"
import { googleAuth } from "@/db/schema-google"
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
): Promise<Response> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "read")

    const googleEmail = user.googleEmail ?? user.email

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
