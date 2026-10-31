"use server"

import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { sageLaborLines, sageLaborRequests, shopTicketLaborClaims, shopTickets } from "@/db/schema-shop-tickets"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { chunkD1Values } from "@/lib/d1-query"
import { compassCostCodeFromSage, groupSageLabor, type SageLaborGroup } from "@/lib/shop-tickets/sage-labor"
import { insertSageLaborRequest } from "@/lib/domain/sage-bridge/store"

const FEATURE = "shop-tickets"
/** About a quarter; longer ranges are usually a typo. */
const MAX_RANGE_DAYS = 120

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")

type SageLaborRequestView = {
  readonly status: "queued" | "running" | "done" | "failed"
  readonly error: string | null
  readonly requestedAt: string
  readonly completedAt: string | null
  readonly sageJobNumber: string | null
}

export type SageLaborView = {
  /** The latest request for these dates, or null when none was made. */
  readonly request: SageLaborRequestView | null
  readonly groups: readonly SageLaborGroup[]
  /** Hours from each timecard line already on this ticket. */
  readonly ticketClaims: Readonly<Record<string, number>>
}

type Result<T> = ({ readonly success: true } & T) | { readonly success: false; readonly error: string }

function checkRange(dateFrom: string, dateTo: string): string | null {
  if (!isoDate.safeParse(dateFrom).success || !isoDate.safeParse(dateTo).success) return "Set the labor dates first."
  if (dateFrom > dateTo) return "The labor dates end before they start."
  const days = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000
  return days > MAX_RANGE_DAYS ? `Choose labor dates no more than ${MAX_RANGE_DAYS} days apart.` : null
}

async function context() {
  const user = await requireAuth()
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), user, orgId }
}

/**
 * Asks the Sage bridge for the project's timecard hours in the labor dates.
 * The bridge checks every minute; an identical request still waiting is reused.
 */
export async function requestSageLaborHours(projectId: string, dateFrom: string, dateTo: string): Promise<Result<{ readonly requestId: string }>> {
  try {
    const { db, user, orgId } = await context()
    if (isDemoUser(user.id)) return { success: false, error: "The demo account can't read Sage." }
    await requireFeaturePermission(user, FEATURE, "update")
    const rangeError = checkRange(dateFrom, dateTo)
    if (rangeError) return { success: false, error: rangeError }
    const project = await db
      .select({ id: projects.id, projectNumber: projects.projectNumber, sageJobNumber: projects.sageJobNumber })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .get()
    if (!project) return { success: false, error: "Project not found." }
    if (!project.sageJobNumber && !project.projectNumber) {
      return { success: false, error: "This project has no project number or Sage job to look up." }
    }
    const waiting = await db
      .select({ id: sageLaborRequests.id })
      .from(sageLaborRequests)
      .where(
        and(
          eq(sageLaborRequests.projectId, projectId),
          eq(sageLaborRequests.dateFrom, dateFrom),
          eq(sageLaborRequests.dateTo, dateTo),
          inArray(sageLaborRequests.status, ["queued", "running"]),
        ),
      )
      .get()
    if (waiting) return { success: true, requestId: waiting.id }
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await insertSageLaborRequest(db, {
      id,
      organizationId: orgId,
      projectId,
      projectNumber: project.projectNumber,
      sageJobNumber: project.sageJobNumber,
      dateFrom,
      dateTo,
      requestedBy: user.id,
      requestedAt: now,
      updatedAt: now,
    })
    return { success: true, requestId: id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Couldn't ask Sage for hours." }
  }
}

/**
 * The project's Sage timecard hours in the labor dates, by cost code, with
 * hours already on other (not void) tickets left out.
 */
export async function getSageLaborHours(
  projectId: string,
  ticketId: string | null,
  dateFrom: string,
  dateTo: string,
): Promise<Result<{ readonly view: SageLaborView }>> {
  try {
    const { db, user, orgId } = await context()
    await requireFeaturePermission(user, FEATURE, "read")
    const rangeError = checkRange(dateFrom, dateTo)
    if (rangeError) return { success: false, error: rangeError }
    const [request, lines] = await Promise.all([
      db
        .select()
        .from(sageLaborRequests)
        .where(
          and(
            eq(sageLaborRequests.projectId, projectId),
            eq(sageLaborRequests.organizationId, orgId),
            eq(sageLaborRequests.dateFrom, dateFrom),
            eq(sageLaborRequests.dateTo, dateTo),
          ),
        )
        .orderBy(desc(sageLaborRequests.requestedAt))
        .get(),
      db
        .select()
        .from(sageLaborLines)
        .where(
          and(
            eq(sageLaborLines.projectId, projectId),
            eq(sageLaborLines.organizationId, orgId),
            gte(sageLaborLines.workDate, dateFrom),
            lte(sageLaborLines.workDate, dateTo),
          ),
        ),
    ])
    const claims = []
    for (const chunk of chunkD1Values(lines.map((line) => line.id))) {
      claims.push(
        ...(await db
          .select({ lineId: shopTicketLaborClaims.laborLineId, ticketId: shopTicketLaborClaims.ticketId, hours: shopTicketLaborClaims.hours })
          .from(shopTicketLaborClaims)
          .innerJoin(shopTickets, eq(shopTickets.id, shopTicketLaborClaims.ticketId))
          .where(and(inArray(shopTicketLaborClaims.laborLineId, chunk), ne(shopTickets.status, "void")))),
      )
    }
    const elsewhere = new Map<string, number>()
    const ticketClaims: Record<string, number> = {}
    for (const claim of claims) {
      if (claim.ticketId === ticketId) ticketClaims[claim.lineId] = claim.hours
      else elsewhere.set(claim.lineId, (elsewhere.get(claim.lineId) ?? 0) + claim.hours)
    }
    const groups = groupSageLabor(
      lines.map((line) => ({
        id: line.id,
        workDate: line.workDate,
        hours: line.hours,
        costCode: compassCostCodeFromSage(line.sageCostCode, line.sageCostCodeName),
        sageCostCodeName: line.sageCostCodeName,
        employeeName: line.employeeName,
      })),
      elsewhere,
    )
    return {
      success: true,
      view: {
        request: request
          ? {
              status: request.status,
              error: request.error,
              requestedAt: request.requestedAt,
              completedAt: request.completedAt,
              sageJobNumber: request.sageJobNumber,
            }
          : null,
        groups,
        ticketClaims,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Couldn't load Sage hours." }
  }
}
