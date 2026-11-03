"use server"

import { requireAuth } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"
import { contactsProjectContext } from "@/lib/domain/contacts/access"
import { revalidateProjectContactPaths } from "@/lib/domain/contacts/paths"
import {
  addIndependentContactFromReview,
  approveSourceLinksForProject,
  assignSourceLinksToContact,
  changeContactTypeFromReview,
  createContactFromSourceLinks,
  ignoreSourceLinks,
  loadProjectContactMatchReview,
  restoreSourceLinks,
} from "@/lib/domain/contacts/review"
import { toWritableContactType } from "@/lib/domain/contacts/rules"
import type { ContactMatchResult, ProjectContactMatchReview } from "@/lib/domain/contacts/types"
import { requireOrg } from "@/lib/org-scope"
import { canFeature, requireFeaturePermission } from "@/lib/permission-enforcement"
import type { Db } from "@/lib/server/action-context"

function requireStringField(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName)
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`)
  }
  return value.trim()
}

function requireLinkIds(formData: FormData): readonly string[] {
  const values = formData
    .getAll("linkId")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const linkIds = Array.from(new Set(values))
  if (linkIds.length === 0) throw new Error("linkId is required")
  return linkIds
}

/**
 * Shared shape of the review mutations: demo accounts are read-only, the
 * project must be the user's, and a thrown error becomes `failure`.
 */
async function reviewMutation(
  formData: FormData,
  failure: { readonly log: string; readonly error: string },
  run: (db: Db, projectId: string) => Promise<ContactMatchResult>
): Promise<ContactMatchResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const projectId = requireStringField(formData, "projectId")
    const result = await run((await contactsProjectContext(projectId, "update")).db, projectId)
    if (result.success) revalidateProjectContactPaths(projectId)
    return result
  } catch (error) {
    console.error(failure.log, error)
    return { success: false, error: failure.error }
  }
}

export async function getProjectContactMatchReview(
  projectId: string
): Promise<ProjectContactMatchReview> {
  const { db } = await contactsProjectContext(projectId)
  const user = await requireAuth()
  const orgId = requireOrg(user)
  const canViewVendors = await canFeature(user, "vendors", "read")
  return loadProjectContactMatchReview(db, { organizationId: orgId, projectId, canViewVendors })
}

export async function addIndependentContactToProjectFromReview(
  formData: FormData
): Promise<ContactMatchResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "vendors", "read")

    const orgId = requireOrg(user)
    const projectId = requireStringField(formData, "projectId")
    const vendorId = requireStringField(formData, "independentContactId")
    const linkIds = requireLinkIds(formData)
    const { db } = await contactsProjectContext(projectId, "update")
    const result = await addIndependentContactFromReview(db, { organizationId: orgId, projectId, vendorId, linkIds })
    if (result.success) revalidateProjectContactPaths(projectId)
    return result
  } catch (error) {
    console.error("Failed to add directory contact to project", error)
    return { success: false, error: "Failed to add directory contact" }
  }
}

export async function approveContactSourceLink(
  formData: FormData
): Promise<ContactMatchResult> {
  return reviewMutation(
    formData,
    { log: "Failed to approve contact source link", error: "Failed to approve contact match" },
    (db, projectId) => approveSourceLinksForProject(db, { projectId, linkIds: requireLinkIds(formData) })
  )
}

export async function assignContactSourceLink(
  formData: FormData
): Promise<ContactMatchResult> {
  return reviewMutation(
    formData,
    { log: "Failed to assign contact source link", error: "Failed to assign contact match" },
    (db, projectId) =>
      assignSourceLinksToContact(db, {
        projectId,
        linkIds: requireLinkIds(formData),
        projectContactId: requireStringField(formData, "projectContactId"),
      })
  )
}

export async function createContactFromSourceLink(
  formData: FormData
): Promise<ContactMatchResult> {
  return reviewMutation(
    formData,
    { log: "Failed to create contact from source link", error: "Failed to create project contact" },
    (db, projectId) =>
      createContactFromSourceLinks(db, {
        projectId,
        linkIds: requireLinkIds(formData),
        contactType: toWritableContactType(requireStringField(formData, "contactType")),
      })
  )
}

export async function updateProjectContactTypeFromReview(
  formData: FormData
): Promise<ContactMatchResult> {
  return reviewMutation(
    formData,
    { log: "Failed to update project contact type", error: "Failed to update project contact" },
    (db, projectId) =>
      changeContactTypeFromReview(db, {
        projectId,
        projectContactId: requireStringField(formData, "projectContactId"),
        contactType: toWritableContactType(requireStringField(formData, "contactType")),
      })
  )
}

export async function ignoreContactSourceLink(
  formData: FormData
): Promise<ContactMatchResult> {
  return reviewMutation(
    formData,
    { log: "Failed to ignore contact source link", error: "Failed to ignore contact match" },
    (db, projectId) => ignoreSourceLinks(db, { projectId, linkIds: requireLinkIds(formData) })
  )
}

export async function restoreContactSourceLink(
  formData: FormData
): Promise<ContactMatchResult> {
  return reviewMutation(
    formData,
    { log: "Failed to restore contact source link", error: "Failed to restore contact match" },
    (db, projectId) => restoreSourceLinks(db, { projectId, linkIds: requireLinkIds(formData) })
  )
}
