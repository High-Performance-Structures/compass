/**
 * Google Drive folders for family phases: each phase folder lives under the
 * family's parent folder (the original project's folder), and a linked
 * project records the folder as its Drive mapping.
 */
import { and, eq } from "drizzle-orm"

import { projectExternalLinks, projects } from "@/db/schema"
import { projectFamilies, projectFamilyPhases } from "@/db/schema-project-families"
import { updateProjectFamilies, updateProjectFamilyPhases } from "@/lib/domain/families/store"
import type { FamilyAdminContext } from "@/lib/domain/families/access"
import { driveFolderUrl, projectFamilyDepartment } from "@/lib/domain/families/rules"
import { insertProjectExternalLink, updateProjectExternalLinks } from "@/lib/domain/project/store"
import { provisionProjectDriveFolder as provisionGoogleProjectDriveFolder } from "@/lib/google/project-drive-provisioning"
import { projectWorkspaceClients } from "@/lib/google/project-workspace"
import { projectFamilyPhaseDriveFolderName } from "@/lib/project-family"
import type { Db } from "@/lib/server/action-context"

export type PhaseDriveProvisioningResult =
  | {
      readonly success: true
      readonly folderId: string
      readonly folderUrl: string
    }
  | { readonly success: false; readonly error: string }

export async function provisionPhaseDriveFolder(
  context: FamilyAdminContext,
  phaseId: string,
): Promise<PhaseDriveProvisioningResult> {
  const phase = await context.db
    .select({
      phaseId: projectFamilyPhases.id,
      familyId: projectFamilyPhases.familyId,
      phaseName: projectFamilyPhases.name,
      phaseProjectNumber: projectFamilyPhases.projectNumber,
      phaseFolderId: projectFamilyPhases.googleDriveFolderId,
      linkedProjectNumber: projects.projectNumber,
      linkedProjectFolderId: projects.googleDriveFolderId,
      familyFolderId: projectFamilies.googleDriveFolderId,
    })
    .from(projectFamilyPhases)
    .innerJoin(projectFamilies, eq(projectFamilies.id, projectFamilyPhases.familyId))
    .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
    .where(
      and(
        eq(projectFamilyPhases.id, phaseId),
        eq(projectFamilies.organizationId, context.organizationId),
      ),
    )
    .limit(1)
    .get()
  if (!phase) return { success: false, error: "Project phase not found." }

  if (phase.phaseFolderId) {
    return {
      success: true,
      folderId: phase.phaseFolderId,
      folderUrl: driveFolderUrl(phase.phaseFolderId),
    }
  }

  const projectNumber =
    phase.phaseProjectNumber ?? phase.linkedProjectNumber ?? null
  if (!projectNumber) {
    return {
      success: false,
      error: "Assign the phase a project number before provisioning Drive.",
    }
  }
  const department = projectFamilyDepartment(projectNumber)
  if (!department) {
    return { success: false, error: "The phased project number has no valid department." }
  }

  let parentFolderId = phase.familyFolderId
  if (!parentFolderId) {
    const basePhase = await context.db
      .select({
        phaseFolderId: projectFamilyPhases.googleDriveFolderId,
        linkedProjectFolderId: projects.googleDriveFolderId,
      })
      .from(projectFamilyPhases)
      .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
      .where(
        and(
          eq(projectFamilyPhases.familyId, phase.familyId),
          eq(projectFamilyPhases.sequence, 1),
        ),
      )
      .limit(1)
      .get()
    parentFolderId =
      basePhase?.phaseFolderId ?? basePhase?.linkedProjectFolderId ?? null
    if (parentFolderId) {
      await updateProjectFamilies(
        context.db,
        and(
          eq(projectFamilies.organizationId, context.organizationId),
          eq(projectFamilies.id, phase.familyId),
        ),
        { googleDriveFolderId: parentFolderId, updatedAt: new Date().toISOString() },
      )
    }
  }
  if (!parentFolderId) {
    return {
      success: false,
      error: "The base project is not mapped to a Google Drive folder yet.",
    }
  }

  const googleClients = await projectWorkspaceClients({
    environment: context.environment,
    organizationId: context.organizationId,
  })
  const drive = await provisionGoogleProjectDriveFolder(
    googleClients.drive,
    context.user.googleEmail ?? context.user.email,
    {
      department,
      folderName: projectFamilyPhaseDriveFolderName({
        projectNumber,
        phaseName: phase.phaseName,
      }),
      templateEmail: googleClients.projectIntakeGoogleEmail,
      existingFolderId: phase.phaseFolderId ?? undefined,
      parentFolderId,
    },
  )
  await updateProjectFamilyPhases(context.db, eq(projectFamilyPhases.id, phase.phaseId), {
    projectNumber,
    googleDriveFolderId: drive.folderId,
    updatedAt: new Date().toISOString(),
  })
  return { success: true, folderId: drive.folderId, folderUrl: drive.folderUrl }
}

export async function saveProjectDriveMapping(input: {
  readonly db: Db
  readonly projectId: string
  readonly folderId: string
  readonly folderUrl: string
  readonly phaseId: string
  readonly now: string
}): Promise<void> {
  const existing = await input.db
    .select({ id: projectExternalLinks.id })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, input.projectId),
        eq(projectExternalLinks.system, "google_drive"),
      ),
    )
    .limit(1)
    .get()
  const values = {
    label: "Project Drive folder",
    externalId: input.folderId,
    externalNumber: null,
    externalUrl: input.folderUrl,
    syncDirection: "read_write",
    syncStatus: "mapped",
    metadata: JSON.stringify({ projectFamilyPhaseId: input.phaseId }),
    lastSyncedAt: input.now,
    updatedAt: input.now,
  }
  if (existing) {
    await updateProjectExternalLinks(input.db, eq(projectExternalLinks.id, existing.id), values)
    return
  }
  await insertProjectExternalLink(input.db, {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    system: "google_drive",
    createdAt: input.now,
    ...values,
  })
}
