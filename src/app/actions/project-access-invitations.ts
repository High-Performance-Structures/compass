"use server"

import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import {
  projectAccessInvitations,
  projectContacts,
  projectMembers,
  organizationMembers,
  organizations,
  projects,
  users,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { sendCompassEmail } from "@/lib/email/compass-email"
import { buildProjectAccessWelcomeHtml } from "@/lib/email/project-access-welcome"
import { requirePermission } from "@/lib/permissions"
import { ensureProjectAudienceConversation } from "@/lib/project-audience-conversations"
import {
  isExternalProjectRole,
  isInternalStaffRole,
} from "@/lib/user-roles"
import { recordActivityEvent } from "@/lib/activity-log"

const invitationSchema = z.object({
  projectId: z.string().trim().min(1),
  contactId: z.string().trim().min(1),
  subject: z.string().trim().min(1).max(180),
  message: z.string().trim().min(1).max(8000),
})

export type SendProjectAccessInvitationInput = z.infer<
  typeof invitationSchema
>

export type SendProjectAccessInvitationResult =
  | {
      readonly success: true
      readonly accessStatus: "invited" | "access_granted"
      readonly warning: string | null
    }
  | { readonly success: false; readonly error: string }

function projectRoleForContactType(contactType: string): string | null {
  if (contactType === "owner") return "owner"
  if (contactType === "subcontractor") return "subcontractor"
  if (contactType === "supplier") return "supplier"
  if (contactType === "internal") return "office"
  return null
}

function appBaseUrl(env: unknown): string {
  if (typeof env === "object" && env !== null) {
    const value = Reflect.get(env, "COMPASS_APP_URL")
    if (typeof value === "string" && value.trim()) {
      return value.trim().replace(/\/$/, "")
    }
  }
  return "https://compass.openrangeconstruction.ltd"
}

function environmentString(env: unknown, key: string): string | null {
  if (typeof env !== "object" || env === null) return null
  const value = Reflect.get(env, key)
  return typeof value === "string" && value.trim() ? value.trim() : null
}

async function ensureProjectMembership(input: {
  readonly db: ReturnType<typeof getDb>
  readonly userId: string
  readonly projectId: string
  readonly role: string
  readonly now: string
}): Promise<void> {
  const existing = await input.db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.userId, input.userId),
        eq(projectMembers.projectId, input.projectId)
      )
    )
    .get()

  if (existing) {
    await input.db
      .update(projectMembers)
      .set({ role: input.role })
      .where(eq(projectMembers.id, existing.id))
      .run()
    return
  }

  await input.db
    .insert(projectMembers)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      projectId: input.projectId,
      role: input.role,
      assignedAt: input.now,
    })
    .run()
}

async function ensureExternalOrganizationMembership(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly userId: string
  readonly role: string
  readonly now: string
}): Promise<void> {
  const existing = await input.db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, input.userId),
        eq(organizationMembers.organizationId, input.organizationId)
      )
    )
    .get()
  const role = input.role === "owner" ? "client" : input.role

  if (existing) {
    await input.db
      .update(organizationMembers)
      .set({ role })
      .where(eq(organizationMembers.id, existing.id))
      .run()
    return
  }

  await input.db
    .insert(organizationMembers)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      role,
      joinedAt: input.now,
    })
    .run()
}

export async function sendProjectAccessInvitation(
  input: SendProjectAccessInvitationInput
): Promise<SendProjectAccessInvitationResult> {
  const parsed = invitationSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please review the invitation.",
    }
  }

  try {
    const currentUser = await requireAuth()
    if (isDemoUser(currentUser.id)) {
      return { success: false, error: "Invitations are unavailable in demo mode." }
    }
    requirePermission(currentUser, "project", "update")
    if (
      currentUser.organizationType !== "internal" ||
      !currentUser.organizationId ||
      !isInternalStaffRole(currentUser.role)
    ) {
      return {
        success: false,
        error: "Only authorized staff can invite project contacts.",
      }
    }

    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "Database not available." }
    const db = getDb(env.DB)
    const row = await db
      .select({
        contact: projectContacts,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        organizationId: projects.organizationId,
      })
      .from(projectContacts)
      .innerJoin(projects, eq(projects.id, projectContacts.projectId))
      .where(
        and(
          eq(projectContacts.id, parsed.data.contactId),
          eq(projectContacts.projectId, parsed.data.projectId),
          eq(projectContacts.active, true),
          eq(projects.organizationId, currentUser.organizationId)
        )
      )
      .get()

    if (!row || !row.organizationId) {
      return { success: false, error: "Project contact not found." }
    }

    const email = row.contact.email?.trim().toLowerCase() ?? ""
    if (!email) {
      return {
        success: false,
        error: "Add an email address before inviting this contact.",
      }
    }
    const requestedRole = projectRoleForContactType(row.contact.contactType)
    if (!requestedRole) {
      return { success: false, error: "This contact type cannot be invited." }
    }

    const now = new Date().toISOString()
    const existingUser = await db
      .select({
        id: users.id,
        role: users.role,
        isActive: users.isActive,
        phone: users.phone,
        address: users.address,
      })
      .from(users)
      .where(sql`lower(trim(${users.email})) = ${email}`)
      .get()
    const activeExistingUser = existingUser?.isActive ? existingUser : null
    const pendingPlaceholder =
      existingUser !== undefined &&
      !existingUser.isActive &&
      !existingUser.id.startsWith("user_")
    if (existingUser && !existingUser.isActive && !pendingPlaceholder) {
      return {
        success: false,
        error:
          "This Compass account is deactivated. Reactivate it in People before assigning project access.",
      }
    }
    const internalMembership = activeExistingUser
      ? await db
          .select({ role: organizationMembers.role })
          .from(organizationMembers)
          .innerJoin(
            organizations,
            eq(organizations.id, organizationMembers.organizationId)
          )
          .where(
            and(
              eq(organizationMembers.userId, activeExistingUser.id),
              eq(organizations.id, row.organizationId),
              eq(organizations.type, "internal")
            )
          )
          .get()
      : null
    const preservedOrganizationRole =
      internalMembership &&
      !isExternalProjectRole(internalMembership.role)
        ? internalMembership.role
        : null
    const verifiedOrganizationMembership =
      preservedOrganizationRole !== null
    const membershipRole = preservedOrganizationRole ?? requestedRole
    if (
      row.contact.contactType === "internal" &&
      !verifiedOrganizationMembership
    ) {
      return {
        success: false,
        error:
          "Add internal staff through People before assigning project access.",
      }
    }
    let workosInvitationId: string | null = null
    let workosExpiresAt: string | null = null
    const destinationPath =
      requestedRole === "owner"
        ? `/preview/projects/${parsed.data.projectId}/owner`
        : requestedRole === "subcontractor" || requestedRole === "supplier"
          ? `/preview/projects/${parsed.data.projectId}/sub-vendor`
          : `/dashboard/projects/${parsed.data.projectId}`
    let actionUrl = `${appBaseUrl(env)}/login?from=${encodeURIComponent(
      destinationPath
    )}`
    let accessStatus: "invited" | "access_granted" = "invited"

    if (activeExistingUser) {
      if (
        (!activeExistingUser.phone && row.contact.phone) ||
        (!activeExistingUser.address && row.contact.address)
      ) {
        await db
          .update(users)
          .set({
            phone: activeExistingUser.phone ?? row.contact.phone,
            address: activeExistingUser.address ?? row.contact.address,
            updatedAt: now,
          })
          .where(eq(users.id, activeExistingUser.id))
          .run()
      }
      if (!verifiedOrganizationMembership) {
        await ensureExternalOrganizationMembership({
          db,
          organizationId: row.organizationId,
          userId: activeExistingUser.id,
          role: requestedRole,
          now,
        })
      }
      await ensureProjectMembership({
        db,
        userId: activeExistingUser.id,
        projectId: parsed.data.projectId,
        role: membershipRole,
        now,
      })
      accessStatus = "access_granted"
    } else if (!existingUser) {
      const workosApiKey = environmentString(env, "WORKOS_API_KEY")
      if (!workosApiKey || workosApiKey.includes("placeholder")) {
        return { success: false, error: "WorkOS invitations are not configured." }
      }
      const { WorkOS } = await import("@workos-inc/node")
      const workos = new WorkOS(workosApiKey)
      const invitation = await workos.userManagement.sendInvitation({
        email,
        expiresInDays: 14,
      })
      workosInvitationId = invitation.id
      workosExpiresAt = invitation.expiresAt
      actionUrl = invitation.acceptInvitationUrl
    } else if (pendingPlaceholder) {
      workosExpiresAt = new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000
      ).toISOString()
    }

    const visibility =
      row.contact.contactType === "owner"
        ? { ownerPortalVisible: true, updatedAt: now }
        : row.contact.contactType === "internal"
          ? { internalVisible: true, updatedAt: now }
          : { subVendorPortalVisible: true, updatedAt: now }
    await db
      .update(projectContacts)
      .set(visibility)
      .where(eq(projectContacts.id, row.contact.id))
      .run()

    const audience =
      requestedRole === "owner"
        ? "owner"
        : requestedRole === "subcontractor" || requestedRole === "supplier"
          ? "sub_vendor"
          : null
    if (audience) {
      await ensureProjectAudienceConversation({
        db,
        projectId: parsed.data.projectId,
        organizationId: row.organizationId,
        audience,
        contactId: audience === "owner" ? null : row.contact.id,
        externalUserId: activeExistingUser?.id ?? null,
        createdBy: currentUser.id,
        now,
      })
    }

    const projectLabel = row.projectNumber
      ? `${row.projectNumber} - ${row.projectName}`
      : row.projectName
    let emailResult: Awaited<ReturnType<typeof sendCompassEmail>>
    try {
      emailResult = await sendCompassEmail({
        env,
        db,
        organizationId: row.organizationId,
        to: [email],
        replyTo: "compass@hps-colorado.com",
        subject: parsed.data.subject,
        text: `${parsed.data.message}\n\nOpen Compass: ${actionUrl}`,
        html: buildProjectAccessWelcomeHtml({
          message: parsed.data.message,
          actionUrl,
          actionLabel:
            accessStatus === "access_granted"
              ? "Open Compass"
              : "Set Up Compass Access",
          projectLabel,
        }),
      })
    } catch (error) {
      emailResult = {
        status: "failed",
        provider: "gmail",
        providerMessageId: null,
        error:
          error instanceof Error
            ? error.message
            : "Welcome email provider failed.",
      }
    }

    await db
      .insert(projectAccessInvitations)
      .values({
        id: crypto.randomUUID(),
        organizationId: row.organizationId,
        projectId: parsed.data.projectId,
        projectContactId: row.contact.id,
        email,
        role: membershipRole,
        status: accessStatus === "access_granted" ? "accepted" : "sent",
        workosInvitationId,
        workosExpiresAt,
        emailProvider: emailResult.provider,
        emailProviderMessageId: emailResult.providerMessageId,
        emailError: emailResult.error,
        invitedBy: currentUser.id,
        invitedAt: now,
        acceptedBy: activeExistingUser?.id ?? null,
        acceptedAt: activeExistingUser ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    await recordActivityEvent({
      db,
      organizationId: row.organizationId,
      projectId: parsed.data.projectId,
      actor: currentUser,
      category: "access",
      action:
        accessStatus === "access_granted"
          ? "project.access_granted"
          : "project.invitation_sent",
      entityType: "project_access_invitation",
      entityId: row.contact.id,
      summary:
        accessStatus === "access_granted"
          ? `Granted ${row.contact.displayName} access to ${projectLabel}.`
          : `Invited ${row.contact.displayName} to ${projectLabel}.`,
    })

    revalidatePath(`/dashboard/projects/${parsed.data.projectId}/contacts`)
    revalidatePath("/dashboard/people")
    return {
      success: true,
      accessStatus,
      warning:
        emailResult.status === "sent"
          ? null
          : `Project access was prepared, but the welcome email could not be sent: ${emailResult.error ?? "email provider unavailable"}`,
    }
  } catch (error) {
    console.error("Project access invitation failed", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to send the project invitation.",
    }
  }
}
