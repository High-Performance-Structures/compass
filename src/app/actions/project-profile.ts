"use server"

import { revalidatePath } from "next/cache"

import {
  loadOrganizationFollowUpOwners,
  loadProjectFollowUpOwners,
  loadProjectFollowUpQueue,
  postponeProjectFollowUp,
  removeProjectFollowUp,
  scheduleProjectFollowUp,
} from "@/lib/domain/crm/follow-ups"
import {
  loadProjectInteractionFormOptions,
  logProjectInteraction,
  removeProjectInteraction,
  type ProjectInteractionFormOptions,
} from "@/lib/domain/crm/interactions"
import { addProjectNote, removeProjectNote } from "@/lib/domain/crm/notes"
import type { ProjectFollowUpOwner, ProjectFollowUpQueueItem } from "@/lib/domain/crm/rules"
import {
  loadProjectInformation,
  saveProjectInformation,
  type ProjectInformation,
  type ProjectInformationInput,
  type ProjectInformationSave,
} from "@/lib/domain/project/information"
import { correctProjectNumber, type ProjectNumberCorrectionInput } from "@/lib/domain/project/information-numbering"
import {
  addCustomProjectJobStatus,
  changeProjectDeliveryMethod,
  changeProjectImportedConversationsStaffOnly,
  changeProjectMapVisibility,
  loadProjectAgingStatusRows,
  type ProjectAgingStatusRow,
} from "@/lib/domain/project/job-status"
import {
  plainResult,
  revalidateProjectProfile,
  updateProjectJobStatusCommand,
} from "@/lib/domain/project/profile-commands"
import type { ProjectProfileResult } from "@/lib/domain/project/profile-rules"
import { retryProjectProfileSyncOperation as runSyncOperation } from "@/lib/domain/project/profile-sync"

/*
 * Project Information page actions: thin adapters over the project and crm
 * domain modules. Access is `projectProfileContext` (internal staff with
 * project-hub permission, project access record in their organization).
 */

// "use server" files may only re-export types straight from their module.
export type { ProjectAgingStatusRow } from "@/lib/domain/project/job-status"
export type { ProjectFollowUpOwner, ProjectFollowUpQueueItem } from "@/lib/domain/crm/rules"
export type { ProjectInformation } from "@/lib/domain/project/information"
export type { ProjectInteractionFormOptions } from "@/lib/domain/crm/interactions"
export type { ProjectProfileResult } from "@/lib/domain/project/profile-rules"


export async function getProjectFollowUpOwners(
  projectId: string,
): Promise<readonly ProjectFollowUpOwner[]> {
  try {
    return await loadProjectFollowUpOwners(projectId)
  } catch (error) {
    console.error("Unable to load follow-up owners", error)
    return []
  }
}

/** Staff who can own client follow-up, for company-wide settings (no project needed). */
export async function getOrganizationFollowUpOwners(): Promise<readonly ProjectFollowUpOwner[]> {
  try {
    return await loadOrganizationFollowUpOwners()
  } catch (error) {
    console.error("Unable to load follow-up owners", error)
    return []
  }
}

export async function getProjectInformation(
  projectId: string,
): Promise<ProjectInformation | null> {
  try {
    return await loadProjectInformation(projectId)
  } catch (error) {
    console.error("Unable to load project information", error)
    return null
  }
}

export async function getProjectFollowUpQueue(): Promise<
  readonly ProjectFollowUpQueueItem[]
> {
  try {
    return await loadProjectFollowUpQueue()
  } catch (error) {
    console.error("Unable to load project follow-up queue", error)
    return []
  }
}

export async function retryProjectProfileSyncOperation(input: {
  readonly projectId: string
  readonly operationId: string
}): Promise<ProjectProfileResult> {
  const outcome = await runSyncOperation(input)
  if (outcome.revalidate) revalidateProjectProfile(input.projectId)
  return outcome.result
}

/** Saves, then runs the queued Google sync operations before revalidating. */
async function finishSave(projectId: string, save: ProjectInformationSave): Promise<ProjectProfileResult> {
  if (!save.result.success) return save.result
  await Promise.all(
    save.syncOperationIds.map((operationId) =>
      retryProjectProfileSyncOperation({ projectId, operationId }),
    ),
  )
  revalidateProjectProfile(projectId)
  return { success: true }
}

export async function updateProjectInformation(input: ProjectInformationInput): Promise<ProjectProfileResult> {
  try {
    return await finishSave(input.projectId, await saveProjectInformation(input))
  } catch (error) {
    console.error("Unable to update project information", error)
    return { success: false, error: "Unable to update project information." }
  }
}

export async function correctProjectNumberForReview(
  input: ProjectNumberCorrectionInput,
): Promise<ProjectProfileResult> {
  try {
    return await finishSave(input.projectId, await correctProjectNumber(input))
  } catch (error) {
    console.error("Unable to correct project number", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to correct the project number.",
    }
  }
}

export async function updateProjectJobStatus(input: {
  readonly projectId: string
  readonly jobStatusId: string
}): Promise<ProjectProfileResult> {
  return updateProjectJobStatusCommand(input)
}

export async function updateProjectDeliveryMethod(input: {
  readonly projectId: string
  readonly deliveryMethod: string | null
}): Promise<ProjectProfileResult> {
  try {
    const result = await changeProjectDeliveryMethod(input)
    if (result.success && result.changed) {
      revalidateProjectProfile(input.projectId)
      revalidatePath("/dashboard")
    }
    return plainResult(result)
  } catch (error) {
    console.error("Unable to update project delivery method", error)
    return { success: false, error: "Unable to save the delivery method." }
  }
}

export async function updateProjectMapVisibility(input: {
  readonly projectId: string
  readonly visibility: string
}): Promise<ProjectProfileResult> {
  try {
    const result = await changeProjectMapVisibility(input)
    if (result.success && result.changed) {
      revalidateProjectProfile(input.projectId)
      revalidatePath("/dashboard")
    }
    return plainResult(result)
  } catch (error) {
    console.error("Unable to update portfolio map visibility", error)
    return { success: false, error: "Unable to update the portfolio map setting." }
  }
}

export async function updateProjectImportedConversationsStaffOnly(input: {
  readonly projectId: string
  readonly staffOnly: boolean
}): Promise<ProjectProfileResult> {
  try {
    const result = await changeProjectImportedConversationsStaffOnly(input)
    if (result.success && result.changed) {
      revalidateProjectProfile(input.projectId)
      revalidatePath("/dashboard/conversations")
    }
    return plainResult(result)
  } catch (error) {
    console.error("Unable to update the imported conversations setting", error)
    return { success: false, error: "Unable to update the imported conversations setting." }
  }
}

export async function createProjectNote(input: {
  readonly projectId: string
  readonly body: string
}): Promise<ProjectProfileResult> {
  try {
    const result = await addProjectNote(input)
    if (result.success) revalidateProjectProfile(input.projectId)
    return result
  } catch (error) {
    console.error("Unable to create project note", error)
    return { success: false, error: "Unable to create project note." }
  }
}

export async function deleteProjectNote(input: {
  readonly projectId: string
  readonly noteId: string
}): Promise<ProjectProfileResult> {
  try {
    const result = await removeProjectNote(input)
    if (result.success) revalidateProjectProfile(input.projectId)
    return result
  } catch (error) {
    console.error("Unable to delete project note", error)
    return { success: false, error: "Unable to delete project note." }
  }
}

export async function createProjectInteraction(input: {
  readonly projectId: string
  readonly interactionType: string
  readonly direction: "inbound" | "outbound"
  readonly summary: string
  readonly occurredAt: string
  readonly contactId: string | null
}): Promise<ProjectProfileResult> {
  try {
    const result = await logProjectInteraction(input)
    if (result.success) revalidateProjectProfile(input.projectId)
    return result
  } catch (error) {
    console.error("Unable to create client interaction", error)
    return { success: false, error: "Unable to create client interaction." }
  }
}

export async function deleteProjectInteraction(input: {
  readonly projectId: string
  readonly interactionId: string
}): Promise<ProjectProfileResult> {
  try {
    const result = await removeProjectInteraction(input)
    if (result.success) revalidateProjectProfile(input.projectId)
    return result
  } catch (error) {
    console.error("Unable to delete client interaction", error)
    return { success: false, error: "Unable to delete client interaction." }
  }
}

export async function setProjectFollowUp(input: {
  readonly projectId: string
  readonly nextFollowUpAt: string
  readonly ownerUserId: string | null
}): Promise<ProjectProfileResult> {
  try {
    const result = await scheduleProjectFollowUp(input)
    if (result.success) revalidateProjectProfile(input.projectId)
    return result
  } catch (error) {
    console.error("Unable to set project follow-up", error)
    return { success: false, error: "Unable to set project follow-up." }
  }
}

/** What the client-contact form needs: the job's client contacts, the company's interaction types and record rules. */
export async function getProjectInteractionFormOptions(
  projectId: string,
): Promise<{ readonly success: true; readonly options: ProjectInteractionFormOptions } | { readonly success: false; readonly error: string }> {
  try {
    return { success: true, options: await loadProjectInteractionFormOptions(projectId) }
  } catch (error) {
    console.error("Unable to load client contact options", error)
    return { success: false, error: "Unable to load client contacts." }
  }
}

/**
 * Push the next follow-up to a later date, keeping its owner. Used by
 * "Snooze" on the map and the project's follow-up tracker.
 */
export async function snoozeProjectFollowUp(input: {
  readonly projectId: string
  readonly nextFollowUpAt: string
}): Promise<ProjectProfileResult> {
  try {
    const result = await postponeProjectFollowUp(input)
    if (result.success) revalidateProjectProfile(input.projectId)
    return result
  } catch (error) {
    console.error("Unable to snooze project follow-up", error)
    return { success: false, error: "Unable to snooze the follow-up." }
  }
}

export async function clearProjectFollowUp(projectId: string): Promise<ProjectProfileResult> {
  try {
    const result = await removeProjectFollowUp(projectId)
    if (result.success && result.changed) revalidateProjectProfile(projectId)
    return plainResult(result)
  } catch (error) {
    console.error("Unable to clear project follow-up", error)
    return { success: false, error: "Unable to clear project follow-up." }
  }
}

/**
 * Every job status the company uses (built-in and its own) with its default
 * follow-up timing, for Settings → Workflows → Project aging.
 */
export async function getProjectAgingStatusRows(): Promise<
  { readonly success: true; readonly rows: readonly ProjectAgingStatusRow[] } | { readonly success: false; readonly error: string }
> {
  try {
    return await loadProjectAgingStatusRows()
  } catch (error) {
    console.error("Unable to load project aging statuses", error)
    return { success: false, error: "Unable to load job statuses." }
  }
}

export async function createCustomProjectJobStatus(input: {
  readonly label: string
  readonly sageCode: string | null
  readonly followUpCadenceDays: number | null
}): Promise<ProjectProfileResult> {
  try {
    const result = await addCustomProjectJobStatus(input)
    if (result.success) revalidatePath("/dashboard/projects")
    return result
  } catch (error) {
    console.error("Unable to add job status", error)
    return { success: false, error: "Unable to add job status." }
  }
}
