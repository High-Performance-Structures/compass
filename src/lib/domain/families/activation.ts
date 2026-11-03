/**
 * Turning an authorized planned phase into a normal Compass project. The
 * action creates the project shell between `prepareFamilyPhaseActivation`
 * and `finishFamilyPhaseActivation`; the phase number comes from the family
 * record so this path cannot consume the next top-level project sequence.
 */
import { and, eq } from "drizzle-orm"

import { customers, projectContacts, projects } from "@/db/schema"
import { projectFamilies, projectFamilyPhases } from "@/db/schema-project-families"
import type { FamilyAdminContext } from "@/lib/domain/families/access"
import { linkProjectToFamilyPhase } from "@/lib/domain/families/phases"
import {
  projectFamilyDepartment,
  trackerPendingWarning,
  type FamilyWrite,
} from "@/lib/domain/families/rules"
import { savePhaseTrackerLink, syncPhaseTrackerRows } from "@/lib/domain/families/trackers"
import type { CreateProjectShellInput } from "@/lib/domain/project/intake-types"
import {
  departmentTrackingDestination,
  PROJECT_REGISTRY_DESTINATION,
} from "@/lib/google/project-intake-tracker"
import { baseProjectNumber, projectNumberPhaseNumber } from "@/lib/project-profile"
import { parseSageClientStatusId, parseSageJobTypeId } from "@/lib/sage/client-project-write"

export type PhaseActivationPlan = {
  readonly phase: { readonly name: string; readonly projectNumber: string }
  readonly baseProjectId: string
  readonly department: "O" | "H" | "N" | "D"
  readonly shellInput: CreateProjectShellInput
}

export type PreparedActivation =
  | { readonly success: true; readonly plan: PhaseActivationPlan }
  | { readonly success: false; readonly error: string }

export async function prepareFamilyPhaseActivation(
  context: FamilyAdminContext,
  phaseId: string,
): Promise<PreparedActivation> {
  const phase = await context.db
    .select({
      id: projectFamilyPhases.id,
      familyId: projectFamilyPhases.familyId,
      projectId: projectFamilyPhases.projectId,
      projectNumber: projectFamilyPhases.projectNumber,
      name: projectFamilyPhases.name,
      jobStatusId: projectFamilyPhases.jobStatusId,
      authorizedAt: projectFamilyPhases.authorizedAt,
      originatingChangeOrderId: projectFamilyPhases.originatingChangeOrderId,
    })
    .from(projectFamilyPhases)
    .innerJoin(projectFamilies, eq(projectFamilies.id, projectFamilyPhases.familyId))
    .where(
      and(
        eq(projectFamilyPhases.id, phaseId),
        eq(projectFamilies.organizationId, context.organizationId),
      ),
    )
    .limit(1)
    .get()
  if (!phase) return { success: false, error: "Project phase not found." }
  if (phase.projectId) {
    return { success: false, error: "This phase is already an active Compass project." }
  }
  if (!phase.projectNumber) {
    return { success: false, error: "The phase does not have a project number." }
  }
  if (!phase.authorizedAt && !phase.originatingChangeOrderId) {
    return {
      success: false,
      error: "Authorize the phase with contract data or an originating change order before creating its Sage project.",
    }
  }
  const phaseNumber = projectNumberPhaseNumber(phase.projectNumber)
  const baseNumber = baseProjectNumber(phase.projectNumber)
  if (phaseNumber === null || !baseNumber) {
    return { success: false, error: "The phase number is not a valid phased project number." }
  }

  const baseProject = await context.db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      department: projects.department,
      name: projects.name,
      status: projects.status,
      address: projects.address,
      clientName: projects.clientName,
      projectManager: projects.projectManager,
      sageJobTypeName: projects.sageJobTypeName,
    })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, context.organizationId),
        eq(projects.projectNumber, baseNumber),
      ),
    )
    .limit(1)
    .get()
  if (!baseProject) {
    return { success: false, error: "The original project for this phase was not found." }
  }
  const department = projectFamilyDepartment(baseNumber)
  if (!department) {
    return { success: false, error: "The original project has no supported department." }
  }
  const customer = await context.db
    .select({ sageClientStatusId: customers.sageClientStatusId })
    .from(projectContacts)
    .innerJoin(customers, eq(customers.id, projectContacts.sourceEntityId))
    .where(
      and(
        eq(projectContacts.projectId, baseProject.id),
        eq(projectContacts.sourceEntityType, "customer"),
      ),
    )
    .limit(1)
    .get()
  return {
    success: true,
    plan: {
      phase: { name: phase.name, projectNumber: phase.projectNumber },
      baseProjectId: baseProject.id,
      department,
      shellInput: {
        projectNumber: phase.projectNumber,
        name: phase.name,
        department,
        clientName: baseProject.clientName,
        address: baseProject.address,
        status: baseProject.status,
        sageClientStatusId:
          parseSageClientStatusId(customer?.sageClientStatusId) ?? 1,
        sageJobStatusId: phase.jobStatusId,
        sageJobType:
          parseSageJobTypeId(baseProject.sageJobTypeName?.toLowerCase() ?? "customer") ??
          "customer",
        confirmedDistinctProjectIds: [baseProject.id],
      },
    },
  }
}

/** Links the created project to its phase and writes its registry/tracker rows. */
export async function finishFamilyPhaseActivation(
  context: FamilyAdminContext,
  input: {
    readonly phaseId: string
    readonly plan: PhaseActivationPlan
    readonly createdProjectId: string
  },
): Promise<FamilyWrite> {
  const { plan, createdProjectId } = input
  const linked = await linkProjectToFamilyPhase(context, {
    phaseId: input.phaseId,
    projectId: createdProjectId,
  })
  if (!linked.result.success) {
    return {
      result: {
        success: false,
        error: `Phase project ${plan.phase.projectNumber} was created, but Compass could not finish linking it: ${linked.result.error}`,
      },
      revalidate: linked.revalidate,
    }
  }

  const project = await context.db
    .select({
      projectNumber: projects.projectNumber,
      clientName: projects.clientName,
      address: projects.address,
      projectManager: projects.projectManager,
      googleDriveFolderId: projects.googleDriveFolderId,
    })
    .from(projects)
    .where(eq(projects.id, createdProjectId))
    .limit(1)
    .get()
  if (!project?.projectNumber) {
    return {
      result: {
        success: false,
        error: "Phase project was created, but its project number could not be read back.",
      },
      revalidate: linked.revalidate,
    }
  }

  const projectNumber = project.projectNumber
  const department = plan.department
  const now = new Date().toISOString()
  let warning = linked.result.warning ?? null
  const registryLink = (syncStatus: "mapped" | "pending", metadata: Record<string, unknown>) =>
    savePhaseTrackerLink({
      db: context.db,
      projectId: createdProjectId,
      system: "google_project_registry",
      label: PROJECT_REGISTRY_DESTINATION.workbookTitle,
      spreadsheetId: PROJECT_REGISTRY_DESTINATION.spreadsheetId,
      projectNumber,
      syncStatus,
      metadata,
      now,
    })
  const departmentLink = (syncStatus: "mapped" | "pending", metadata: Record<string, unknown>) =>
    savePhaseTrackerLink({
      db: context.db,
      projectId: createdProjectId,
      system: "google_department_tracker",
      label: `${department} department tracker`,
      spreadsheetId: departmentTrackingDestination(department).spreadsheetId,
      projectNumber,
      syncStatus,
      metadata,
      now,
    })
  try {
    const trackerWrites = await syncPhaseTrackerRows({
      context,
      phase: plan.phase,
      project: {
        projectNumber,
        clientName: project.clientName,
        address: project.address,
        projectManager: project.projectManager,
        googleDriveFolderId: project.googleDriveFolderId,
      },
      now,
    })
    await Promise.all([
      registryLink("mapped", {
        sheet: PROJECT_REGISTRY_DESTINATION.sheetTitle,
        updatedRange: trackerWrites.registry.updatedRange,
        alreadyPresent: trackerWrites.registry.alreadyPresent,
      }),
      departmentLink("mapped", {
        sheet: departmentTrackingDestination(department).sheetTitle,
        updatedRange: trackerWrites.department.updatedRange,
        alreadyPresent: trackerWrites.department.alreadyPresent,
      }),
    ])
  } catch (error) {
    warning = trackerPendingWarning(warning, error)
    await Promise.all([
      registryLink("pending", { sheet: PROJECT_REGISTRY_DESTINATION.sheetTitle, error: warning }),
      departmentLink("pending", { sheet: departmentTrackingDestination(department).sheetTitle, error: warning }),
    ])
  }

  return {
    result: {
      success: true,
      id: createdProjectId,
      projectNumber,
      driveStatus: linked.result.driveStatus,
      warning,
    },
    revalidate: [
      ...linked.revalidate,
      `/dashboard/projects/${createdProjectId}`,
      `/dashboard/projects/${plan.baseProjectId}`,
      "/dashboard/projects",
    ],
  }
}

