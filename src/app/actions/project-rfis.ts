"use server"

import { and, asc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projectRfis, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

export type ProjectRfiItem = {
  readonly id: string
  readonly rfiNumber: string
  readonly subject: string
  readonly question: string
  readonly answer: string | null
  readonly status: string
  readonly priority: string
  readonly audience: string
  readonly requesterName: string | null
  readonly assignedToName: string | null
  readonly companyName: string | null
  readonly dueDate: string | null
  readonly submittedAt: string
  readonly answeredAt: string | null
}

export type ProjectRfiSummary = {
  readonly totalCount: number
  readonly openCount: number
  readonly highPriorityCount: number
  readonly subVendorVisibleCount: number
  readonly ownerVisibleCount: number
  readonly nextDue: ProjectRfiItem | null
  readonly items: readonly ProjectRfiItem[]
}

async function verifyProjectAccess(
  projectId: string
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return db
}

function isOpenRfi(item: ProjectRfiItem): boolean {
  return !["answered", "closed", "void", "cancelled"].includes(
    item.status.toLowerCase()
  )
}

function isSubVendorVisible(item: ProjectRfiItem): boolean {
  return item.audience === "sub_vendor" || item.audience === "public"
}

function isOwnerVisible(item: ProjectRfiItem): boolean {
  return item.audience === "owner" || item.audience === "public"
}

function toRfiItem(row: typeof projectRfis.$inferSelect): ProjectRfiItem {
  return {
    id: row.id,
    rfiNumber: row.rfiNumber,
    subject: row.subject,
    question: row.question,
    answer: row.answer,
    status: row.status,
    priority: row.priority,
    audience: row.audience,
    requesterName: row.requesterName,
    assignedToName: row.assignedToName,
    companyName: row.companyName,
    dueDate: row.dueDate,
    submittedAt: row.submittedAt,
    answeredAt: row.answeredAt,
  }
}

export async function getProjectRfiSummary(
  projectId: string
): Promise<ProjectRfiSummary> {
  const db = await verifyProjectAccess(projectId)

  const rows = await db
    .select()
    .from(projectRfis)
    .where(eq(projectRfis.projectId, projectId))
    .orderBy(asc(projectRfis.dueDate), asc(projectRfis.rfiNumber))

  const items = rows.map(toRfiItem)
  const openItems = items.filter(isOpenRfi)

  return {
    totalCount: items.length,
    openCount: openItems.length,
    highPriorityCount: openItems.filter((item) => item.priority === "high")
      .length,
    subVendorVisibleCount: items.filter(isSubVendorVisible).length,
    ownerVisibleCount: items.filter(isOwnerVisible).length,
    nextDue: openItems[0] ?? null,
    items: items.slice(0, 8),
  }
}
