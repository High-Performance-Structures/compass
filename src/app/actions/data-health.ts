"use server"

import { actionFailure, type ActionFailure } from "@/lib/action-result"
import { findingsByValue, isHealthy, reportForOrganization, type SchemaDrift, type StatusFinding } from "@/lib/domain/data-health/rules"
import { runDataHealthCheck } from "@/lib/domain/data-health/run"
import { activeStaff } from "@/lib/domain/identity/reads"
import { orgContext } from "@/lib/server/action-context"
import { isAdminRole, isInternalStaffRole } from "@/lib/user-roles"

/** Settings › Workflows › Data health: the staff who may get the notice. */
export async function getDataHealthStaff(): Promise<
  { readonly success: true; readonly data: readonly { readonly id: string; readonly name: string }[] } | ActionFailure
> {
  const context = await orgContext()
  if (!context.success) return context
  if (!isInternalStaffRole(context.data.user.role)) return actionFailure("Only staff can see this.")
  return { success: true, data: await activeStaff(context.data.db, context.data.organizationId) }
}

export type DataHealthView = {
  readonly healthy: boolean
  readonly checkedAt: string
  readonly statusChecks: number
  readonly statusFindings: readonly StatusFinding[]
  readonly schema: SchemaDrift
}

/** Runs the read-only drift check now for the admin's company. Sends no notice. */
export async function checkDataHealthNow(): Promise<{ readonly success: true; readonly data: DataHealthView } | ActionFailure> {
  const context = await orgContext()
  if (!context.success) return context
  if (!isAdminRole(context.data.user.role)) return actionFailure("Only administrators can run the data health check.")
  try {
    const report = reportForOrganization(await runDataHealthCheck(context.data.db), context.data.organizationId)
    return {
      success: true,
      data: {
        healthy: isHealthy(report),
        checkedAt: report.checkedAt,
        statusChecks: report.statusChecks,
        statusFindings: findingsByValue(report.statusFindings),
        schema: report.schema,
      },
    }
  } catch (error) {
    return actionFailure(error instanceof Error ? error.message : "The data health check failed.")
  }
}
