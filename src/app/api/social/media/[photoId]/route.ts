import { and, eq } from "drizzle-orm"
import { type NextRequest } from "next/server"

import { getDb } from "@/db"
import { dailyLogPhotos, projects } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { DriveClient } from "@/lib/google/client/drive-client"
import { getGoogleCryptoSalt, parseServiceAccountKey } from "@/lib/google/config"
import { environmentString, getSocialConfig } from "@/lib/social/config"
import {
  isSupportedSocialImageMimeType,
  normalizeSocialImageMimeType,
  sanitizeSocialImage,
} from "@/lib/social/image-sanitization"
import { verifySignedSocialPhoto } from "@/lib/social/media-signing"

const DEFAULT_DOWNLOAD_USER = "compass@hps-colorado.com"

function safeFileName(value: string): string {
  return value.replace(/["\r\n]/g, "_")
}

export async function GET(
  request: NextRequest,
  { params }: { readonly params: Promise<{ readonly photoId: string }> },
): Promise<Response> {
  try {
    const { photoId } = await params
    const { env } = await getCloudflareContext()
    const config = getSocialConfig(env, request.url)
    const valid = await verifySignedSocialPhoto({
      photoId,
      expires: request.nextUrl.searchParams.get("expires"),
      providedSignature: request.nextUrl.searchParams.get("signature"),
      key: config.tokenEncryptionKey,
    })
    if (!valid) return new Response("Photo not found", { status: 404 })

    const db = getDb(env.DB)
    const photo = await db.select({
      driveFileId: dailyLogPhotos.driveFileId,
      fileName: dailyLogPhotos.fileName,
      mimeType: dailyLogPhotos.mimeType,
      organizationId: projects.organizationId,
    }).from(dailyLogPhotos).innerJoin(
      projects,
      eq(projects.id, dailyLogPhotos.projectId),
    ).where(and(
      eq(dailyLogPhotos.id, photoId),
      eq(dailyLogPhotos.reviewStatus, "approved"),
      eq(dailyLogPhotos.publicShareable, true),
    )).get()
    if (!photo?.driveFileId || !photo.mimeType || !photo.organizationId) {
      return new Response("Photo not found", { status: 404 })
    }
    if (!isSupportedSocialImageMimeType(photo.mimeType)) {
      return new Response("Photo format is not supported", { status: 415 })
    }

    const auth = await db.select({
      serviceAccountKeyEncrypted: googleAuth.serviceAccountKeyEncrypted,
    }).from(googleAuth).where(
      eq(googleAuth.organizationId, photo.organizationId),
    ).get()
    const googleEncryptionKey =
      environmentString(env, "GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY") ??
      process.env.GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY
    if (!auth || !googleEncryptionKey) {
      return new Response("Photo storage is unavailable", { status: 503 })
    }
    const serviceAccountJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      googleEncryptionKey,
      getGoogleCryptoSalt(),
    )
    const client = new DriveClient({
      serviceAccountKey: parseServiceAccountKey(serviceAccountJson),
    })
    const downloadUser =
      environmentString(env, "COMPASS_GOOGLE_UPLOAD_USER") ??
      environmentString(env, "COMPASS_GOOGLE_DOWNLOAD_USER") ??
      DEFAULT_DOWNLOAD_USER
    const downloaded = await client.downloadFile(downloadUser, photo.driveFileId)
    if (!downloaded.ok) {
      return new Response("Photo could not be loaded", { status: downloaded.status })
    }
    const sanitized = sanitizeSocialImage(
      new Uint8Array(await downloaded.arrayBuffer()),
      photo.mimeType,
    )
    const mimeType = normalizeSocialImageMimeType(photo.mimeType)
    if (!mimeType) return new Response("Photo format is not supported", { status: 415 })
    const responseBody = new ArrayBuffer(sanitized.byteLength)
    new Uint8Array(responseBody).set(sanitized)
    return new Response(responseBody, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${safeFileName(photo.fileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    })
  } catch (error) {
    console.error("Signed social photo delivery failed", error)
    return new Response("Photo could not be loaded", { status: 500 })
  }
}
