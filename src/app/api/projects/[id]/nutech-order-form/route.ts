import { and, desc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { nuTechOrderWorkflows } from "@/db/schema-nutech"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { exportNuTechOrderFormPdf } from "@/lib/nutech/order-form-attachment"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { getProjectAccessRecord } from "@/lib/project-access"
import { resolveProjectRouteId } from "@/lib/project-route-id"

/**
 * The Nu-Tech job's filled manufacturer order form as a PDF: the pickup copy
 * of the manufacturer's PO, in the manufacturer's own format.
 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> }
): Promise<Response> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "nutech-orders", "read")
    const organizationId = requireOrg(user)
    const { id: rawProjectId } = await context.params
    const orderId = new URL(request.url).searchParams.get("order")
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) return new Response("Order form not found.", { status: 404 })
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    if (!(await getProjectAccessRecord(db, user, projectId))) {
      return new Response("Order form not found.", { status: 404 })
    }
    const workflow = await db
      .select({
        workbookId: nuTechOrderWorkflows.airliteWorkbookId,
        projectNumber: projects.projectNumber,
        sequence: nuTechOrderWorkflows.airlitePoSequence,
      })
      .from(nuTechOrderWorkflows)
      .innerJoin(projects, eq(projects.id, nuTechOrderWorkflows.projectId))
      .where(
        and(
          eq(nuTechOrderWorkflows.projectId, projectId),
          eq(projects.organizationId, organizationId),
          // A job can have several orders; the link names which one.
          ...(orderId ? [eq(nuTechOrderWorkflows.id, orderId)] : []),
        ),
      )
      .orderBy(desc(nuTechOrderWorkflows.orderNumber))
      .get()
    if (!workflow?.workbookId) {
      return new Response("Fill the order form first; the pickup copy is printed from it.", { status: 404 })
    }
    const drive = await getOrganizationDriveContext({
      db,
      environment: env,
      organizationId,
      user,
    })
    const exported = await exportNuTechOrderFormPdf(drive, workflow.workbookId)
    if (!exported.ok) {
      return new Response(`Couldn't export the order form from Drive (${exported.status}).`, { status: 502 })
    }
    const fileName = `PO ${[workflow.projectNumber, workflow.sequence].filter(Boolean).join("-") || "order form"}.pdf`
      .replace(/[^a-zA-Z0-9._ -]/g, "-")
    return new Response(exported.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch {
    return new Response("Order form not found.", { status: 404 })
  }
}
