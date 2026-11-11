"use server"

import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { loadCompanyFieldAppJobs } from "@/lib/domain/field/field-app-access"
import { fieldAppDecisionSummary, type FieldAppJobListRow } from "@/lib/domain/field/field-app-rules"
import { canFeature } from "@/lib/permission-enforcement"
import { resolvedProjectDepartment } from "@/lib/project-branding"
import { orgContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Settings › Workflows › Field app: the company's jobs that aren't closed,
 * with each job's choice and whether it is in the field app now. Changing a
 * job's choice uses updateProjectFieldAppVisibility (project-profile.ts), the
 * same action as the job's Information page.
 */

type FieldAppJobChecklist = {
  readonly canEdit: boolean
  readonly jobs: readonly FieldAppJobListRow[]
}

export async function getFieldAppJobChecklist(): Promise<ActionResult<FieldAppJobChecklist>> {
  try {
    const context = await orgContext({ feature: "project-hub", action: "read" })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isInternalStaffRole(user.role)) return actionFailure("The field app job list is available to internal staff only.")

    const [{ jobs }, canEdit] = await Promise.all([
      loadCompanyFieldAppJobs(db, organizationId),
      canFeature(user, "project-hub", "update"),
    ])
    return {
      success: true,
      data: {
        canEdit,
        jobs: jobs.map((job) => {
          const department = resolvedProjectDepartment({ department: job.department, projectId: job.id, projectNumber: job.projectNumber })
          return {
            id: job.id,
            name: job.name,
            projectNumber: job.projectNumber,
            department,
            jobStatusLabel: job.jobStatusLabel,
            choice: job.decision.choice,
            shown: job.decision.shown,
            summary: fieldAppDecisionSummary(job.decision, department),
          }
        }),
      },
    }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load the field app jobs."))
  }
}
