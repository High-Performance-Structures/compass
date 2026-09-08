"use server"

import { and, desc, eq, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectDuplicateDecisions, projectNumberAliases, projectNumberReservations, projectNumberRetirements, projectProfileAuditEvents, projectRegistryRemovals, projectRouteAliases, projects, users } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { canUseExecutiveAdmin, requirePermission } from "@/lib/permissions"
import { projectDeletionDependencyTableNames, type ProjectMergeSchemaRow } from "@/lib/project-merge-impact"
import { projectNumberParts } from "@/lib/project-profile"

export type ArchivedRegistryProject = { readonly projectId: string; readonly projectNumber: string | null; readonly name: string; readonly previousStatus: string; readonly removedAt: string; readonly removedBy: string | null }
type Result = { readonly success: true } | { readonly success: false; readonly error: string }

async function context(action: "read" | "update" | "delete") {
  const user = await requireAuth(); requirePermission(user, "project", action)
  if (!canUseExecutiveAdmin(user)) throw new Error("Executive Admin access is required.")
  const organizationId = requireOrg(user); const { env } = await getCloudflareContext()
  if (!env?.DB) throw new Error("D1 not available")
  return { user, organizationId, db: getDb(env.DB), d1: env.DB }
}

export async function getArchivedRegistryProjects(): Promise<readonly ArchivedRegistryProject[]> {
  try {
    const { db, organizationId } = await context("read")
    return db.select({ projectId: projectRegistryRemovals.projectId, projectNumber: projectRegistryRemovals.originalProjectNumber, name: projects.name, previousStatus: projectRegistryRemovals.originalStatus, removedAt: projectRegistryRemovals.removedAt, removedBy: users.displayName })
      .from(projectRegistryRemovals).innerJoin(projects, eq(projects.id, projectRegistryRemovals.projectId)).leftJoin(users, eq(users.id, projectRegistryRemovals.removedByUserId))
      .where(eq(projectRegistryRemovals.organizationId, organizationId)).orderBy(desc(projectRegistryRemovals.removedAt))
  } catch { return [] }
}

export async function restoreArchivedRegistryProject(input: { readonly projectId: string; readonly confirmationProjectId: string; readonly confirmation: string }): Promise<Result> {
  try {
    if (input.projectId !== input.confirmationProjectId || input.confirmation !== "RESTORE") return { success: false, error: "Confirm the exact project to restore." }
    const { db, organizationId, user } = await context("update")
    const rows = await db.select({ id: projects.id, currentStatus: projects.status, projectNumber: projectRegistryRemovals.originalProjectNumber, previousStatus: projectRegistryRemovals.originalStatus }).from(projectRegistryRemovals).innerJoin(projects, eq(projects.id, projectRegistryRemovals.projectId)).where(and(eq(projectRegistryRemovals.organizationId, organizationId), eq(projectRegistryRemovals.projectId, input.projectId))).limit(1)
    const archived = rows[0]; if (!archived) return { success: false, error: "Archived project not found." }
    const projectNumber = archived.projectNumber?.trim().toUpperCase() ?? null; const parts = projectNumber ? projectNumberParts(projectNumber) : null
    if (projectNumber) {
      const [projectConflict, aliasConflict, reservationConflict, retirementConflict] = await Promise.all([
        db.select({ id: projects.id }).from(projects).where(and(eq(projects.organizationId, organizationId), eq(projects.projectNumber, projectNumber))).limit(1),
        db.select({ projectId: projectNumberAliases.projectId }).from(projectNumberAliases).where(and(eq(projectNumberAliases.organizationId, organizationId), eq(projectNumberAliases.projectNumber, projectNumber))).limit(1),
        db.select({ projectId: projectNumberReservations.projectId }).from(projectNumberReservations).where(and(eq(projectNumberReservations.organizationId, organizationId), parts ? and(eq(projectNumberReservations.department, parts.department), eq(projectNumberReservations.sequence, Number(parts.sequence))) : eq(projectNumberReservations.projectNumber, projectNumber))).limit(1),
        db.select({ formerProjectId: projectNumberRetirements.formerProjectId }).from(projectNumberRetirements).where(and(eq(projectNumberRetirements.organizationId, organizationId), parts ? or(eq(projectNumberRetirements.projectNumber, projectNumber), and(eq(projectNumberRetirements.department, parts.department), eq(projectNumberRetirements.sequence, Number(parts.sequence)))) : eq(projectNumberRetirements.projectNumber, projectNumber))).limit(1),
      ])
      if ((projectConflict[0] && projectConflict[0].id !== archived.id) || (aliasConflict[0] && aliasConflict[0].projectId !== archived.id) || (reservationConflict[0] && reservationConflict[0].projectId !== archived.id) || (retirementConflict[0] && retirementConflict[0].formerProjectId !== archived.id)) return { success: false, error: "The former project number conflicts with another registry record." }
    }
    const now = new Date().toISOString()
    await db.batch([
      db.update(projects).set({ projectNumber, status: archived.previousStatus, updatedAt: now }).where(eq(projects.id, archived.id)),
      ...(parts && projectNumber ? [db.insert(projectNumberReservations).values({ id: crypto.randomUUID(), organizationId, projectId: archived.id, department: parts.department, sequence: Number(parts.sequence), projectNumber, createdAt: now })] : []),
      db.delete(projectNumberRetirements).where(and(eq(projectNumberRetirements.organizationId, organizationId), eq(projectNumberRetirements.formerProjectId, archived.id))),
      db.insert(projectProfileAuditEvents).values({ id: crypto.randomUUID(), organizationId, projectId: archived.id, actorUserId: user.id, eventType: "project.registry_restored", entityType: "project", entityId: archived.id, beforeJson: JSON.stringify({ status: archived.currentStatus }), afterJson: JSON.stringify({ status: archived.previousStatus, projectNumber }), createdAt: now }),
      db.delete(projectRegistryRemovals).where(and(eq(projectRegistryRemovals.organizationId, organizationId), eq(projectRegistryRemovals.projectId, archived.id))),
    ])
    revalidatePath("/dashboard/projects"); revalidatePath("/dashboard/executive-admin/project-archive"); return { success: true }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Could not restore project." } }
}

const SAFE_METADATA = new Set(["project_number_review_decisions", "project_profile_audit_events", "project_registry_removals"])
function quote(name: string): string { if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("Unsafe table name"); return `"${name}"` }

export async function permanentlyDeleteArchivedRegistryProject(input: { readonly projectId: string; readonly confirmationProjectId: string; readonly confirmation: string }): Promise<Result> {
  try {
    if (input.projectId !== input.confirmationProjectId || input.confirmation !== "DELETE") return { success: false, error: "Confirm the exact project to delete." }
    const { db, d1, organizationId } = await context("delete")
    const rows = await db.select({ id: projects.id }).from(projectRegistryRemovals).innerJoin(projects, eq(projects.id, projectRegistryRemovals.projectId)).where(and(eq(projectRegistryRemovals.organizationId, organizationId), eq(projectRegistryRemovals.projectId, input.projectId))).limit(1)
    const archived = rows[0]; if (!archived) return { success: false, error: "Archived project not found." }
    const schema = await d1.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%project_id%' ORDER BY name").all<ProjectMergeSchemaRow>()
    const tables = projectDeletionDependencyTableNames(schema.results).filter((name) => !SAFE_METADATA.has(name))
    const counts = await d1.batch<Record<string, unknown>>(tables.map((name) => d1.prepare(`SELECT COUNT(*) AS record_count FROM ${quote(name)} WHERE project_id = ?`).bind(archived.id)))
    const blocking = counts.reduce((sum, result) => sum + (typeof result.results[0]?.record_count === "number" ? result.results[0].record_count : 0), 0)
    if (blocking > 0) return { success: false, error: `Permanent deletion is blocked because ${blocking} linked record${blocking === 1 ? " remains" : "s remain"}. Merge or remove those records first.` }
    await db.batch([
      db.delete(projectRouteAliases).where(eq(projectRouteAliases.sourceProjectId, archived.id)),
      db.delete(projectDuplicateDecisions).where(or(eq(projectDuplicateDecisions.projectAId, archived.id), eq(projectDuplicateDecisions.projectBId, archived.id))),
      db.delete(projects).where(eq(projects.id, archived.id)),
    ])
    revalidatePath("/dashboard/executive-admin/project-archive"); return { success: true }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Could not permanently delete project." } }
}
