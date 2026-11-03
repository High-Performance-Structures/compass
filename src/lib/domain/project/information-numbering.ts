/**
 * Registry administrators correcting a project number from cutover review
 * or resolving a department-and-sequence collision. The old number is kept
 * as an alias, the reservation follows the new number, and Google sync
 * operations are queued for the caller to run.
 */
import { and, eq, or } from "drizzle-orm"

import {
  projectExternalLinks,
  projectNumberAliases,
  projectNumberReservations,
  projectNumberRetirements,
  projects,
} from "@/db/schema"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import {
  insertProjectNumberAliasIfAbsentStatement,
  insertProjectNumberReservationStatement,
  updateProjectNumberReservationsStatement,
} from "@/lib/domain/project/numbering-store"
import { projectProfileContext } from "@/lib/domain/project/profile-access"
import {
  insertProjectProfileSyncOperationStatement,
  updateProjectExternalLinksStatement,
  updateProjectsStatement,
} from "@/lib/domain/project/store"
import type { ProjectInformationSave } from "@/lib/domain/project/information"
import { canManageProjectRegistry } from "@/lib/permissions"
import { isProjectDepartment } from "@/lib/project-branding"
import { projectNumberDepartmentSequence, projectNumberReviewIssue } from "@/lib/project-number-review"
import { projectNumberParts } from "@/lib/project-profile"

export type ProjectNumberCorrectionInput =
  | {
      readonly projectId: string
      readonly approvedProjectNumber: string
      readonly reason: "number_review"
    }
  | {
      readonly projectId: string
      readonly approvedProjectNumber: string
      readonly reason: "number_collision"
      readonly conflictingProjectId: string
    }

function refused(error: string): ProjectInformationSave {
  return { result: { success: false, error }, syncOperationIds: [] }
}

/** Throws on unexpected failures; the action reports the thrown message. */
export async function correctProjectNumber(input: ProjectNumberCorrectionInput): Promise<ProjectInformationSave> {
  const { db, organizationId, user } = await projectProfileContext(
    input.projectId,
    "update",
  )
  if (!canManageProjectRegistry(user)) {
    return refused("Project-number corrections are limited to registry administrators.")
  }
  if (isDemoUser(user.id) || isDemoOrg(organizationId)) {
    return refused("Demo data cannot be changed.")
  }

  const existingRows = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      department: projects.department,
      name: projects.name,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.organizationId, organizationId),
      ),
    )
    .limit(1)
  const existing = existingRows[0]
  if (!existing) return refused("Project not found.")

  const reviewIssue = projectNumberReviewIssue(
    existing.projectNumber,
    existing.name,
  )
  if (!existing.projectNumber) {
    return refused("This project number is unavailable.")
  }

  let requiredDepartment = reviewIssue?.department ?? existing.department
  let collisionDepartmentSequence: string | null = null
  if (input.reason === "number_review") {
    if (!reviewIssue) {
      return refused("This project number no longer requires cutover review.")
    }
  } else {
    if (input.conflictingProjectId === existing.id) {
      return refused("Choose two different projects.")
    }
    const conflictingRows = await db
      .select({
        projectNumber: projects.projectNumber,
        name: projects.name,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.conflictingProjectId),
          eq(projects.organizationId, organizationId),
        ),
      )
      .limit(1)
    const conflicting = conflictingRows[0]
    const existingDepartmentSequence = projectNumberDepartmentSequence(
      existing.projectNumber,
      existing.name,
    )
    const conflictingDepartmentSequence = projectNumberDepartmentSequence(
      conflicting?.projectNumber ?? null,
      conflicting?.name ?? null,
    )
    if (
      !conflicting ||
      !existingDepartmentSequence ||
      existingDepartmentSequence !== conflictingDepartmentSequence
    ) {
      return refused("These projects no longer share a department and sequence.")
    }
    collisionDepartmentSequence = existingDepartmentSequence
    const collisionDepartment = existingDepartmentSequence.slice(0, 1)
    requiredDepartment =
      requiredDepartment ??
      reviewIssue?.department ??
      (isProjectDepartment(collisionDepartment) ? collisionDepartment : null)
  }

  const approvedProjectNumber = input.approvedProjectNumber.trim().toUpperCase()
  const parts = projectNumberParts(approvedProjectNumber)
  if (!parts) {
    return refused("Enter an approved number in DEPARTMENT-SEQUENCE-SUFFIX format.")
  }
  if (
    (requiredDepartment !== null && parts.department !== requiredDepartment) ||
    (existing.department !== null && parts.department !== existing.department)
  ) {
    return refused("The approved number must stay in the project's current department.")
  }
  if (approvedProjectNumber === existing.projectNumber.toUpperCase()) {
    return refused("Enter a corrected project number.")
  }
  const approvedDepartmentSequence = projectNumberDepartmentSequence(
    approvedProjectNumber,
  )
  if (
    collisionDepartmentSequence !== null &&
    approvedDepartmentSequence === collisionDepartmentSequence
  ) {
    return refused("Assign a new sequential number to resolve this collision.")
  }

  const sequence = Number(parts.sequence)
  const [projectConflicts, aliasConflicts, reservationNumberConflicts, retirementConflicts, reservationSequenceConflicts, projectReservations] =
    await Promise.all([
      db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, organizationId),
            eq(projects.projectNumber, approvedProjectNumber),
          ),
        )
        .limit(1),
      db
        .select({ projectId: projectNumberAliases.projectId })
        .from(projectNumberAliases)
        .where(
          and(
            eq(projectNumberAliases.organizationId, organizationId),
            eq(projectNumberAliases.projectNumber, approvedProjectNumber),
          ),
        )
        .limit(1),
      db
        .select({ projectId: projectNumberReservations.projectId })
        .from(projectNumberReservations)
        .where(
          and(
            eq(projectNumberReservations.organizationId, organizationId),
            eq(projectNumberReservations.projectNumber, approvedProjectNumber),
          ),
        )
        .limit(1),
      db.select({ formerProjectId: projectNumberRetirements.formerProjectId }).from(projectNumberRetirements).where(and(
        eq(projectNumberRetirements.organizationId, organizationId),
        or(eq(projectNumberRetirements.projectNumber, approvedProjectNumber), and(eq(projectNumberRetirements.department, parts.department), eq(projectNumberRetirements.sequence, sequence))),
      )).limit(1),
      db
        .select({ projectId: projectNumberReservations.projectId })
        .from(projectNumberReservations)
        .where(
          and(
            eq(projectNumberReservations.organizationId, organizationId),
            eq(projectNumberReservations.department, parts.department),
            eq(projectNumberReservations.sequence, sequence),
          ),
        )
        .limit(1),
      db
        .select({ id: projectNumberReservations.id })
        .from(projectNumberReservations)
        .where(
          and(
            eq(projectNumberReservations.organizationId, organizationId),
            eq(projectNumberReservations.projectId, existing.id),
          ),
        )
        .limit(1),
    ])

  if (projectConflicts[0] && projectConflicts[0].id !== existing.id) {
    return refused("That approved number already belongs to another project. Use Merge into existing project instead.")
  }
  if (aliasConflicts[0] && aliasConflicts[0].projectId !== existing.id) {
    return refused("That approved number is a historical alias for another project. Review that project before continuing.")
  }
  const reservationConflict =
    reservationNumberConflicts[0] ?? reservationSequenceConflicts[0]
  if (reservationConflict && reservationConflict.projectId !== existing.id) {
    return refused("That department and sequence are reserved by another project. Use Merge into existing project instead.")
  }
  if (retirementConflicts[0] && retirementConflicts[0].formerProjectId !== existing.id) return refused("That department and sequence were retired with a removed project.")

  const updatedAt = new Date().toISOString()
  const driveOperationId = crypto.randomUUID()
  const trackerOperationId = crypto.randomUUID()
  const syncPayload = JSON.stringify({
    previousProjectNumber: existing.projectNumber,
    projectNumber: approvedProjectNumber,
  })
  const reservation = projectReservations[0]
    ? updateProjectNumberReservationsStatement(db, eq(projectNumberReservations.id, projectReservations[0].id), {
        department: parts.department,
        sequence,
        projectNumber: approvedProjectNumber,
      })
    : insertProjectNumberReservationStatement(db, {
        id: crypto.randomUUID(),
        organizationId,
        projectId: existing.id,
        department: parts.department,
        sequence,
        projectNumber: approvedProjectNumber,
        createdAt: updatedAt,
      })

  const pending = {
    organizationId,
    projectId: existing.id,
    status: "pending",
    payloadJson: syncPayload,
    error: null,
    attempts: 0,
    attemptedAt: null,
    completedAt: null,
    createdAt: updatedAt,
    updatedAt,
  }
  await db.batch([
    updateProjectsStatement(
      db,
      and(
        eq(projects.id, existing.id),
        eq(projects.organizationId, organizationId),
      ),
      {
        projectNumber: approvedProjectNumber,
        department: parts.department,
        updatedAt,
      },
    ),
    reservation,
    insertProjectNumberAliasIfAbsentStatement(db, {
      id: crypto.randomUUID(),
      organizationId,
      projectId: existing.id,
      projectNumber: existing.projectNumber,
      createdBy: user.id,
      createdAt: updatedAt,
    }),
    updateProjectExternalLinksStatement(
      db,
      and(
        eq(projectExternalLinks.projectId, existing.id),
        eq(projectExternalLinks.externalNumber, existing.projectNumber),
      ),
      { externalNumber: approvedProjectNumber, updatedAt },
    ),
    insertProjectProfileSyncOperationStatement(db, [
      { id: driveOperationId, operation: "drive_folder_rename", ...pending },
      { id: trackerOperationId, operation: "tracker_row_update", ...pending },
    ]),
    recordProjectAudit(db, {
      organizationId,
      projectId: existing.id,
      actorUserId: user.id,
      eventType:
        input.reason === "number_collision"
          ? "project_number_collision_resolved"
          : "project_number_corrected",
      entityType: "project",
      entityId: existing.id,
      beforeJson: JSON.stringify({
        projectNumber: existing.projectNumber,
        department: existing.department,
      }),
      afterJson: JSON.stringify({
        projectNumber: approvedProjectNumber,
        department: parts.department,
        retainedAlias: existing.projectNumber,
      }),
      createdAt: updatedAt,
    }),
  ])
  return { result: { success: true }, syncOperationIds: [driveOperationId, trackerOperationId] }
}
