"use server"

import { and, eq, inArray } from "drizzle-orm"
import { projectAccessInvitations, projectMembers } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"
import { contactsProjectContext } from "@/lib/domain/contacts/access"
import { revalidateProjectContactPaths } from "@/lib/domain/contacts/paths"
import {
  loadProjectContactDirectoryOptions,
  loadProjectContactSageOptions,
} from "@/lib/domain/contacts/directory-options"
import { loadProjectContactRemoval, removableProjectMemberIds } from "@/lib/domain/contacts/remove-contact"
import { validContactType } from "@/lib/domain/contacts/rules"
import {
  commitProjectContactSave,
  planProjectContactSave,
  projectContactInputError,
  type PendingInvitation,
} from "@/lib/domain/contacts/save-contact"
import { deactivateProjectContact, releaseSourceLinksForContact } from "@/lib/domain/contacts/store"
import { loadProjectContactsSummary } from "@/lib/domain/contacts/summary"
import type {
  ProjectContactAudience,
  ProjectContactDirectoryOption,
  ProjectContactMutationInput,
  ProjectContactMutationResult,
  ProjectContactSageOptions,
  ProjectContactsSummary,
  ProjectContactsSummaryOptions,
} from "@/lib/domain/contacts/types"
import { requireOrg } from "@/lib/org-scope"
import { canFeature, requireFeaturePermission } from "@/lib/permission-enforcement"
import type { Db } from "@/lib/server/action-context"
import { envString } from "@/lib/shared/env"
import { queueProjectContactTrackerRefresh } from "@/lib/project-contact-tracker-refresh"

export async function getProjectContactsSummary(
  projectId: string,
  audience: ProjectContactAudience = "internal",
  options: ProjectContactsSummaryOptions = {}
): Promise<ProjectContactsSummary> {
  const context = await contactsProjectContext(projectId)
  return loadProjectContactsSummary(context, audience, options)
}

export async function getProjectContactDirectoryOptions(
  projectId: string
): Promise<readonly ProjectContactDirectoryOption[]> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "project-contacts", "update")
  const orgId = requireOrg(user)
  // The picker exposes organization-wide customer, vendor, and staff details,
  // so project read access alone is intentionally insufficient.
  const { db } = await contactsProjectContext(projectId, "update")
  const [canViewCustomers, canViewVendors, canViewInternal] = await Promise.all([
    canFeature(user, "customers", "read"),
    canFeature(user, "vendors", "read"),
    canFeature(user, "internal-directory", "read"),
  ])
  return loadProjectContactDirectoryOptions(db, {
    organizationId: orgId,
    projectId,
    grants: { customers: canViewCustomers, vendors: canViewVendors, internal: canViewInternal },
  })
}

export async function getProjectContactSageOptions(
  projectId: string
): Promise<ProjectContactSageOptions> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "project-contacts", "update")
  const { db } = await contactsProjectContext(projectId, "update")
  return loadProjectContactSageOptions(db, projectId)
}

/**
 * A contact's sent access invitations go to its old email; revoke them in
 * WorkOS and here before the email changes. Returns the warning to show, or
 * a failure when WorkOS is not configured.
 */
async function revokeInvitationsForEmailChange(
  db: Db,
  env: CloudflareEnv,
  input: { readonly projectId: string; readonly contactId: string; readonly pending: readonly PendingInvitation[]; readonly now: string }
): Promise<{ readonly warning?: string } | { readonly error: string }> {
  const workosInvitationIds = input.pending.flatMap((invitation) =>
    invitation.workosInvitationId ? [invitation.workosInvitationId] : []
  )
  if (workosInvitationIds.length > 0) {
    const workosApiKey = envString(env, "WORKOS_API_KEY")
    if (!workosApiKey || workosApiKey.includes("placeholder")) {
      return {
        error:
          "The pending access invitation must be revoked before changing this email, but WorkOS is not configured.",
      }
    }
    const { WorkOS } = await import("@workos-inc/node")
    const workos = new WorkOS(workosApiKey)
    // WorkOS is an outside, rate-limited API: one revocation at a time.
    for (const invitationId of workosInvitationIds) {
      await workos.userManagement.revokeInvitation(invitationId)
    }
  }
  if (input.pending.length === 0) return {}
  await db
    .update(projectAccessInvitations)
    .set({ status: "revoked", emailStatus: "cancelled", emailNextAttemptAt: null, emailClaimToken: null, emailClaimedAt: null, updatedAt: input.now })
    .where(
      and(
        eq(projectAccessInvitations.projectId, input.projectId),
        eq(projectAccessInvitations.projectContactId, input.contactId),
        eq(projectAccessInvitations.status, "sent")
      )
    )
    .run()
  return { warning: "The old pending access invitation was revoked. Send a new invitation to the updated email." }
}

export async function saveProjectContact(
  input: ProjectContactMutationInput
): Promise<ProjectContactMutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "project-contacts", "update")
    if (!input.projectId.trim()) {
      return { success: false, error: "Project is required" }
    }
    if (!input.displayName.trim()) {
      return { success: false, error: "Contact name is required" }
    }
    if (!validContactType(input.contactType)) {
      return { success: false, error: "Choose a valid contact type" }
    }

    const orgId = requireOrg(user)
    const { db, env } = await contactsProjectContext(input.projectId, "update")
    const inputError = projectContactInputError(input)
    if (inputError) return { success: false, error: inputError }

    const planned = await planProjectContactSave({ db, user, organizationId: orgId }, input)
    if (!planned.success) return planned
    const { plan } = planned

    let warning: string | undefined
    if (plan.contactId && plan.pendingInvitations.length > 0) {
      const revoked = await revokeInvitationsForEmailChange(db, env, {
        projectId: input.projectId,
        contactId: plan.contactId,
        pending: plan.pendingInvitations,
        now: plan.now,
      })
      if ("error" in revoked) return { success: false, error: revoked.error }
      warning = revoked.warning
    }

    const contactId = await commitProjectContactSave(db, { organizationId: orgId, plan })
    await queueProjectContactTrackerRefresh({ db, organizationId: orgId, projectId: input.projectId })
    revalidateProjectContactPaths(input.projectId)
    return { success: true, contactId, ...(warning ? { warning } : {}) }
  } catch (error) {
    console.error("Failed to save project contact", error)
    return { success: false, error: "Failed to save project contact" }
  }
}

export async function removeProjectContact(
  projectId: string,
  contactId: string
): Promise<ProjectContactMutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "project-contacts", "update")
    const orgId = requireOrg(user)
    const { db } = await contactsProjectContext(projectId, "update")
    const scope = { db, organizationId: orgId, projectId }
    const removal = await loadProjectContactRemoval(scope, contactId)
    if (!removal) return { success: false, error: "Project contact not found" }

    const now = new Date().toISOString()
    await deactivateProjectContact(db, { projectId, contactId, now })
    await releaseSourceLinksForContact(db, { projectId, contactId, now })
    await db
      .update(projectAccessInvitations)
      .set({ status: "revoked", emailStatus: "cancelled", emailNextAttemptAt: null, emailClaimToken: null, emailClaimedAt: null, updatedAt: now })
      .where(
        and(
          eq(projectAccessInvitations.projectId, projectId),
          eq(projectAccessInvitations.projectContactId, contactId)
        )
      )
    const removableMemberIds = await removableProjectMemberIds(scope, removal)
    if (removableMemberIds.length > 0) {
      await db
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            inArray(projectMembers.userId, [...removableMemberIds])
          )
        )
    }

    await queueProjectContactTrackerRefresh({ db, organizationId: orgId, projectId })
    revalidateProjectContactPaths(projectId)
    return { success: true, contactId }
  } catch (error) {
    console.error("Failed to remove project contact", error)
    return { success: false, error: "Failed to remove project contact" }
  }
}
