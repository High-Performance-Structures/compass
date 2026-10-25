import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { projectArchiveDocuments } from "@/db/schema-project-archives"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireArchiveStaff } from "@/lib/project-archive-context"
import { visibleArchiveRecords } from "@/lib/project-archives"
import { assertAudienceResourceProject, getProjectAudienceRequestScope } from "@/lib/project-audience-request-server"
import { resolveProjectAudienceViewer } from "@/lib/project-audience-viewer"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { readArchivePdf } from "@/lib/google/project-archive-drive"
import { resolveProjectRouteId } from "@/lib/project-route-id"
import { isInternalStaffRole } from "@/lib/user-roles"

export async function GET(_request: Request, { params }: { readonly params: Promise<{ readonly id: string; readonly archiveId: string }> }): Promise<Response> {
  try {
    const actor = await getCurrentUser()
    if (!actor?.isActive) return new Response("Unauthorized", { status: 401 })
    const { id, archiveId } = await params
    const projectId = await resolveProjectRouteId(id)
    if (!projectId) throw new Error("Not found")
    await assertAudienceResourceProject(projectId)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const row = await db.select().from(projectArchiveDocuments).where(and(eq(projectArchiveDocuments.id, archiveId), eq(projectArchiveDocuments.projectId, projectId))).get()
    if (!row) throw new Error("Not found")
    const scope = await getProjectAudienceRequestScope()
    if (scope || !isInternalStaffRole(actor.role)) {
      const context = await resolveProjectAudienceViewer(projectId, scope?.audience ?? row.audience)
      const visible = await visibleArchiveRecords(db, { projectId, organizationId: context.organizationId, audience: context.audience, viewerId: context.viewer?.id ?? null })
      if (!visible.some((document) => document.id === archiveId)) throw new Error("Not found")
    } else {
      const context = await requireArchiveStaff(projectId)
      if (context.organizationId !== row.organizationId) throw new Error("Not found")
    }
    const settings = await readFeatureSettings(db, row.organizationId, "archive-delivery")
    const drive = await getProjectDocumentDriveContext({ db, env, organizationId: row.organizationId })
    const pdf = await readArchivePdf(drive, row.driveFileId, settings)
    if (pdf.sha256 !== row.sha256 || pdf.byteSize !== row.byteSize || pdf.pageCount !== row.pageCount) throw new Error("The published PDF changed")
    return new Response(pdf.bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${encodeURIComponent(row.fileName)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
  } catch { return new Response("Archive not found", { status: 404, headers: { "Cache-Control": "private, no-store" } }) }
}
