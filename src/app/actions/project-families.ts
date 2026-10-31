"use server"

import { revalidatePath } from "next/cache"

import { createProjectShell } from "@/app/actions/projects"
import { requireAuth } from "@/lib/auth"
import { requireFamilyAdminContext, type FamilyAdminContext } from "@/lib/domain/families/access"
import {
  finishFamilyPhaseActivation,
  prepareFamilyPhaseActivation,
} from "@/lib/domain/families/activation"
import { provisionPhaseDriveFolder } from "@/lib/domain/families/drive"
import { linkExistingProject } from "@/lib/domain/families/link-existing"
import { createFamilyFromProject, createFamilyPhase } from "@/lib/domain/families/phases"
import type {
  CreateProjectFamilyFromProjectInput,
  CreateProjectFamilyPhaseInput,
  FamilyWrite,
  LinkExistingProjectToFamilyInput,
  ProjectFamilyMutationResult,
  ProjectFamilySummary,
} from "@/lib/domain/families/rules"
import { loadProjectFamilySummary } from "@/lib/domain/families/summary"
import { requirePermission } from "@/lib/permissions"
import { projectContext } from "@/lib/server/action-context"

/*
 * Project family actions: thin adapters over src/lib/domain/families. Each
 * resolves the family admin context, runs the domain write, revalidates the
 * pages it changed and returns its result. Errors keep each action's message.
 */

function failure(error: unknown, fallback: string): ProjectFamilyMutationResult {
  return { success: false, error: error instanceof Error ? error.message : fallback }
}

async function runFamilyWrite(
  write: (context: FamilyAdminContext) => Promise<FamilyWrite>,
  fallback: string,
): Promise<ProjectFamilyMutationResult> {
  try {
    const context = await requireFamilyAdminContext()
    const { result, revalidate } = await write(context)
    for (const path of revalidate) revalidatePath(path)
    return result
  } catch (error) {
    return failure(error, fallback)
  }
}

/**
 * Seeds the family model around an existing project without creating any
 * additional project, contract, or change-order records.
 */
export async function createProjectFamilyFromProject(
  input: CreateProjectFamilyFromProjectInput,
): Promise<ProjectFamilyMutationResult> {
  return runFamilyWrite(
    (context) => createFamilyFromProject(context, input),
    "Unable to create a project family from this project.",
  )
}

export async function createProjectFamilyPhase(
  input: CreateProjectFamilyPhaseInput,
): Promise<ProjectFamilyMutationResult> {
  return runFamilyWrite(
    (context) => createFamilyPhase(context, input),
    "Unable to create project phase.",
  )
}

/**
 * Turns an authorized planned phase into a normal Compass project. The phase
 * number is supplied by the family record so this path cannot accidentally
 * consume the next top-level project sequence.
 */
export async function activateProjectFamilyPhase(
  phaseId: string,
): Promise<ProjectFamilyMutationResult> {
  return runFamilyWrite(async (context) => {
    const prepared = await prepareFamilyPhaseActivation(context, phaseId)
    if (!prepared.success) {
      return { result: { success: false, error: prepared.error }, revalidate: [] }
    }
    const created = await createProjectShell(prepared.plan.shellInput)
    if (!created.success) {
      const error =
        "error" in created
          ? created.error
          : "A possible duplicate project must be reviewed before activating this phase."
      return { result: { success: false, error }, revalidate: [] }
    }
    return finishFamilyPhaseActivation(context, {
      phaseId,
      plan: prepared.plan,
      createdProjectId: created.id,
    })
  }, "Unable to activate the project phase.")
}

/**
 * Adopts an existing Compass project as a family phase. The project record and
 * every record linked to it remain intact. When its legacy number differs from
 * the family's canonical phase number, Compass retains the old number as an
 * alias and queues the existing Drive/tracker synchronization workflow.
 */
export async function linkExistingProjectToFamily(
  input: LinkExistingProjectToFamilyInput,
): Promise<ProjectFamilyMutationResult> {
  return runFamilyWrite(
    (context) => linkExistingProject(context, input),
    "Unable to link the existing project as a phase.",
  )
}

export async function provisionProjectFamilyPhaseDriveFolder(
  phaseId: string,
): Promise<ProjectFamilyMutationResult> {
  return runFamilyWrite(async (context) => {
    const drive = await provisionPhaseDriveFolder(context, phaseId)
    if (!drive.success) return { result: { success: false, error: drive.error }, revalidate: [] }
    return {
      result: { success: true, id: phaseId, driveStatus: "provisioned" },
      revalidate: ["/dashboard/projects"],
    }
  }, "Unable to provision the phase Drive folder.")
}

/**
 * Reads the family context for a project without widening project access.
 * Planned phases are visible only to users who can see the family internally;
 * external/project-scoped users see only sibling phases they can access.
 */
export async function getProjectFamilySummary(
  projectId: string,
): Promise<ProjectFamilySummary | null> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")
  // "member" scope is getProjectAccessRecord, the rule this read always used;
  // a missing database or project returns null as before.
  const context = await projectContext(projectId, { scope: "member" })
  if (!context.success) return null
  return loadProjectFamilySummary(context.data.db, user, projectId)
}
