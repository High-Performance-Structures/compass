import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projectOperations, projects } from "@/db/schema"
import { projectRfqBidApprovals, projectRfqQuoteLinks } from "@/db/schema-rfqs"
import { readDepartmentProfiles } from "@/lib/department-profiles-server"
import { projectBrandFor } from "@/lib/project-branding"
import { projectNumberAndName } from "@/lib/project-display-name"
import { parsePortalRfqPayload, portalRfqCanReceiveResponse, type PortalRfqPayload } from "@/lib/rfqs/portal-response"
import { hashQuoteLinkToken, isQuoteLinkTokenShape, quoteLinkIsLive } from "@/lib/rfqs/quote-links"

/** What a vendor sees on the no-login price page. */
export type QuoteLinkView = {
  readonly state: "open" | "closed"
  readonly companyName: string
  readonly companyContactLines: readonly string[]
  readonly projectLabel: string
  readonly rfqNumber: string | null
  readonly title: string
  readonly scope: string | null
  readonly requestedFrom: string | null
  readonly dueDate: string | null
  readonly expiresAt: string
  readonly scopeItems: PortalRfqPayload["scopeItems"]
  readonly documentLinks: PortalRfqPayload["documentLinks"]
  readonly answer: PortalRfqPayload["vendorResponse"]
}

export type QuoteLinkContext = {
  readonly db: ReturnType<typeof getDb>
  readonly link: typeof projectRfqQuoteLinks.$inferSelect
  readonly rfq: typeof projectOperations.$inferSelect
  readonly project: { readonly name: string; readonly projectNumber: string | null; readonly organizationId: string | null }
  readonly accepting: boolean
}

/**
 * Resolves a price-link token to its RFQ, or null for a wrong, expired or
 * turned-off link. Callers show the same "not available" page for all three.
 */
export async function resolveQuoteLink(env: CloudflareEnv, token: string, now: Date): Promise<QuoteLinkContext | null> {
  if (!isQuoteLinkTokenShape(token) || !env?.DB) return null
  const db = getDb(env.DB)
  const tokenHash = await hashQuoteLinkToken(token)
  const [link] = await db.select().from(projectRfqQuoteLinks).where(eq(projectRfqQuoteLinks.tokenHash, tokenHash)).limit(1)
  if (!link || !quoteLinkIsLive(link, now)) return null
  const [rfq] = await db
    .select()
    .from(projectOperations)
    .where(and(eq(projectOperations.id, link.rfqOperationId), eq(projectOperations.projectId, link.projectId), eq(projectOperations.sourceRecordType, "rfq")))
    .limit(1)
  if (!rfq) return null
  const [project] = await db
    .select({ name: projects.name, projectNumber: projects.projectNumber, organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, link.projectId))
    .limit(1)
  if (!project) return null
  const [approval] = await db.select({ id: projectRfqBidApprovals.id }).from(projectRfqBidApprovals).where(eq(projectRfqBidApprovals.rfqOperationId, rfq.id)).limit(1)
  return { db, link, rfq, project, accepting: portalRfqCanReceiveResponse(rfq.status) && !approval }
}

export async function quoteLinkView(context: QuoteLinkContext): Promise<QuoteLinkView> {
  const payload = parsePortalRfqPayload(context.rfq.sagePayloadJson)
  // The vendor isn't signed in, so read the project company's own profiles.
  const profiles = await readDepartmentProfiles(context.db, context.project.organizationId)
  const brand = projectBrandFor({ profiles, projectId: context.link.projectId, projectNumber: context.project.projectNumber })
  return {
    state: context.accepting ? "open" : "closed",
    companyName: brand.companyName,
    companyContactLines: brand.contactLines,
    projectLabel: context.project.projectNumber ? projectNumberAndName(context.project, " - ") : context.project.name,
    rfqNumber: context.rfq.sourceRecordNumber,
    title: context.rfq.title,
    scope: context.rfq.description,
    requestedFrom: context.rfq.companyName,
    dueDate: context.rfq.dueDate,
    expiresAt: context.link.expiresAt,
    scopeItems: payload.scopeItems,
    documentLinks: payload.documentLinks,
    answer: payload.vendorResponse,
  }
}
