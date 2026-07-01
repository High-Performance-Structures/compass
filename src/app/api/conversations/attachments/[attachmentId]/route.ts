import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getDb } from "@/db"
import { users } from "@/db/schema"
import {
  channelMembers,
  channels,
  messageAttachments,
  messages,
} from "@/db/schema-conversations"
import { googleAuth } from "@/db/schema-google"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { requireOrg } from "@/lib/org-scope"

const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"

function envString(env: Record<string, string>, key: string): string | null {
  const value = env[key]
  return value && value.trim().length > 0 ? value : null
}

function uniqueStrings(values: readonly (string | null | undefined)[]): readonly string[] {
  const unique = new Set<string>()
  for (const value of values) {
    const normalized = value?.trim()
    if (normalized) unique.add(normalized)
  }
  return Array.from(unique)
}

function contentDisposition(input: {
  readonly fileName: string
  readonly mimeType: string
}): string {
  const disposition = input.mimeType.startsWith("image/") ? "inline" : "attachment"
  const safeName = input.fileName.replace(/["\r\n]/g, "_")
  return `${disposition}; filename="${safeName}"`
}

export async function GET(
  _request: NextRequest,
  { params }: { readonly params: Promise<{ readonly attachmentId: string }> }
): Promise<Response> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const { attachmentId } = await params

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const db = getDb(env.DB)

    const [attachment] = await db
      .select({
        id: messageAttachments.id,
        fileName: messageAttachments.fileName,
        mimeType: messageAttachments.mimeType,
        driveFileId: messageAttachments.driveFileId,
        channelId: messages.channelId,
        senderEmail: users.email,
        senderGoogleEmail: users.googleEmail,
      })
      .from(messageAttachments)
      .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .innerJoin(users, eq(users.id, messages.userId))
      .innerJoin(
        channelMembers,
        and(
          eq(channelMembers.channelId, messages.channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .where(
        and(
          eq(messageAttachments.id, attachmentId),
          eq(channels.organizationId, organizationId)
        )
      )
      .limit(1)

    if (!attachment?.driveFileId) {
      return new Response("Attachment not found", { status: 404 })
    }

    const auth = await db
      .select()
      .from(googleAuth)
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!auth) {
      return new Response("Google Drive not connected", { status: 404 })
    }

    const config = getGoogleConfig(envRecord)
    const keyJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey,
      getGoogleCryptoSalt()
    )
    const client = new DriveClient({
      serviceAccountKey: parseServiceAccountKey(keyJson),
    })

    const candidateEmails = uniqueStrings([
      envString(envRecord, "COMPASS_GOOGLE_UPLOAD_USER"),
      attachment.senderGoogleEmail,
      attachment.senderEmail,
      user.googleEmail,
      user.email,
      DEFAULT_COMPASS_GOOGLE_UPLOAD_USER,
    ])

    for (const googleEmail of candidateEmails) {
      try {
        const response = await client.downloadFile(
          googleEmail,
          attachment.driveFileId
        )
        if (!response.ok) continue

        return new Response(response.body, {
          headers: {
            "Content-Type": attachment.mimeType,
            "Content-Disposition": contentDisposition({
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
            }),
            "Cache-Control": "private, max-age=300",
          },
        })
      } catch {
        // Try the next likely delegated identity. Older attachments may have
        // been uploaded before the Compass upload user was standardized.
      }
    }

    return new Response("Attachment is not available through Compass", {
      status: 404,
    })
  } catch (error) {
    console.error("[conversation-attachment-download] error", error)
    return new Response("Download failed", { status: 500 })
  }
}
