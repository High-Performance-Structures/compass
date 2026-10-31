"use server"

import { and, desc, eq, inArray, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import {
  customerContacts,
  customers,
  internalContacts,
  projectAccessInvitations,
  projectContacts,
  projectMembers,
  organizationMembers,
  organizations,
  projects,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { cancelObsoleteInvitationEmails, deliverInvitationEmail } from "@/lib/email/invitation-delivery"
import { invitationEmailNotice } from "@/lib/email/delivery-recovery"
import { sendOrResendProjectWorkOSInvitation } from "@/lib/workos-invitations"
import { requirePermission } from "@/lib/permissions"
import { ensureProjectAudienceConversation } from "@/lib/project-audience-conversations"
import {
  projectContactAccessStatus,
  projectContactNeedsPersonForInvitation,
} from "@/lib/project-contact-access-status"
import { resolveProjectContactIdentity } from "@/lib/project-contact-directory-identity"
import { updateProjectContactById } from "@/lib/domain/contacts/store"
import { projectContactAddress } from "@/lib/project-contact-privacy"
import { projectContactInvitationTarget } from "@/lib/project-contact-invitation-target"
import { projectContactInvitationDirectorySelection } from "@/lib/project-contact-invitation-select"
import {
  isExternalProjectRole,
  isInternalStaffRole,
} from "@/lib/user-roles"
import { recordActivityEvent } from "@/lib/activity-log"
import { getProjectAudienceViewerContact } from "@/lib/project-audience-viewer-contact"
import { projectNumberAndName } from "@/lib/project-display-name"

const invitationSchema = z.object({
  projectId: z.string().trim().min(1),
  contactId: z.string().trim().min(1),
  subject: z.string().trim().min(1).max(180),
  message: z.string().trim().min(1).max(8000),
  intent: z.enum(["invite", "resend_welcome"]).default("invite"),
})

export type SendProjectAccessInvitationInput = z.input<
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
        ...projectContactInvitationDirectorySelection,
      })
      .from(projectContacts)
      .innerJoin(projects, eq(projects.id, projectContacts.projectId))
      .leftJoin(
        customers,
        and(
          or(
            eq(projectContacts.customerId, customers.id),
            and(
              eq(projectContacts.sourceEntityType, "customer"),
              eq(projectContacts.sourceEntityId, customers.id)
            )
          ),
          eq(customers.organizationId, projects.organizationId)
        )
      )
      .leftJoin(
        customerContacts,
        and(
          eq(projectContacts.customerContactId, customerContacts.id),
          eq(customerContacts.customerId, customers.id),
          eq(customerContacts.active, true)
        )
      )
      .leftJoin(
        vendors,
        and(
          or(
            eq(projectContacts.vendorId, vendors.id),
            and(
              eq(projectContacts.sourceEntityType, "vendor"),
              eq(projectContacts.sourceEntityId, vendors.id)
            )
          ),
          eq(vendors.organizationId, projects.organizationId)
        )
      )
      .leftJoin(
        vendorContacts,
        and(
          eq(projectContacts.vendorContactId, vendorContacts.id),
          eq(vendorContacts.vendorId, vendors.id),
          eq(vendorContacts.active, true)
        )
      )
      .leftJoin(
        users,
        and(
          eq(projectContacts.sourceEntityType, "user"),
          eq(projectContacts.sourceEntityId, users.id),
          sql`exists (
            select 1 from ${organizationMembers}
            where ${organizationMembers.userId} = ${users.id}
              and ${organizationMembers.organizationId} = ${projects.organizationId}
          )`
        )
      )
      .leftJoin(
        internalContacts,
        and(
          eq(projectContacts.internalContactId, internalContacts.id),
          eq(internalContacts.organizationId, projects.organizationId),
          eq(internalContacts.active, true)
        )
      )
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
    if (
      row.contact.contactType !== "owner" &&
      projectContactNeedsPersonForInvitation(row.contact)
    ) {
      return {
        success: false,
        error:
          "Select or add a contact person for this vendor before inviting them.",
      }
    }
    if (row.contact.customerContactId && !row.customerContact) {
      return { success: false, error: "The linked client contact is no longer active." }
    }
    if (row.contact.vendorContactId && !row.vendorContact) {
      return { success: false, error: "The linked vendor contact is no longer active." }
    }
    if (row.contact.internalContactId && !row.internalPerson) {
      return { success: false, error: "The linked internal contact is no longer active." }
    }

    // A deliberate person-to-login link always outranks a coincidental email
    // match. Deliver access mail to that login, not to a different contact email.
    const linkedUserId = row.contact.customerContactId
      ? row.customerContact?.userId ?? null
      : row.contact.vendorContactId
        ? row.vendorContact?.userId ?? null
        : row.contact.internalContactId
          ? row.internalPerson?.userId ?? null
          : row.contact.sourceEntityType === "user"
            ? row.contact.sourceEntityId
            : null

    const directoryIdentity =
      row.contact.vendorContactId
        ? {
            email: row.vendorContact?.email ?? null,
            phone: row.vendorContact?.phone ?? null,
            address: null,
          }
        : row.contact.customerContactId
          ? {
              email: row.customerContact?.email ?? null,
              phone: row.customerContact?.phone ?? null,
              address: row.customer?.address ?? null,
            }
        : row.contact.sourceEntityType === "customer"
        ? row.customer
        : row.contact.sourceEntityType === "vendor"
          ? row.vendor
          : row.contact.internalContactId
            ? row.internalPerson
              ? { ...row.internalPerson, address: null }
              : null
          : row.contact.sourceEntityType === "user"
            ? row.teamMember
              ? { ...row.teamMember, address: null }
              : null
            : null
    const canonicalLink = Boolean(
      row.contact.customerContactId ||
      row.contact.vendorContactId ||
      row.contact.internalContactId ||
      row.contact.customerId ||
      row.contact.vendorId ||
      directoryIdentity
    )
    const identity = resolveProjectContactIdentity(
      {
        email: row.contact.email,
        phone: row.contact.phone,
        address: projectContactAddress(row.contact.contactType, row.contact.address),
      },
      directoryIdentity,
      canonicalLink
    )
    const target = projectContactInvitationTarget({
      linkedUserId,
      directoryEmail: identity.email,
    })
    if (!target) {
      return {
        success: false,
        error: "Add an email address before inviting this contact.",
      }
    }
    const requestedRole = projectRoleForContactType(row.contact.contactType)
    if (!requestedRole) {
      return { success: false, error: "This contact type cannot be invited." }
    }

    const existingUser = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        phone: users.phone,
        address: users.address,
      })
      .from(users)
      .where(
        target.kind === "linked_user"
          ? eq(users.id, target.userId)
          : sql`lower(trim(${users.email})) = ${target.email}`
      )
      .get()
    if (target.kind === "linked_user" && !existingUser) {
      return { success: false, error: "The linked Compass account no longer exists. Review the contact-account link." }
    }
    if (target.kind === "linked_user") {
      const membership = await db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, row.organizationId),
            eq(organizationMembers.userId, target.userId)
          )
        )
        .get()
      if (
        !membership ||
        (row.contact.customerContactId && membership.role !== "client") ||
        (row.contact.vendorContactId &&
          membership.role !== "subcontractor" &&
          membership.role !== "supplier")
      ) {
        return { success: false, error: "The linked account no longer has the matching organization role. Review its contact-account link." }
      }
    }
    const inviteEmail = target.kind === "linked_user"
      ? existingUser?.email.trim().toLowerCase() ?? ""
      : target.email
    if (!inviteEmail) {
      return { success: false, error: "The linked Compass account needs a sign-in email before it can be invited." }
    }
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
    const welcomeOnly = parsed.data.intent === "resend_welcome"
    if (welcomeOnly && !activeExistingUser) {
      return { success: false, error: "Welcome-only recovery requires an active account with existing project access. Review access before inviting." }
    }
    const now = new Date().toISOString()
    // Welcome recovery must read the original contact binding before any identity write.
    if (!welcomeOnly) await updateProjectContactById(db, { contactId: row.contact.id, values: { ...identity, updatedAt: now } })
    const pendingInvitation = !activeExistingUser
      ? await db
          .select({
            id: projectAccessInvitations.id,
            workosExpiresAt: projectAccessInvitations.workosExpiresAt,
          })
          .from(projectAccessInvitations)
          .where(
            and(
              eq(projectAccessInvitations.projectId, parsed.data.projectId),
              eq(projectAccessInvitations.status, "sent"),
              or(
                eq(projectAccessInvitations.projectContactId, row.contact.id),
                sql`lower(trim(${projectAccessInvitations.email})) = ${inviteEmail}`
              )
            )
          )
          .orderBy(desc(projectAccessInvitations.invitedAt))
          .get()
      : null
    if (pendingInvitation) {
      const pendingStatus = projectContactAccessStatus({
        activeProjectMember: false,
        latestInvitation: {
          status: "sent",
          workosExpiresAt: pendingInvitation.workosExpiresAt,
          acceptedUserActive: null,
        },
        now: new Date(now),
      })
      // A pending invite may be lost in the recipient's inbox. Keep its send
      // history, then let WorkOS resend the current account invitation below.
      if (pendingStatus === "expired") {
        await db
          .update(projectAccessInvitations)
          .set({ status: "expired", updatedAt: now })
          .where(eq(projectAccessInvitations.id, pendingInvitation.id))
          .run()
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
    const existingProjectMembership = welcomeOnly && activeExistingUser
      ? await db.select({ role: projectMembers.role }).from(projectMembers).where(and(
          eq(projectMembers.projectId, parsed.data.projectId), eq(projectMembers.userId, activeExistingUser.id))).get()
      : null
    if (welcomeOnly && (!activeExistingUser || !existingProjectMembership || !internalMembership)) {
      return { success: false, error: "Welcome-only recovery requires an active account with existing project access. Review access before inviting." }
    }
    const existingViewerContact = welcomeOnly && activeExistingUser
      ? await getProjectAudienceViewerContact(db, parsed.data.projectId, activeExistingUser) : null
    if (welcomeOnly && existingViewerContact?.id !== row.contact.id) {
      return { success: false, error: "Resend the welcome from this account's current project contact. Review the contact-account link before changing access." }
    }
    const membershipRole = existingProjectMembership?.role ?? preservedOrganizationRole ?? requestedRole
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
    await cancelObsoleteInvitationEmails(db, { projectId: parsed.data.projectId,
      contactId: row.contact.id, email: inviteEmail, role: membershipRole, now })
    const queuedWelcome = await db.select({ status: projectAccessInvitations.emailStatus,
      nextAttemptAt: projectAccessInvitations.emailNextAttemptAt }).from(projectAccessInvitations)
      .where(and(eq(projectAccessInvitations.projectId, parsed.data.projectId),
        eq(projectAccessInvitations.projectContactId, row.contact.id),
        inArray(projectAccessInvitations.emailStatus, ["queued", "retrying", "sending"]))).get()
    if (queuedWelcome) return { success: true, accessStatus: activeExistingUser ? "access_granted" : "invited",
      warning: invitationEmailNotice(queuedWelcome.status, queuedWelcome.nextAttemptAt) }
    let workosInvitationId: string | null = null
    let workosExpiresAt: string | null = null
    let accessStatus: "invited" | "access_granted" = "invited"

    if (activeExistingUser) {
      if (
        !welcomeOnly && ((!activeExistingUser.phone && identity.phone) ||
        (!activeExistingUser.address && identity.address))
      ) {
        await db
          .update(users)
          .set({
            phone: activeExistingUser.phone ?? identity.phone,
            address: activeExistingUser.address ?? identity.address,
            updatedAt: now,
          })
          .where(eq(users.id, activeExistingUser.id))
          .run()
      }
      if (!welcomeOnly && !verifiedOrganizationMembership) {
        await ensureExternalOrganizationMembership({
          db,
          organizationId: row.organizationId,
          userId: activeExistingUser.id,
          role: requestedRole,
          now,
        })
      }
      if (!welcomeOnly) await ensureProjectMembership({
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
      const invitation = await sendOrResendProjectWorkOSInvitation({
        apiKey: workosApiKey,
        email: inviteEmail,
      })
      workosInvitationId = invitation.id
      workosExpiresAt = invitation.expiresAt
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
    if (!welcomeOnly) await updateProjectContactById(db, { contactId: row.contact.id, values: visibility })

    const audience =
      requestedRole === "owner"
        ? "owner"
        : requestedRole === "subcontractor" || requestedRole === "supplier"
          ? "sub_vendor"
          : null
    if (audience && !welcomeOnly) {
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
      ? projectNumberAndName({ projectNumber: row.projectNumber, name: row.projectName }, " - ")
      : row.projectName
    const invitationId = crypto.randomUUID()
    const inserted = await db
      .insert(projectAccessInvitations)
      .values({
        id: invitationId,
        organizationId: row.organizationId,
        projectId: parsed.data.projectId,
        projectContactId: row.contact.id,
        email: inviteEmail,
        role: membershipRole,
        status: accessStatus === "access_granted" ? "accepted" : "sent",
        workosInvitationId,
        workosExpiresAt,
        emailStatus: "queued",
        emailSubject: parsed.data.subject,
        emailMessage: parsed.data.message,
        emailNextAttemptAt: now,
        invitedBy: currentUser.id,
        invitedAt: now,
        acceptedBy: activeExistingUser?.id ?? null,
        acceptedAt: activeExistingUser ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: projectAccessInvitations.id })
    if (inserted.length === 0) return { success: true, accessStatus,
      warning: invitationEmailNotice("queued", null) }

    const emailDelivery = await deliverInvitationEmail({ db, env, invitationId })

    await recordActivityEvent({
      db,
      organizationId: row.organizationId,
      projectId: parsed.data.projectId,
      actor: currentUser,
      category: "access",
      action:
        welcomeOnly ? "project.welcome_email_requested" : accessStatus === "access_granted"
          ? "project.access_granted"
          : "project.invitation_prepared",
      entityType: "project_access_invitation",
      entityId: row.contact.id,
      summary:
        welcomeOnly ? `Requested a replacement Compass welcome email for ${row.contact.displayName}.` : accessStatus === "access_granted"
          ? `Granted ${row.contact.displayName} access to ${projectLabel}.`
          : `Prepared a Compass invitation for ${row.contact.displayName} for ${projectLabel}.`,
    })

    revalidatePath(`/dashboard/projects/${parsed.data.projectId}/contacts`)
    revalidatePath("/dashboard/people")
    return {
      success: true,
      accessStatus,
      warning: invitationEmailNotice(emailDelivery.status, emailDelivery.nextAttemptAt),
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
