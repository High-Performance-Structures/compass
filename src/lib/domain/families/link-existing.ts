/**
 * Adopts an existing Compass project as a family phase. The project record and
 * every record linked to it remain intact. When its legacy number differs from
 * the family's canonical phase number, Compass retains the old number as an
 * alias and queues the existing Drive/tracker synchronization workflow.
 */
import { and, eq } from "drizzle-orm"

import { projectExternalLinks, projectNumberAliases, projects } from "@/db/schema"
import { projectFamilies, projectFamilyPhases } from "@/db/schema-project-families"
import type { FamilyAdminContext } from "@/lib/domain/families/access"
import {
  familyFailure,
  projectFamilyDepartment,
  requiredText,
  type FamilyWrite,
  type LinkExistingProjectToFamilyInput,
} from "@/lib/domain/families/rules"
import { insertProjectFamilyPhaseStatement } from "@/lib/domain/families/store"
import { insertProjectNumberAliasIfAbsentStatement } from "@/lib/domain/project/numbering-store"
import {
  insertProjectProfileSyncOperationStatement,
  updateProjectExternalLinksStatement,
  updateProjectsStatement,
  type Statement,
} from "@/lib/domain/project/store"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { projectFamilyProjectNumber } from "@/lib/project-family"

type ExistingProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string
  readonly department: string | null
  readonly jobStatusId: string
  readonly googleDriveFolderId: string | null
}

/** Why the canonical phase number or sequence cannot be used, if it cannot. */
async function phaseConflictError(
  context: FamilyAdminContext,
  input: LinkExistingProjectToFamilyInput,
  project: ExistingProject,
  canonicalProjectNumber: string,
): Promise<string | null> {
  const [
    sequenceConflict,
    linkedConflict,
    projectNumberConflict,
    aliasConflict,
    phaseNumberConflict,
  ] = await Promise.all([
    context.db
      .select({ id: projectFamilyPhases.id })
      .from(projectFamilyPhases)
      .where(
        and(
          eq(projectFamilyPhases.familyId, input.familyId),
          eq(projectFamilyPhases.sequence, input.sequence),
        ),
      )
      .limit(1)
      .get(),
    context.db
      .select({ id: projectFamilyPhases.id })
      .from(projectFamilyPhases)
      .where(eq(projectFamilyPhases.projectId, project.id))
      .limit(1)
      .get(),
    context.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, context.organizationId),
          eq(projects.projectNumber, canonicalProjectNumber),
        ),
      )
      .limit(1)
      .get(),
    context.db
      .select({ projectId: projectNumberAliases.projectId })
      .from(projectNumberAliases)
      .where(
        and(
          eq(projectNumberAliases.organizationId, context.organizationId),
          eq(projectNumberAliases.projectNumber, canonicalProjectNumber),
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
          eq(projectFamilies.organizationId, context.organizationId),
          eq(projectFamilyPhases.projectNumber, canonicalProjectNumber),
        ),
      )
      .limit(1)
      .get(),
  ])
  if (sequenceConflict) return "That phase is already used in this family."
  if (linkedConflict) return "That project already belongs to a family."
  if (projectNumberConflict && projectNumberConflict.id !== project.id) {
    return `${canonicalProjectNumber} is already in use.`
  }
  if (aliasConflict && aliasConflict.projectId !== project.id) {
    return `${canonicalProjectNumber} is a historical number for another project.`
  }
  if (phaseNumberConflict) return `${canonicalProjectNumber} is already assigned to a planned phase.`
  return null
}

/** The phase, renumbering, alias, sync and audit writes, in their original batch order. */
function linkStatements(input: {
  readonly context: FamilyAdminContext
  readonly link: LinkExistingProjectToFamilyInput
  readonly project: ExistingProject
  readonly canonicalProjectNumber: string
  readonly canonicalDepartment: "O" | "H" | "N" | "D"
  readonly phaseId: string
  readonly phaseName: string
  readonly now: string
}): [Statement, ...Statement[]] {
  const { context, project, canonicalProjectNumber, canonicalDepartment, now } = input
  const changedNumber = project.projectNumber !== canonicalProjectNumber
  const phaseInsert = insertProjectFamilyPhaseStatement(context.db, {
    id: input.phaseId,
    familyId: input.link.familyId,
    projectId: project.id,
    projectNumber: canonicalProjectNumber,
    googleDriveFolderId: project.googleDriveFolderId,
    sequence: input.link.sequence,
    name: input.phaseName,
    description: "Linked from an existing Compass project.",
    jobStatusId: project.jobStatusId,
    originatingChangeOrderId: null,
    authorizedContractAmountCents: null,
    authorizedAt: null,
    createdBy: context.user.id,
    createdAt: now,
    updatedAt: now,
  })
  const auditInsert = recordProjectAudit(context.db, {
    organizationId: context.organizationId,
    projectId: project.id,
    actorUserId: context.user.id,
    eventType: "project.family_phase_linked_existing",
    entityType: "project_family_phase",
    entityId: input.phaseId,
    beforeJson: JSON.stringify({
      projectNumber: project.projectNumber,
      familyId: null,
    }),
    afterJson: JSON.stringify({
      projectNumber: canonicalProjectNumber,
      previousProjectNumber: changedNumber ? project.projectNumber : null,
      familyId: input.link.familyId,
      sequence: input.link.sequence,
    }),
    createdAt: now,
  })
  const projectScope = and(
    eq(projects.id, project.id),
    eq(projects.organizationId, context.organizationId),
  )

  if (changedNumber) {
    const syncPayload = JSON.stringify({
      previousProjectNumber: project.projectNumber,
      projectNumber: canonicalProjectNumber,
    })
    const syncOperation = (operation: string) => ({
      id: crypto.randomUUID(),
      organizationId: context.organizationId,
      projectId: project.id,
      operation,
      status: "pending",
      payloadJson: syncPayload,
      error: null,
      attempts: 0,
      attemptedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    return [
      phaseInsert,
      updateProjectsStatement(context.db, projectScope, {
        projectNumber: canonicalProjectNumber,
        department: canonicalDepartment,
        updatedAt: now,
      }),
      insertProjectNumberAliasIfAbsentStatement(context.db, {
        id: crypto.randomUUID(),
        organizationId: context.organizationId,
        projectId: project.id,
        projectNumber: project.projectNumber,
        createdBy: context.user.id,
        createdAt: now,
      }),
      updateProjectExternalLinksStatement(
        context.db,
        and(
          eq(projectExternalLinks.projectId, project.id),
          eq(projectExternalLinks.externalNumber, project.projectNumber),
        ),
        { externalNumber: canonicalProjectNumber, updatedAt: now },
      ),
      insertProjectProfileSyncOperationStatement(context.db, [
        syncOperation("drive_folder_rename"),
        syncOperation("tracker_row_update"),
      ]),
      auditInsert,
    ]
  }
  if (project.department !== canonicalDepartment) {
    return [
      phaseInsert,
      updateProjectsStatement(context.db, projectScope, {
        department: canonicalDepartment,
        updatedAt: now,
      }),
      auditInsert,
    ]
  }
  return [phaseInsert, auditInsert]
}

export async function linkExistingProject(
  context: FamilyAdminContext,
  input: LinkExistingProjectToFamilyInput,
): Promise<FamilyWrite> {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 2) {
    return familyFailure("Choose Phase 2 or later.")
  }

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
  const familyBaseNumber =
    basePhase?.phaseProjectNumber ?? basePhase?.projectNumber ?? null
  if (!basePhase || !familyBaseNumber) {
    return familyFailure("The family needs an original numbered project before linking phases.")
  }
  const canonicalProjectNumber = projectFamilyProjectNumber(familyBaseNumber, input.sequence)
  if (!canonicalProjectNumber) {
    return familyFailure("Compass could not build the phase number.")
  }
  const canonicalDepartment = projectFamilyDepartment(canonicalProjectNumber)
  if (!canonicalDepartment) {
    return familyFailure("The family has no valid department.")
  }

  const requestedProjectNumber = requiredText(
    input.projectNumber,
    "Existing project number",
    100,
  ).toUpperCase()
  const found = await context.db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      department: projects.department,
      jobStatusId: projects.jobStatusId,
      googleDriveFolderId: projects.googleDriveFolderId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, context.organizationId),
        eq(projects.projectNumber, requestedProjectNumber),
      ),
    )
    .limit(1)
    .get()
  if (!found || !found.projectNumber) {
    return familyFailure("Existing project not found.")
  }
  const project: ExistingProject = { ...found, projectNumber: found.projectNumber }
  if (project.id === basePhase.projectId) {
    return familyFailure("The original project is already Phase 1.")
  }
  const existingNumberDepartment = projectFamilyDepartment(project.projectNumber)
  if (
    (existingNumberDepartment && existingNumberDepartment !== canonicalDepartment) ||
    (project.department && project.department !== canonicalDepartment)
  ) {
    return familyFailure("An existing project can only be linked to a family in the same department.")
  }

  const conflict = await phaseConflictError(context, input, project, canonicalProjectNumber)
  if (conflict) return familyFailure(conflict)

  const phaseName = requiredText(input.phaseName || project.name, "Phase name", 200)
  const now = new Date().toISOString()
  const phaseId = crypto.randomUUID()
  const changedNumber = project.projectNumber !== canonicalProjectNumber
  const statements = linkStatements({
    context,
    link: input,
    project,
    canonicalProjectNumber,
    canonicalDepartment,
    phaseId,
    phaseName,
    now,
  })
  await context.db.batch(statements)

  return {
    result: {
      success: true,
      id: phaseId,
      projectNumber: canonicalProjectNumber,
      driveStatus: project.googleDriveFolderId ? "provisioned" : "pending",
      warning: changedNumber
        ? "The old project number was retained as an alias. Drive and tracker renames are queued."
        : null,
    },
    revalidate: [
      `/dashboard/projects/${project.id}`,
      ...(basePhase.projectId ? [`/dashboard/projects/${basePhase.projectId}`] : []),
      "/dashboard/projects",
    ],
  }
}
