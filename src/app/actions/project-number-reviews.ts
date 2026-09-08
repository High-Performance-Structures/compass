"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectNumberReviewDecisions, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { canManageProjectRegistry, requirePermission } from "@/lib/permissions"
import { projectNumberReviewDecisionKey, projectNumberReviewIssue } from "@/lib/project-number-review"

async function reviewContext(action: "read" | "update") {
  const user = await requireAuth()
  requirePermission(user, "project", action)
  if (!canManageProjectRegistry(user)) throw new Error("Project registry access is required.")
  const organizationId = requireOrg(user)
  if (isDemoUser(user.id) || isDemoOrg(organizationId)) throw new Error("Demo data cannot be changed.")
  const { env } = await getCloudflareContext()
  if (!env?.DB) throw new Error("D1 not available")
  return { user, organizationId, db: getDb(env.DB) }
}

export async function getApprovedProjectNumberReviewKeys(): Promise<readonly string[]> {
  try {
    const { db, organizationId } = await reviewContext("read")
    const rows = await db.select({ projectId: projectNumberReviewDecisions.projectId, projectNumber: projectNumberReviewDecisions.projectNumber })
      .from(projectNumberReviewDecisions)
      .where(and(eq(projectNumberReviewDecisions.organizationId, organizationId), eq(projectNumberReviewDecisions.status, "approved_exception")))
    return rows.map((row) => projectNumberReviewDecisionKey(row.projectId, row.projectNumber))
  } catch { return [] }
}

export async function approveProjectNumberException(input: { readonly projectId: string; readonly projectNumber: string }): Promise<{ readonly success: true; readonly decisionKey: string } | { readonly success: false; readonly error: string }> {
  try {
    const { db, organizationId, user } = await reviewContext("update")
    const rows = await db.select({ id: projects.id, projectNumber: projects.projectNumber, name: projects.name }).from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId))).limit(1)
    const project = rows[0]
    const normalized = input.projectNumber.trim().toUpperCase()
    if (!project || project.projectNumber?.trim().toUpperCase() !== normalized) return { success: false, error: "The project number changed. Review it again." }
    if (!projectNumberReviewIssue(project.projectNumber, project.name)) return { success: false, error: "This project number no longer requires review." }
    const now = new Date().toISOString()
    await db.insert(projectNumberReviewDecisions).values({ id: crypto.randomUUID(), organizationId, projectId: project.id, projectNumber: normalized, status: "approved_exception", resolvedByUserId: user.id, resolvedAt: now, createdAt: now, updatedAt: now }).onConflictDoUpdate({
      target: [projectNumberReviewDecisions.organizationId, projectNumberReviewDecisions.projectId, projectNumberReviewDecisions.projectNumber],
      set: { status: "approved_exception", resolvedByUserId: user.id, resolvedAt: now, updatedAt: now },
    })
    revalidatePath("/dashboard/projects")
    return { success: true, decisionKey: projectNumberReviewDecisionKey(project.id, normalized) }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Could not approve this project number." } }
}
