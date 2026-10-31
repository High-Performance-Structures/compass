/**
 * Creating families and planned phases, and linking projects to phases.
 * Callers resolve `requireFamilyAdminContext` first and revalidate the paths
 * each write returns.
 */
import { and, eq } from "drizzle-orm"

import { projectChangeOrders, projectJobStatuses, projects } from "@/db/schema"
import { projectFamilies, projectFamilyPhases } from "@/db/schema-project-families"
import type { FamilyAdminContext } from "@/lib/domain/families/access"
import { provisionPhaseDriveFolder, saveProjectDriveMapping } from "@/lib/domain/families/drive"
import {
  driveFolderUrl,
  familyFailure,
  newPhaseInputError,
  nullableLimitedText,
  requiredText,
  type CreateProjectFamilyFromProjectInput,
  type CreateProjectFamilyPhaseInput,
  type FamilyWrite,
  type LinkProjectToFamilyPhaseInput,
} from "@/lib/domain/families/rules"
import {
  insertProjectFamilyPhase,
  insertProjectFamilyPhaseStatement,
  insertProjectFamilyStatement,
  updateProjectFamilyPhases,
} from "@/lib/domain/families/store"
import { updateProjects } from "@/lib/domain/project/store"
import { projectFamilyProjectNumber } from "@/lib/project-family"
import { isBuiltInProjectJobStatusId } from "@/lib/project-profile"
import { cleanText } from "@/lib/shared/guards"

/**
 * Seeds the family model around an existing project without creating any
 * additional project, contract, or change-order records.
 */
export async function createFamilyFromProject(
  context: FamilyAdminContext,
  input: CreateProjectFamilyFromProjectInput,
): Promise<FamilyWrite> {
  const project = await context.db
    .select({
      id: projects.id,
      name: projects.name,
      clientName: projects.clientName,
      address: projects.address,
      jobStatusId: projects.jobStatusId,
      projectNumber: projects.projectNumber,
      googleDriveFolderId: projects.googleDriveFolderId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.organizationId, context.organizationId),
      ),
    )
    .limit(1)
    .get()
  if (!project) return familyFailure("Project not found.")

  const existingPhase = await context.db
    .select({ id: projectFamilyPhases.id })
    .from(projectFamilyPhases)
    .where(eq(projectFamilyPhases.projectId, input.projectId))
    .limit(1)
    .get()
  if (existingPhase) {
    return familyFailure("This project already belongs to a project family.")
  }

  const now = new Date().toISOString()
  const familyId = `family-${crypto.randomUUID()}`
  const phaseId = crypto.randomUUID()
  const familyName = requiredText(input.familyName || project.name, "Family name", 200)
  const phaseName = requiredText(input.phaseName || project.name, "Phase name", 200)
  await context.db.batch([
    insertProjectFamilyStatement(context.db, {
      id: familyId,
      organizationId: context.organizationId,
      name: familyName,
      description: null,
      clientName: project.clientName,
      address: project.address,
      status: "OPEN",
      googleDriveFolderId: project.googleDriveFolderId,
      createdBy: context.user.id,
      createdAt: now,
      updatedAt: now,
    }),
    insertProjectFamilyPhaseStatement(context.db, {
      id: phaseId,
      familyId,
      projectId: project.id,
      projectNumber: project.projectNumber,
      googleDriveFolderId: project.googleDriveFolderId,
      sequence: 1,
      name: phaseName,
      description: null,
      jobStatusId: project.jobStatusId,
      originatingChangeOrderId: null,
      authorizedContractAmountCents: null,
      authorizedAt: null,
      createdBy: context.user.id,
      createdAt: now,
      updatedAt: now,
    }),
  ])
  return {
    result: { success: true, id: familyId },
    revalidate: [`/dashboard/projects/${input.projectId}`, "/dashboard/projects"],
  }
}

/** The originating change order must be on a project in the same family. */
async function originatingChangeOrderError(
  context: FamilyAdminContext,
  input: CreateProjectFamilyPhaseInput,
): Promise<string | null> {
  if (!input.originatingChangeOrderId) return null
  const originatingChangeOrder = await context.db
    .select({ projectId: projectChangeOrders.projectId })
    .from(projectChangeOrders)
    .innerJoin(projects, eq(projects.id, projectChangeOrders.projectId))
    .where(
      and(
        eq(projectChangeOrders.id, input.originatingChangeOrderId),
        eq(projects.organizationId, context.organizationId),
      ),
    )
    .limit(1)
    .get()
  if (!originatingChangeOrder) return "Originating change order not found."
  const sourcePhase = await context.db
    .select({ familyId: projectFamilyPhases.familyId })
    .from(projectFamilyPhases)
    .where(eq(projectFamilyPhases.projectId, originatingChangeOrder.projectId))
    .limit(1)
    .get()
  if (!sourcePhase || sourcePhase.familyId !== input.familyId) {
    return "The originating change order must belong to this project family."
  }
  return null
}

export async function createFamilyPhase(
  context: FamilyAdminContext,
  input: CreateProjectFamilyPhaseInput,
): Promise<FamilyWrite> {
  const inputError = newPhaseInputError(input)
  if (inputError) return familyFailure(inputError)
  const family = await context.db
    .select({ id: projectFamilies.id })
    .from(projectFamilies)
    .where(
      and(
        eq(projectFamilies.id, input.familyId),
        eq(projectFamilies.organizationId, context.organizationId),
      ),
    )
    .limit(1)
    .get()
  if (!family) return familyFailure("Project family not found.")

  const basePhase = await context.db
    .select({
      projectId: projectFamilyPhases.projectId,
      phaseProjectNumber: projectFamilyPhases.projectNumber,
      projectNumber: projects.projectNumber,
    })
    .from(projectFamilyPhases)
    .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
    .where(
      and(
        eq(projectFamilyPhases.familyId, input.familyId),
        eq(projectFamilyPhases.sequence, 1),
      ),
    )
    .limit(1)
    .get()
  if (!basePhase) {
    return familyFailure("Create the family from its original project before adding phases.")
  }
  const familyBaseNumber = basePhase.phaseProjectNumber ?? basePhase.projectNumber
  if (!familyBaseNumber) {
    return familyFailure("The original project needs a valid project number before adding phases.")
  }
  const projectNumber = projectFamilyProjectNumber(familyBaseNumber, input.sequence)
  if (!projectNumber) {
    return familyFailure("Compass could not build the phased project number.")
  }

  const customStatus = await context.db
    .select({ id: projectJobStatuses.id })
    .from(projectJobStatuses)
    .where(
      and(
        eq(projectJobStatuses.id, input.jobStatusId),
        eq(projectJobStatuses.organizationId, context.organizationId),
        eq(projectJobStatuses.active, true),
      ),
    )
    .limit(1)
    .get()
  if (!isBuiltInProjectJobStatusId(input.jobStatusId) && !customStatus) {
    return familyFailure("Choose a valid phase job status.")
  }

  const existingSequence = await context.db
    .select({ id: projectFamilyPhases.id })
    .from(projectFamilyPhases)
    .where(
      and(
        eq(projectFamilyPhases.familyId, input.familyId),
        eq(projectFamilyPhases.sequence, input.sequence),
      ),
    )
    .limit(1)
    .get()
  if (existingSequence) {
    return familyFailure("That phase sequence is already used in this family.")
  }

  const [existingProject, existingPhaseNumber] = await Promise.all([
    context.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, context.organizationId),
          eq(projects.projectNumber, projectNumber),
        ),
      )
      .limit(1)
      .get(),
    context.db
      .select({ id: projectFamilyPhases.id })
      .from(projectFamilyPhases)
      .innerJoin(projectFamilies, eq(projectFamilies.id, projectFamilyPhases.familyId))
      .where(
        and(
          eq(projectFamilyPhases.projectNumber, projectNumber),
          eq(projectFamilies.organizationId, context.organizationId),
        ),
      )
      .limit(1)
      .get(),
  ])
  if (existingProject || existingPhaseNumber) {
    return familyFailure(`Project number ${projectNumber} is already in use.`)
  }

  const changeOrderError = await originatingChangeOrderError(context, input)
  if (changeOrderError) return familyFailure(changeOrderError)

  const phaseName = requiredText(input.name, "Phase name", 200)
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  await insertProjectFamilyPhase(context.db, {
    id,
    familyId: input.familyId,
    projectId: null,
    projectNumber,
    googleDriveFolderId: null,
    sequence: input.sequence,
    name: phaseName,
    description: nullableLimitedText(input.description, "Description", 4_000),
    jobStatusId: input.jobStatusId,
    originatingChangeOrderId: cleanText(input.originatingChangeOrderId),
    authorizedContractAmountCents: input.authorizedContractAmountCents,
    authorizedAt: cleanText(input.authorizedAt),
    createdBy: context.user.id,
    createdAt: now,
    updatedAt: now,
  })
  let driveStatus: "provisioned" | "pending" = "pending"
  let warning: string | null = null
  try {
    const drive = await provisionPhaseDriveFolder(context, id)
    if (!drive.success) {
      warning = drive.error
    } else {
      driveStatus = "provisioned"
    }
  } catch (error) {
    warning =
      error instanceof Error
        ? error.message
        : "Google Drive setup is pending for this phase."
  }
  return {
    result: { success: true, id, projectNumber, driveStatus, warning },
    revalidate: [
      "/dashboard/projects",
      ...(basePhase.projectId ? [`/dashboard/projects/${basePhase.projectId}`] : []),
    ],
  }
}

async function linkProjectToPhase(
  context: FamilyAdminContext,
  input: LinkProjectToFamilyPhaseInput,
): Promise<FamilyWrite> {
  const phase = await context.db
    .select({
      id: projectFamilyPhases.id,
      familyId: projectFamilyPhases.familyId,
      projectId: projectFamilyPhases.projectId,
      projectNumber: projectFamilyPhases.projectNumber,
      googleDriveFolderId: projectFamilyPhases.googleDriveFolderId,
    })
    .from(projectFamilyPhases)
    .innerJoin(projectFamilies, eq(projectFamilies.id, projectFamilyPhases.familyId))
    .where(
      and(
        eq(projectFamilyPhases.id, input.phaseId),
        eq(projectFamilies.organizationId, context.organizationId),
      ),
    )
    .limit(1)
    .get()
  if (!phase) return familyFailure("Project phase not found.")
  if (phase.projectId && phase.projectId !== input.projectId) {
    return familyFailure("This phase is already linked to a project.")
  }

  const project = await context.db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      googleDriveFolderId: projects.googleDriveFolderId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.organizationId, context.organizationId),
      ),
    )
    .limit(1)
    .get()
  if (!project) return familyFailure("Project not found.")
  if (phase.projectNumber && project.projectNumber !== phase.projectNumber) {
    return familyFailure(`Link the project numbered ${phase.projectNumber} to this phase.`)
  }
  if (
    phase.googleDriveFolderId &&
    project.googleDriveFolderId &&
    phase.googleDriveFolderId !== project.googleDriveFolderId
  ) {
    return familyFailure(
      "This project already has a different Drive folder. Move or reconcile that folder before linking the phase.",
    )
  }
  if (!phase.googleDriveFolderId && project.googleDriveFolderId) {
    return familyFailure(
      "This project already has a Drive folder outside the family parent. Move it into the phase folder before linking.",
    )
  }

  const existingPhase = await context.db
    .select({ id: projectFamilyPhases.id })
    .from(projectFamilyPhases)
    .where(eq(projectFamilyPhases.projectId, input.projectId))
    .limit(1)
    .get()
  if (existingPhase && existingPhase.id !== phase.id) {
    return familyFailure("Project is already linked to another phase.")
  }

  const now = new Date().toISOString()
  await updateProjectFamilyPhases(context.db, eq(projectFamilyPhases.id, phase.id), {
    projectId: input.projectId,
    projectNumber: phase.projectNumber ?? project.projectNumber,
    googleDriveFolderId: phase.googleDriveFolderId,
    updatedAt: now,
  })
  let driveStatus: "provisioned" | "pending" = phase.googleDriveFolderId
    ? "provisioned"
    : "pending"
  let warning: string | null = null
  let folderId = phase.googleDriveFolderId
  let folderUrl = folderId ? driveFolderUrl(folderId) : null
  if (!phase.googleDriveFolderId) {
    try {
      const drive = await provisionPhaseDriveFolder(context, phase.id)
      if (!drive.success) {
        warning = drive.error
      } else {
        driveStatus = "provisioned"
        folderId = drive.folderId
        folderUrl = drive.folderUrl
      }
    } catch (error) {
      warning =
        error instanceof Error
          ? error.message
          : "Google Drive setup is pending for this phase."
    }
  }
  if (folderId && folderUrl) {
    const mappedAt = new Date().toISOString()
    await updateProjects(context.db, eq(projects.id, input.projectId), {
      googleDriveFolderId: folderId,
      updatedAt: mappedAt,
    })
    await saveProjectDriveMapping({
      db: context.db,
      projectId: input.projectId,
      folderId,
      folderUrl,
      phaseId: phase.id,
      now: mappedAt,
    })
  }
  return {
    result: { success: true, id: phase.id, driveStatus, warning },
    revalidate: [`/dashboard/projects/${input.projectId}`, "/dashboard/projects"],
  }
}

/** Links a newly activated project to its phase; failures come back as a result. */
export async function linkProjectToFamilyPhase(
  context: FamilyAdminContext,
  input: LinkProjectToFamilyPhaseInput,
): Promise<FamilyWrite> {
  try {
    return await linkProjectToPhase(context, input)
  } catch (error) {
    return familyFailure(error instanceof Error ? error.message : "Unable to link project phase.")
  }
}
