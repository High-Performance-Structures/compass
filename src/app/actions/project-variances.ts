"use server"

import { revalidatePath } from "next/cache"

import type { ChangeOrderRecordType } from "@/lib/domain/estimates/statuses"
import type { VarianceLineInput } from "@/lib/domain/estimates/variance-rules"
import {
  approveVariance,
  createVariance,
  projectVarianceSettings,
  reclassifyChangeOrders,
  saveVarianceLines,
  type VarianceActor,
} from "@/lib/domain/estimates/variances"
import type { ProjectContractType } from "@/lib/domain/project/statuses"
import { canFeature } from "@/lib/permission-enforcement"
import { projectContext, type Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Variances: cost-plus cost movements kept on the change-order table. Staff
 * who may approve change orders create, price and approve them, and
 * reclassify change orders as variances and back.
 */

export type ProjectVarianceOptions = {
  readonly contractType: ProjectContractType
  readonly allowsVariances: boolean
  readonly closed: boolean
  /** Staff who may approve change orders on this open project. */
  readonly canManage: boolean
}

type VarianceActionResult =
  | { readonly success: true; readonly id: string; readonly budgetNote: string | null }
  | { readonly success: false; readonly error: string }

async function varianceContext(
  projectId: string
): Promise<{ readonly success: true; readonly db: Db; readonly actor: VarianceActor } | { readonly success: false; readonly error: string }> {
  const context = await projectContext(projectId, {
    scope: "organization",
    feature: "change-orders",
    action: "approve",
    mutation: true,
  })
  if (!context.success) return context
  const { db, user } = context.data
  if (!isInternalStaffRole(user.role)) return { success: false, error: "Change-order approval permission is required." }
  return { success: true, db, actor: user }
}

function revalidateVariancePaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/change-orders`)
  revalidatePath(`/dashboard/projects/${projectId}/budget`)
  revalidatePath(`/preview/projects/${projectId}/owner/change-orders`)
}

function failure(error: unknown, fallback: string): { readonly success: false; readonly error: string } {
  return { success: false, error: error instanceof Error ? error.message : fallback }
}

/** The project's contract type and whether this user may manage its variances. */
export async function getProjectVarianceOptions(projectId: string): Promise<ProjectVarianceOptions | null> {
  const context = await projectContext(projectId, { scope: "organization", feature: "change-orders", action: "read" })
  if (!context.success) return null
  const { db, user } = context.data
  const settings = await projectVarianceSettings(db, projectId)
  if (!settings) return null
  const canApprove = isInternalStaffRole(user.role) && (await canFeature(user, "change-orders", "approve"))
  return { ...settings, canManage: canApprove && !settings.closed }
}

export async function createProjectVariance(
  projectId: string,
  input: { readonly title: string; readonly scope: string; readonly reason: string | null }
): Promise<VarianceActionResult> {
  try {
    const context = await varianceContext(projectId)
    if (!context.success) return context
    const result = await createVariance({ db: context.db, projectId, actor: context.actor, ...input })
    if (result.success) revalidateVariancePaths(projectId)
    return result
  } catch (error) {
    return failure(error, "Failed to create the variance")
  }
}

export async function saveProjectVarianceLines(
  projectId: string,
  changeOrderId: string,
  lines: readonly VarianceLineInput[]
): Promise<VarianceActionResult> {
  try {
    const context = await varianceContext(projectId)
    if (!context.success) return context
    const result = await saveVarianceLines({ db: context.db, projectId, changeOrderId, actor: context.actor, lines })
    if (result.success) revalidateVariancePaths(projectId)
    return result
  } catch (error) {
    return failure(error, "Failed to save the variance lines")
  }
}

export async function approveProjectVariance(projectId: string, changeOrderId: string): Promise<VarianceActionResult> {
  try {
    const context = await varianceContext(projectId)
    if (!context.success) return context
    const result = await approveVariance({ db: context.db, projectId, changeOrderId, actor: context.actor })
    if (result.success) revalidateVariancePaths(projectId)
    return result
  } catch (error) {
    return failure(error, "Failed to approve the variance")
  }
}

/** Reclassifies change orders as variances (V-numbers in date order) or variances back to change orders. */
export async function reclassifyProjectChangeOrders(
  projectId: string,
  changeOrderIds: readonly string[],
  to: ChangeOrderRecordType
): Promise<{ readonly success: true; readonly count: number; readonly budgetNote: string | null } | { readonly success: false; readonly error: string }> {
  try {
    if (to !== "variance" && to !== "change_order") return { success: false, error: "Choose change order or variance." }
    const context = await varianceContext(projectId)
    if (!context.success) return context
    const result = await reclassifyChangeOrders({ db: context.db, projectId, changeOrderIds, to, actor: context.actor })
    if (result.success) revalidateVariancePaths(projectId)
    return result
  } catch (error) {
    return failure(error, "Failed to reclassify")
  }
}
