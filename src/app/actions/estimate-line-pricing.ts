"use server"

import { and, eq, inArray } from "drizzle-orm"

import { createProjectTaskCommand as createProjectTask } from "@/lib/domain/operations/todo-commands"
import { organizationMembers, projectOperations, users } from "@/db/schema"
import { projectEstimateLines, projectEstimates } from "@/db/schema-estimates"
import { estimateAccess, requireEditableEstimate, revalidateEstimate } from "@/lib/domain/estimates/access"
import { updateEstimateLines } from "@/lib/domain/estimates/store"
import { findPricingSource, pricingSourceChoices, takeoffTodoTitle, type PricingSource } from "@/lib/estimates/pricing-sources"
import { isDemoUser } from "@/lib/demo"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type EstimateLineTakeoffTodo = {
  readonly id: string
  readonly number: string | null
  readonly status: string
  readonly assigneeName: string | null
}

export type EstimateLinePricingState = {
  readonly pricingSource: string | null
  readonly todo: EstimateLineTakeoffTodo | null
}

export type EstimatePricingView = {
  readonly sources: readonly PricingSource[]
  readonly estimators: readonly { readonly value: string; readonly label: string }[]
  readonly lines: Readonly<Record<string, EstimateLinePricingState>>
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function staffLabel(row: {
  readonly email: string
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
}): string {
  return row.displayName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email
}

/** Active staff of the company, by organization role (never clients, subs or suppliers). */
async function companyStaff(
  db: Awaited<ReturnType<typeof estimateAccess>>["db"],
  organizationId: string,
): Promise<readonly { readonly value: string; readonly label: string }[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      role: organizationMembers.role,
    })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true)))
  return rows
    .filter((row) => isInternalStaffRole(row.role) && !isDemoUser(row.id))
    .map((row) => ({ value: row.id, label: staffLabel(row) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** "Priced by" choices, estimators, and each line's choice and takeoff to-do for one estimate. */
export async function getEstimatePricingView(projectId: string, estimateId: string): Promise<Result<EstimatePricingView>> {
  try {
    const access = await estimateAccess(projectId, false)
    if (!access.organizationId) return { success: false, error: "The project organization is required." }
    const [settings, estimators, lines] = await Promise.all([
      readFeatureSettings(access.db, access.organizationId, "estimate-pricing"),
      isInternalStaffRole(access.user.role) ? companyStaff(access.db, access.organizationId) : Promise.resolve([]),
      access.db
        .select({ id: projectEstimateLines.id, pricingSource: projectEstimateLines.pricingSource, pricingTodoId: projectEstimateLines.pricingTodoId })
        .from(projectEstimateLines)
        .where(and(eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.projectId, projectId))),
    ])
    const todoIds = lines.map((line) => line.pricingTodoId).filter((id): id is string => id !== null)
    const todos = todoIds.length
      ? await access.db
          .select({
            id: projectOperations.id,
            number: projectOperations.sourceRecordNumber,
            status: projectOperations.status,
            assigneeName: projectOperations.assigneeName,
          })
          .from(projectOperations)
          .where(and(eq(projectOperations.projectId, projectId), inArray(projectOperations.id, todoIds)))
      : []
    const todoById = new Map(todos.map((todo) => [todo.id, todo]))
    const used = new Set(lines.map((line) => line.pricingSource).filter((id): id is string => id !== null))
    return {
      success: true,
      data: {
        // Turned-off choices stay listed while a line still uses them.
        sources: settings.sources.filter((source) => source.active || used.has(source.id)),
        estimators,
        lines: Object.fromEntries(
          lines.map((line) => [
            line.id,
            { pricingSource: line.pricingSource, todo: line.pricingTodoId ? todoById.get(line.pricingTodoId) ?? null : null },
          ]),
        ),
      },
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not load estimate pricing.") }
  }
}

/**
 * Makes the takeoff to-do for a line priced by our own staff and links it to
 * the line. A line keeps one open takeoff to-do; asking again returns it.
 */
export async function createEstimateLineTakeoffTodo(
  projectId: string,
  estimateId: string,
  lineId: string,
  estimatorUserId: string,
): Promise<Result<EstimateLineTakeoffTodo>> {
  try {
    const access = await estimateAccess(projectId, true)
    if (!access.organizationId) return { success: false, error: "The project organization is required." }
    await requireEditableEstimate(access.db, projectId, estimateId)
    const [line] = await access.db
      .select({
        id: projectEstimateLines.id,
        costCode: projectEstimateLines.costCode,
        costCodeName: projectEstimateLines.costCodeName,
        description: projectEstimateLines.description,
        pricingSource: projectEstimateLines.pricingSource,
        pricingTodoId: projectEstimateLines.pricingTodoId,
      })
      .from(projectEstimateLines)
      .where(and(eq(projectEstimateLines.id, lineId), eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.projectId, projectId)))
      .limit(1)
    if (!line) return { success: false, error: "Estimate line not found." }
    const settings = await readFeatureSettings(access.db, access.organizationId, "estimate-pricing")
    const source = findPricingSource(pricingSourceChoices(settings.sources, line.pricingSource), line.pricingSource)
    if (source?.action !== "takeoff") return { success: false, error: "Only lines priced by our own staff get a takeoff to-do." }

    if (line.pricingTodoId) {
      const [existing] = await access.db
        .select({ id: projectOperations.id, number: projectOperations.sourceRecordNumber, status: projectOperations.status, assigneeName: projectOperations.assigneeName })
        .from(projectOperations)
        .where(and(eq(projectOperations.id, line.pricingTodoId), eq(projectOperations.projectId, projectId)))
        .limit(1)
      if (existing && existing.status !== "complete" && existing.status !== "archived") return { success: true, data: existing }
    }

    const estimator = (await companyStaff(access.db, access.organizationId)).find((staff) => staff.value === estimatorUserId)
    if (!estimator) return { success: false, error: "Choose an estimator from your staff." }
    const [estimate] = await access.db
      .select({ number: projectEstimates.estimateNumber })
      .from(projectEstimates)
      .where(eq(projectEstimates.id, estimateId))
      .limit(1)
    const description = [
      `${source.label} on the estimate.`,
      line.description.trim() !== line.costCodeName.trim() ? `Scope: ${line.description}` : null,
      "Enter the price on the estimate line when the takeoff is done.",
    ]
      .filter((part): part is string => part !== null)
      .join("\n")
    const created = await createProjectTask(projectId, {
      title: takeoffTodoTitle({ costCode: line.costCode, costCodeName: line.costCodeName, estimateNumber: estimate?.number ?? null }),
      description,
      sourceRecordType: "staff_task",
      sourceRecordId: line.id,
      sourceRecordNumber: null,
      assigneeName: estimator.label,
      companyName: null,
      startDate: null,
      dueDate: null,
      priority: "normal",
      externalUrl: `/dashboard/projects/${projectId}/estimate`,
    })
    if (!created.success) return { success: false, error: created.error }
    await updateEstimateLines(access.db, eq(projectEstimateLines.id, line.id), {
      pricingTodoId: created.id,
      updatedAt: new Date().toISOString(),
    })
    revalidateEstimate(projectId)
    return { success: true, data: { id: created.id, number: null, status: "open", assigneeName: estimator.label } }
  } catch (error) {
    return { success: false, error: message(error, "Could not make the takeoff to-do.") }
  }
}
