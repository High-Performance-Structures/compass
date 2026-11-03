/**
 * Creating or relinking a project's Drive folder after intake. A family
 * phase after the first lands inside the family's folder; an existing folder
 * is relinked, never duplicated. Callers check access first.
 */
import { and, eq } from "drizzle-orm"

import { projectExternalLinks, projects } from "@/db/schema"
import { projectFamilies, projectFamilyPhases } from "@/db/schema-project-families"
import { updateProjectFamilies, updateProjectFamiliesStatement, updateProjectFamilyPhasesStatement } from "@/lib/domain/families/store"
import {
  buildProjectDriveFolderName,
  projectDriveTemplateFolderId,
  provisionProjectDriveFolder as provisionGoogleProjectDriveFolder,
  type ProjectDriveProvisioningResult,
} from "@/lib/google/project-drive-provisioning"
import type { ProjectIntakeDepartment } from "@/lib/google/project-intake-tracker"
import type { Db } from "@/lib/server/action-context"

import { intakeDriveReceiptStatements } from "./intake"
import { appendWarning, metadataFolderName, projectDepartment } from "./rules"
import {
  insertProjectExternalLinkStatement,
  updateProjectExternalLinksStatement,
  updateProjectsStatement,
  type Statement,
} from "./store"

type FamilyPhase = {
  readonly phaseId: string
  readonly familyId: string
  readonly sequence: number | null
  readonly phaseFolderId: string | null
  readonly familyFolderId: string | null
}

export type DriveProvisioningTarget = {
  readonly ok: true
  readonly project: { readonly id: string; readonly projectNumber: string; readonly name: string; readonly googleDriveFolderId: string | null }
  readonly familyPhase: FamilyPhase | null
  /** Set only for a family phase after the first. */
  readonly familyParentFolderId: string | null
  readonly department: ProjectIntakeDepartment
  readonly driveLink: { readonly id: string; readonly metadata: string | null } | null
  readonly folderName: string
}

function isLaterPhase(familyPhase: FamilyPhase | null): familyPhase is FamilyPhase {
  return Boolean(familyPhase?.sequence && familyPhase.sequence > 1)
}

/**
 * The family folder a later phase belongs in. A family without one adopts
 * the first phase's folder, and that choice is saved on the family.
 */
async function familyParentFolder(db: Db, familyPhase: FamilyPhase): Promise<string | null> {
  if (familyPhase.familyFolderId) return familyPhase.familyFolderId
  const basePhase = await db
    .select({
      phaseFolderId: projectFamilyPhases.googleDriveFolderId,
      linkedProjectFolderId: projects.googleDriveFolderId,
    })
    .from(projectFamilyPhases)
    .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
    .where(
      and(
        eq(projectFamilyPhases.familyId, familyPhase.familyId),
        eq(projectFamilyPhases.sequence, 1),
      ),
    )
    .limit(1)
    .get()
  const folderId = basePhase?.phaseFolderId ?? basePhase?.linkedProjectFolderId ?? null
  if (folderId) {
    await updateProjectFamilies(db, eq(projectFamilies.id, familyPhase.familyId), {
      googleDriveFolderId: folderId,
      updatedAt: new Date().toISOString(),
    })
  }
  return folderId
}

/** Everything Drive provisioning needs, or the reason it cannot run yet. */
export async function prepareProjectDriveProvisioning(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string },
): Promise<DriveProvisioningTarget | { readonly ok: false; readonly error: string }> {
  const { organizationId, projectId } = input
  const [project] = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
      googleDriveFolderId: projects.googleDriveFolderId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!project) return { ok: false, error: "Project not found" }
  const [familyPhase] = await db
    .select({
      phaseId: projectFamilyPhases.id,
      familyId: projectFamilyPhases.familyId,
      sequence: projectFamilyPhases.sequence,
      phaseFolderId: projectFamilyPhases.googleDriveFolderId,
      familyFolderId: projectFamilies.googleDriveFolderId,
    })
    .from(projectFamilyPhases)
    .innerJoin(projectFamilies, eq(projectFamilies.id, projectFamilyPhases.familyId))
    .where(
      and(
        eq(projectFamilyPhases.projectId, projectId),
        eq(projectFamilies.organizationId, organizationId),
      ),
    )
    .limit(1)
  const phase = familyPhase ?? null
  const familyParentFolderId = isLaterPhase(phase) ? await familyParentFolder(db, phase) : null
  if (isLaterPhase(phase) && !familyParentFolderId) {
    return {
      ok: false,
      error: "The family base project is not mapped to a Google Drive folder yet.",
    }
  }
  const department = projectDepartment(project.projectNumber)
  if (!department || !project.projectNumber) {
    return {
      ok: false,
      error: "Set an O, H, N, or D project number before provisioning Drive.",
    }
  }
  const [driveLink] = await db
    .select({
      id: projectExternalLinks.id,
      metadata: projectExternalLinks.metadata,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, projectId),
        eq(projectExternalLinks.system, "google_drive")
      )
    )
    .limit(1)
  const folderName =
    metadataFolderName(driveLink?.metadata ?? null) ??
    buildProjectDriveFolderName({
      projectNumber: project.projectNumber,
      projectName: project.name,
      streetNumber: null,
      streetName: null,
    })
  return {
    ok: true,
    project: { ...project, projectNumber: project.projectNumber },
    familyPhase: phase,
    familyParentFolderId,
    department,
    driveLink: driveLink ?? null,
    folderName,
  }
}

/** The Drive provisioning options for this target. */
export function driveProvisioningOptions(target: DriveProvisioningTarget): {
  readonly existingFolderId: string | undefined
  readonly parentFolderId: string | undefined
} {
  return {
    existingFolderId:
      target.project.googleDriveFolderId ?? target.familyPhase?.phaseFolderId ?? undefined,
    parentFolderId: isLaterPhase(target.familyPhase)
      ? target.familyParentFolderId ?? undefined
      : undefined,
  }
}

/**
 * The writes that record a provisioned folder, in batch order around the
 * caller's own statements: project, then (caller) Sage handoff, then the
 * family phase, the family (first phase only) and the Drive link.
 */
export function driveProvisionedStatements(
  db: Db,
  input: {
    readonly target: DriveProvisioningTarget
    readonly drive: ProjectDriveProvisioningResult
    readonly now: string
  },
): { readonly projectUpdate: Statement; readonly familyWrites: readonly Statement[]; readonly linkWrite: Statement } {
  const { target, drive, now } = input
  const { project, familyPhase, department, driveLink } = target
  const linkValues = {
    label: "Project Drive folder",
    externalId: drive.folderId,
    externalNumber: null,
    externalUrl: drive.folderUrl,
    syncDirection: "read_write",
    syncStatus: "mapped",
    lastSyncedAt: now,
    metadata: JSON.stringify({
      department,
      folderName: drive.folderName,
      parentFolderId: drive.parentFolderId,
      templateFolderId: projectDriveTemplateFolderId(department),
      childFolderNames: drive.childFolderNames,
      copiedFileCount: drive.copiedFileCount,
    }),
    updatedAt: now,
  }
  const phaseUpdate = familyPhase
    ? updateProjectFamilyPhasesStatement(db, eq(projectFamilyPhases.id, familyPhase.phaseId), {
        projectNumber: project.projectNumber,
        googleDriveFolderId: drive.folderId,
        updatedAt: now,
      })
    : null
  const familyUpdate =
    familyPhase?.sequence === 1
      ? updateProjectFamiliesStatement(db, eq(projectFamilies.id, familyPhase.familyId), {
          googleDriveFolderId: drive.folderId,
          updatedAt: now,
        })
      : null
  return {
    projectUpdate: updateProjectsStatement(db, eq(projects.id, project.id), {
      googleDriveFolderId: drive.folderId,
      updatedAt: now,
    }),
    familyWrites: [...(phaseUpdate ? [phaseUpdate] : []), ...(familyUpdate ? [familyUpdate] : [])],
    linkWrite: driveLink
      ? updateProjectExternalLinksStatement(db, eq(projectExternalLinks.id, driveLink.id), linkValues)
      : insertProjectExternalLinkStatement(db, {
          id: crypto.randomUUID(),
          projectId: project.id,
          system: "google_drive",
          createdAt: now,
          ...linkValues,
        }),
  }
}

/**
 * Intake's Drive step, run after the project rows are saved: create the
 * folder, then save the project, its Drive link and the caller's operation
 * receipt together. Failures leave Drive pending with a warning.
 */
export async function provisionIntakeDriveFolder(
  db: Db,
  input: {
    readonly googleClients: {
      readonly drive: Parameters<typeof provisionGoogleProjectDriveFolder>[0]
      readonly projectIntakeGoogleEmail: string
    }
    readonly googleEmail: string
    readonly department: ProjectIntakeDepartment
    readonly folderName: string
    readonly projectId: string
    readonly driveLinkId: string
    readonly operationReceipt: (folderUrl: string, syncedAt: string) => Statement
  },
): Promise<{
  readonly driveStatus: "provisioned" | "pending"
  readonly projectDriveUrl: string | null
  readonly warning: string | null
}> {
  const { googleClients, department } = input
  let warning: string | null = null
  let driveStatus: "provisioned" | "pending" = "provisioned"
  let projectDriveUrl: string | null = null
  try {
    const drive = await provisionGoogleProjectDriveFolder(
      googleClients.drive,
      input.googleEmail,
      {
        department,
        folderName: input.folderName,
        templateEmail: googleClients.projectIntakeGoogleEmail,
      }
    )
    projectDriveUrl = drive.folderUrl
    const syncedAt = new Date().toISOString()
    try {
      await db.batch([
        ...intakeDriveReceiptStatements(db, {
          projectId: input.projectId,
          driveLinkId: input.driveLinkId,
          department,
          drive,
          syncedAt,
        }),
        input.operationReceipt(drive.folderUrl, syncedAt),
      ])
    } catch (error) {
      driveStatus = "pending"
      warning = appendWarning(
        warning,
        "The Drive folder was created, but Compass could not save its link. Use Create Drive folder on the project page; it will reuse the folder."
      )
      console.error("Unable to save the project Drive receipt", error)
    }
  } catch (error) {
    driveStatus = "pending"
    warning = appendWarning(
      warning,
      "Google Drive setup is pending. The Compass project is safe to use; retry Drive setup from the Project Registry."
    )
    console.error("Unable to provision the project Drive folder", error)
  }
  return { driveStatus, projectDriveUrl, warning }
}
