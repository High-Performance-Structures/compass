"use server"

import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { projectArchiveDocuments, projectArchiveRecipients } from "@/db/schema-project-archives"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireArchiveStaff } from "@/lib/project-archive-context"
import type { ArchiveReader, ArchiveSummary } from "@/lib/project-archives"
import { archivePublicationSchema, archiveReaders, archiveSummary, publishArchiveRecord, visibleArchiveRecords } from "@/lib/project-archives"
import { assertAudiencePreviewWriteAllowed, resolveProjectAudienceViewer } from "@/lib/project-audience-viewer"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { readArchivePdf } from "@/lib/google/project-archive-drive"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { can } from "@/lib/permissions"

type Result = { readonly success: true } | { readonly success: false; readonly error: string }

function refresh(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/documents`)
  revalidatePath(`/portal/projects/${projectId}`, "layout")
  revalidatePath(`/preview/projects/${projectId}`, "layout")
}

export type ProjectArchiveWorkspace = {
  readonly projectId: string; readonly configured: boolean; readonly canPublish: boolean; readonly canRemove: boolean; readonly canRestore: boolean
  readonly readers: readonly ArchiveReader[]; readonly sources: readonly { readonly id: string; readonly name: string }[]; readonly sourceError: string | null
  readonly documents: readonly (ArchiveSummary & { readonly audience: ProjectAudience; readonly recipients: readonly string[] })[]
}

export async function getProjectArchiveWorkspace(projectId: string): Promise<ProjectArchiveWorkspace> {
  const ctx = await requireArchiveStaff(projectId)
  const settings = await readFeatureSettings(ctx.db, ctx.organizationId, "archive-delivery")
  const documents = await ctx.db.select().from(projectArchiveDocuments).where(and(eq(projectArchiveDocuments.projectId, ctx.projectId), eq(projectArchiveDocuments.organizationId, ctx.organizationId))).orderBy(asc(projectArchiveDocuments.period))
  const readers = await archiveReaders(ctx.db, ctx.projectId, ctx.organizationId)
  const grants = await ctx.db.select({ archiveId: projectArchiveRecipients.archiveId, userId: projectArchiveRecipients.userId }).from(projectArchiveRecipients)
    .innerJoin(projectArchiveDocuments, eq(projectArchiveDocuments.id, projectArchiveRecipients.archiveId)).where(and(eq(projectArchiveDocuments.projectId, ctx.projectId), eq(projectArchiveDocuments.organizationId, ctx.organizationId)))
  const sources: { readonly id: string; readonly name: string }[] = []
  let sourceError: string | null = null
  if (settings.deliveryRootIds.length) {
    try {
      const drive = await getProjectDocumentDriveContext(ctx)
      for (const folderId of settings.deliveryRootIds) {
        let pageToken: string | undefined
        do {
          const page = await drive.client.listFiles(drive.googleEmail, { folderId, query: "mimeType = 'application/pdf'", pageSize: 100, pageToken })
          for (const file of page.files) if (!sources.some((item) => item.id === file.id)) sources.push({ id: file.id, name: file.name })
          pageToken = page.nextPageToken
        } while (pageToken && sources.length < 1000)
      }
    } catch { sourceError = "Prepared PDFs could not be loaded. Check the private delivery folders and Google connection." }
  }
  return { projectId: ctx.projectId, configured: settings.deliveryRootIds.length > 0 && settings.excludedMasterRootIds.length > 0, canPublish: can(ctx.user, "document", "create"), canRemove: can(ctx.user, "document", "delete"), canRestore: can(ctx.user, "document", "update"), readers, sources, sourceError, documents: documents.map((row) => ({ ...archiveSummary(row), audience: row.audience, recipients: grants.filter((grant) => grant.archiveId === row.id).map((grant) => readers.find((reader) => reader.id === grant.userId)?.name ?? "Former project member") })) }
}

export async function getAudienceArchives(projectId: string, audience: ProjectAudience): Promise<readonly ArchiveSummary[]> {
  const ctx = await resolveProjectAudienceViewer(projectId, audience)
  return (await visibleArchiveRecords(ctx.db, { projectId: ctx.projectId, organizationId: ctx.organizationId, audience, viewerId: ctx.viewer?.id ?? null })).map(archiveSummary)
}

export async function publishProjectArchive(projectId: string, input: unknown): Promise<Result> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const ctx = await requireArchiveStaff(projectId, "create")
    const publication = archivePublicationSchema.parse(input)
    const settings = await readFeatureSettings(ctx.db, ctx.organizationId, "archive-delivery")
    const drive = await getProjectDocumentDriveContext(ctx)
    const pdf = await readArchivePdf(drive, publication.driveFileId, settings)
    const id = await publishArchiveRecord({ ...ctx, actorId: ctx.user.id, publication, fingerprint: { fileName: pdf.fileName, sha256: pdf.sha256, byteSize: pdf.byteSize, pageCount: pdf.pageCount } })
    await recordActivityEvent({ ...ctx, actor: ctx.user, category: "file", action: "archive.publish", entityType: "project_archive", entityId: id, summary: "Published a Buildertrend archive edition to named recipients", metadata: { audience: publication.audience, recipientCount: new Set(publication.recipientUserIds).size, sourceCount: new Set(publication.sourceRecordIds).size } })
    refresh(ctx.projectId)
    return { success: true }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Archive could not be published." } }
}

export async function setProjectArchiveVisibility(projectId: string, archiveId: string, input: { readonly status: "published" | "revoked"; readonly reason: string; readonly confirmed: boolean }): Promise<Result> {
  try {
    await assertAudiencePreviewWriteAllowed()
    if (!input.confirmed || !["published", "revoked"].includes(input.status) || input.reason.trim().length < 5 || input.reason.length > 1000) throw new Error("Confirm the change and provide a reason (5–1000 characters).")
    const ctx = await requireArchiveStaff(projectId, input.status === "revoked" ? "delete" : "update")
    const row = await ctx.db.select().from(projectArchiveDocuments).where(and(eq(projectArchiveDocuments.id, archiveId), eq(projectArchiveDocuments.projectId, ctx.projectId), eq(projectArchiveDocuments.organizationId, ctx.organizationId))).get()
    if (!row) throw new Error("Archive not found.")
    if (input.status === "published") {
      const settings = await readFeatureSettings(ctx.db, ctx.organizationId, "archive-delivery")
      const pdf = await readArchivePdf(await getProjectDocumentDriveContext(ctx), row.driveFileId, settings)
      if (pdf.sha256 !== row.sha256 || pdf.byteSize !== row.byteSize || pdf.pageCount !== row.pageCount) throw new Error("The PDF changed. Publish a separately reviewed edition.")
    }
    const now = new Date().toISOString()
    await ctx.db.update(projectArchiveDocuments).set(input.status === "revoked" ? { status: "revoked", revokedBy: ctx.user.id, revokedAt: now, revokeReason: input.reason.trim() } : { status: "published", restoredBy: ctx.user.id, restoredAt: now }).where(and(eq(projectArchiveDocuments.id, archiveId), eq(projectArchiveDocuments.projectId, ctx.projectId), eq(projectArchiveDocuments.organizationId, ctx.organizationId)))
    await recordActivityEvent({ ...ctx, actor: ctx.user, category: "file", action: input.status === "revoked" ? "archive.revoke" : "archive.restore", entityType: "project_archive", entityId: archiveId, summary: input.status === "revoked" ? "Removed a Buildertrend archive from recipient workspaces" : "Restored a Buildertrend archive to its original recipients", metadata: { reason: input.reason.trim() } })
    refresh(ctx.projectId)
    return { success: true }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Archive could not be changed." } }
}
