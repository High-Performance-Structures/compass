"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { projectArchiveDocuments } from "@/db/schema-project-archives"
import { recordActivityEvent } from "@/lib/activity-log"
import { updateArchiveDocuments } from "@/lib/domain/documents/store"
import { requireArchiveStaff } from "@/lib/project-archive-context"
import type { ArchiveSummary } from "@/lib/project-archives"
import { archivePublicationSchema, archiveSummary, publishArchiveRecord, visibleArchiveRecords } from "@/lib/project-archives"
import { assertAudiencePreviewWriteAllowed, resolveProjectAudienceViewer } from "@/lib/project-audience-viewer"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { readArchivePdf } from "@/lib/google/project-archive-drive"
import type { ProjectAudience } from "@/lib/project-audience-access"

type Result = { readonly success: true } | { readonly success: false; readonly error: string }

function refresh(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/documents`)
  revalidatePath(`/portal/projects/${projectId}`, "layout")
  revalidatePath(`/preview/projects/${projectId}`, "layout")
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
    await updateArchiveDocuments(ctx.db, and(eq(projectArchiveDocuments.id, archiveId), eq(projectArchiveDocuments.projectId, ctx.projectId), eq(projectArchiveDocuments.organizationId, ctx.organizationId)), input.status === "revoked" ? { status: "revoked", revokedBy: ctx.user.id, revokedAt: now, revokeReason: input.reason.trim() } : { status: "published", restoredBy: ctx.user.id, restoredAt: now })
    await recordActivityEvent({ ...ctx, actor: ctx.user, category: "file", action: input.status === "revoked" ? "archive.revoke" : "archive.restore", entityType: "project_archive", entityId: archiveId, summary: input.status === "revoked" ? "Removed a Buildertrend archive from recipient workspaces" : "Restored a Buildertrend archive to its original recipients", metadata: { reason: input.reason.trim() } })
    refresh(ctx.projectId)
    return { success: true }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Archive could not be changed." } }
}
