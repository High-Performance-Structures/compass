import { audienceReadCacheControl } from "@/lib/project-audience-request-server"
import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projects } from "@/db/schema"
import { executedDocumentSource } from "@/lib/contracts/executed-document-source"
import { downloadFoxitExecutedEnvelope } from "@/lib/foxit/esign"
import {
  getExportExtension,
  getExportMimeType,
  isGoogleNativeFile,
} from "@/lib/google/mapper"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { isDriveItemWithinProjectFolder } from "@/lib/google/project-folder-boundary"

/** Where a signed document can be shown from. */
export function signedDocumentEmbeddable(url: string | null): boolean {
  const source = executedDocumentSource(url)
  return source !== null && source.kind !== "external"
}

/**
 * Serves a signed (executed) document inline: a Foxit envelope through the
 * Foxit API, a Drive file inside the project's folder through Drive, anything
 * else by redirect. Callers check the viewer may see the record first.
 */
export async function serveSignedDocument(input: {
  readonly db: ReturnType<typeof getDb>
  readonly env: CloudflareEnv
  readonly projectId: string
  readonly documentUrl: string | null
  readonly foxitEnvelopeId: string | null
  readonly fileName: string
  readonly label: string
}): Promise<Response> {
  const { db, env, projectId } = input
  const source = executedDocumentSource(input.documentUrl)
  if (!source) {
    return new Response(`${input.label} not found`, { status: 404 })
  }

  if (source.kind === "foxit") {
    if (
      !input.foxitEnvelopeId ||
      input.foxitEnvelopeId !== source.envelopeId
    ) {
      return new Response(`${input.label} not found`, { status: 404 })
    }
    const foxit = await downloadFoxitExecutedEnvelope({
      clientId: env.FOXIT_ESIGN_CLIENT_ID,
      clientSecret: env.FOXIT_ESIGN_CLIENT_SECRET,
      envelopeId: source.envelopeId,
    })
    if (!foxit.ok || !foxit.body) {
      return new Response(`${input.label} is temporarily unavailable`, {
        status: 502,
      })
    }
    return new Response(foxit.body, {
      headers: {
        "Content-Type": foxit.headers.get("Content-Type") ?? "application/pdf",
        "Content-Disposition": `inline; filename="${input.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  }

  if (source.kind === "external") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: source.url,
        "Cache-Control": "private, no-store",
      },
    })
  }

  const project = await db
    .select({ folderId: projects.googleDriveFolderId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!project?.folderId) {
    return new Response(`${input.label} not found`, { status: 404 })
  }

  const drive = await getProjectDocumentDriveContext({ db, env })
  const withinProject = await isDriveItemWithinProjectFolder({
    client: drive.client,
    googleEmail: drive.googleEmail,
    itemId: source.fileId,
    projectFolderId: project.folderId,
  })
  if (!withinProject) {
    return new Response(`${input.label} not found`, { status: 404 })
  }

  const file = await drive.client.getFile(drive.googleEmail, source.fileId)
  if (file.trashed) {
    return new Response(`${input.label} not found`, { status: 404 })
  }

  let response: Response
  let contentType = file.mimeType
  let fileName = file.name
  if (isGoogleNativeFile(file.mimeType)) {
    const exportMimeType = getExportMimeType(file.mimeType)
    if (!exportMimeType) {
      return new Response(`${input.label} cannot be exported`, {
        status: 400,
      })
    }
    response = await drive.client.exportFile(
      drive.googleEmail,
      source.fileId,
      exportMimeType
    )
    contentType = exportMimeType
    fileName = `${fileName}${getExportExtension(file.mimeType)}`
  } else {
    response = await drive.client.downloadFile(
      drive.googleEmail,
      source.fileId
    )
  }
  if (!response.ok || !response.body) {
    return new Response(`${input.label} is temporarily unavailable`, {
      status: 502,
    })
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
      "Cache-Control": await audienceReadCacheControl(),
      "X-Content-Type-Options": "nosniff",
    },
  })
}
