import { and, eq, inArray, ne, or, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { buildertrendAccessCandidates } from "@/db/schema-buildertrend"
import { projectAccessInvitations, projectContacts, projectMembers, projects } from "@/db/schema"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { insertProjectContact, updateProjectContactById } from "@/lib/domain/contacts/store"
import { insertProjectAccessInvitation } from "@/lib/domain/identity/store"
import { insertProjectMember, updateProjectMembers } from "@/lib/domain/project/store"
import { ensureProjectAudienceConversation } from "@/lib/project-audience-conversations"
import { projectNumberAndName } from "@/lib/project-display-name"

type Db = ReturnType<typeof getDb>
type ProjectContact = typeof projectContacts.$inferSelect

/** Invitation email status for access delivered by another invitation's welcome email. */
const INCLUDED_INVITATION_EMAIL_STATUS = "included"

type PriorProjectGroup = "active" | "closed"

export type PriorProject = {
  readonly projectId: string
  readonly label: string
  readonly buildertrendStatus: string | null
  readonly group: PriorProjectGroup
  /** Staff-only projects (e.g. under a legal hold) are listed but can never be granted. */
  readonly locked: boolean
  readonly projectContactId: string | null
}

const ACTIVE_BUILDERTREND_STATUSES = new Set(["open", "warranty", "presale"])

export function priorProjectGroup(buildertrendStatus: string | null): PriorProjectGroup {
  if (!buildertrendStatus) return "active"
  return ACTIVE_BUILDERTREND_STATUSES.has(buildertrendStatus.trim().toLowerCase()) ? "active" : "closed"
}

function buildertrendStatusFromNotes(notes: string | null): string | null {
  if (!notes) return null
  try {
    const parsed: unknown = JSON.parse(notes)
    if (typeof parsed !== "object" || parsed === null) return null
    const status = Reflect.get(parsed, "status")
    return typeof status === "string" && status ? status : null
  } catch {
    return null
  }
}

/**
 * Other projects this contact (or, for vendors, their company) could see in
 * Buildertrend, matched through the captured BT job access lists by the
 * project contact, its email or its vendor. Never matched by name.
 */
export async function priorBuildertrendProjects(db: Db, input: {
  readonly organizationId: string
  readonly projectId: string
  readonly contactId: string
  readonly emails: readonly string[]
  readonly vendorId: string | null
}): Promise<readonly PriorProject[]> {
  const emails = [...new Set(input.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
  const matches = [eq(buildertrendAccessCandidates.projectContactId, input.contactId)]
  if (emails.length) matches.push(inArray(sql<string>`lower(trim(${buildertrendAccessCandidates.email}))`, emails))
  if (input.vendorId) matches.push(eq(buildertrendAccessCandidates.matchedVendorId, input.vendorId))
  const entities = await db
    .selectDistinct({ entity: buildertrendAccessCandidates.buildertrendContactId })
    .from(buildertrendAccessCandidates)
    .where(and(
      eq(buildertrendAccessCandidates.organizationId, input.organizationId),
      eq(buildertrendAccessCandidates.matchStatus, "matched"),
      or(...matches),
    ))
    .all()
  const entityIds = entities.flatMap((row) => row.entity ? [row.entity] : [])
  if (entityIds.length === 0) return []

  const rows = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
      staffOnly: projects.importedConversationsStaffOnly,
      projectContactId: buildertrendAccessCandidates.projectContactId,
      contactActive: projectContacts.active,
      notes: buildertrendAccessCandidates.sourceNotes,
    })
    .from(buildertrendAccessCandidates)
    .innerJoin(projects, eq(projects.id, buildertrendAccessCandidates.projectId))
    .leftJoin(projectContacts, and(
      eq(projectContacts.id, buildertrendAccessCandidates.projectContactId),
      eq(projectContacts.projectId, projects.id),
    ))
    .where(and(
      eq(buildertrendAccessCandidates.organizationId, input.organizationId),
      eq(buildertrendAccessCandidates.matchStatus, "matched"),
      inArray(buildertrendAccessCandidates.buildertrendContactId, entityIds),
      eq(projects.organizationId, input.organizationId),
      ne(projects.id, input.projectId),
    ))
    .all()

  const byProject = new Map<string, PriorProject>()
  for (const row of rows) {
    const contactId = row.projectContactId && row.contactActive ? row.projectContactId : null
    const existing = byProject.get(row.projectId)
    if (existing) {
      if (!existing.projectContactId && contactId) byProject.set(row.projectId, { ...existing, projectContactId: contactId })
      continue
    }
    const status = buildertrendStatusFromNotes(row.notes)
    byProject.set(row.projectId, {
      projectId: row.projectId,
      label: row.projectNumber
        ? projectNumberAndName({ projectNumber: row.projectNumber, name: row.projectName }, " - ")
        : row.projectName,
      buildertrendStatus: status,
      group: priorProjectGroup(status),
      locked: Boolean(row.staffOnly),
      projectContactId: contactId,
    })
  }
  return [...byProject.values()].sort((a, b) =>
    Number(a.locked) - Number(b.locked) ||
    (a.group === b.group ? 0 : a.group === "active" ? -1 : 1) ||
    a.label.localeCompare(b.label, undefined, { numeric: true }))
}

/** Reuse the person's contact on the target project, or add them there as the invited contact. */
async function contactOnProject(db: Db, input: {
  readonly projectId: string
  readonly matchedContactId: string | null
  readonly source: ProjectContact
  readonly email: string
  readonly now: string
}): Promise<string> {
  if (input.matchedContactId) return input.matchedContactId
  const { source } = input
  const sameDirectoryPerson = source.vendorContactId
    ? eq(projectContacts.vendorContactId, source.vendorContactId)
    : source.customerContactId
      ? eq(projectContacts.customerContactId, source.customerContactId)
      : undefined
  const existing = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(and(
      eq(projectContacts.projectId, input.projectId),
      eq(projectContacts.active, true),
      eq(projectContacts.contactType, source.contactType),
      sameDirectoryPerson
        ? or(sameDirectoryPerson, sql`lower(trim(${projectContacts.email})) = ${input.email}`)
        : sql`lower(trim(${projectContacts.email})) = ${input.email}`,
    ))
    .get()
  if (existing) return existing.id
  const id = `prior-access-${crypto.randomUUID()}`
  await insertProjectContact(db, {
    id,
    projectId: input.projectId,
    contactType: source.contactType,
    sourceSystem: source.sourceSystem,
    sourceRecordId: source.sourceRecordId,
    sourceEntityType: source.sourceEntityType,
    sourceEntityId: source.sourceEntityId,
    vendorId: source.vendorId,
    vendorContactId: source.vendorContactId,
    customerId: source.customerId,
    customerContactId: source.customerContactId,
    displayName: source.displayName,
    companyName: source.companyName,
    role: source.role,
    trade: source.trade,
    csiDivision: source.csiDivision,
    csiDivisionName: source.csiDivisionName,
    primaryCostCode: source.primaryCostCode,
    email: input.email,
    phone: source.phone,
    createdAt: input.now,
    updatedAt: input.now,
  })
  return id
}

/**
 * Opens one project to a person through their contact on it: shows the
 * contact in the owner or vendor portal, makes an active account a project
 * member, adds them to the project's owner or vendor conversation, and
 * records the access on project_access_invitations. A pending account gets
 * a "sent" row that is claimed at sign-in. No email is sent here; the
 * caller's own invitation or approval email covers it. Used by an
 * invitation's extra Buildertrend projects and by approved access requests.
 */
export async function grantProjectContactAccess(db: Db, input: {
  readonly organizationId: string
  readonly projectId: string
  readonly projectContactId: string
  /** Normalized (trimmed, lowercase) sign-in email. */
  readonly email: string
  /** Project role: owner, client, subcontractor or supplier. */
  readonly role: string
  readonly activeUserId: string | null
  readonly workosInvitationId: string | null
  readonly workosExpiresAt: string | null
  readonly invitedBy: string
  readonly now: string
}): Promise<void> {
  const audience = input.role === "owner" || input.role === "client"
    ? "owner"
    : input.role === "subcontractor" || input.role === "supplier" ? "sub_vendor" : null
  const contactId = input.projectContactId
  await updateProjectContactById(db, {
    contactId,
    values: audience === "owner"
      ? { ownerPortalVisible: true, updatedAt: input.now }
      : { subVendorPortalVisible: true, updatedAt: input.now },
  })
  const open = await db
    .select({ id: projectAccessInvitations.id })
    .from(projectAccessInvitations)
    .where(and(
      eq(projectAccessInvitations.projectId, input.projectId),
      eq(projectAccessInvitations.status, "sent"),
      sql`lower(trim(${projectAccessInvitations.email})) = ${input.email}`,
    ))
    .get()
  if (input.activeUserId) {
    const membership = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.activeUserId)))
      .get()
    if (!membership) {
      await insertProjectMember(db, {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        userId: input.activeUserId,
        role: input.role,
        assignedAt: input.now,
      })
    } else {
      await updateProjectMembers(db, eq(projectMembers.id, membership.id), { role: input.role })
    }
  }
  if (audience) {
    await ensureProjectAudienceConversation({
      db,
      projectId: input.projectId,
      organizationId: input.organizationId,
      audience,
      contactId: audience === "owner" ? null : contactId,
      importedContactId: contactId,
      externalUserId: input.activeUserId,
      createdBy: input.invitedBy,
      now: input.now,
    })
  }
  if (!open || input.activeUserId) {
    await insertProjectAccessInvitation(db, {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      projectContactId: contactId,
      email: input.email,
      role: input.role,
      status: input.activeUserId ? "accepted" : "sent",
      workosInvitationId: input.workosInvitationId,
      workosExpiresAt: input.workosExpiresAt,
      emailStatus: INCLUDED_INVITATION_EMAIL_STATUS,
      invitedBy: input.invitedBy,
      invitedAt: input.now,
      acceptedBy: input.activeUserId,
      acceptedAt: input.activeUserId ? input.now : null,
      createdAt: input.now,
      updatedAt: input.now,
    })
  }
}

/**
 * Grant the ticked Buildertrend projects alongside one invitation. The main
 * invitation carries the only email; these rows are claimed with it at sign-in
 * (pending) or take effect now (active account).
 */
export async function grantPriorProjectAccess(db: Db, input: {
  readonly organizationId: string
  readonly sourceProjectId: string
  readonly source: ProjectContact
  readonly requestedProjectIds: readonly string[]
  readonly email: string
  readonly role: string
  readonly activeUserId: string | null
  readonly workosInvitationId: string | null
  readonly workosExpiresAt: string | null
  readonly actor: ActivityActor
  readonly invitedBy: string
  readonly sourceProjectLabel: string
  readonly now: string
}): Promise<number> {
  const requested = new Set(input.requestedProjectIds)
  if (requested.size === 0) return 0
  const allowed = (await priorBuildertrendProjects(db, {
    organizationId: input.organizationId,
    projectId: input.sourceProjectId,
    contactId: input.source.id,
    emails: [input.email, input.source.email ?? ""],
    vendorId: input.source.vendorId,
  })).filter((project) => requested.has(project.projectId) && !project.locked)

  let granted = 0
  for (const project of allowed) {
    const contactId = await contactOnProject(db, {
      projectId: project.projectId,
      matchedContactId: project.projectContactId,
      source: input.source,
      email: input.email,
      now: input.now,
    })
    await grantProjectContactAccess(db, {
      organizationId: input.organizationId,
      projectId: project.projectId,
      projectContactId: contactId,
      email: input.email,
      role: input.role,
      activeUserId: input.activeUserId,
      workosInvitationId: input.workosInvitationId,
      workosExpiresAt: input.workosExpiresAt,
      invitedBy: input.invitedBy,
      now: input.now,
    })
    await recordActivityEvent({
      db,
      organizationId: input.organizationId,
      projectId: project.projectId,
      actor: input.actor,
      category: "access",
      action: input.activeUserId ? "project.access_granted" : "project.invitation_prepared",
      entityType: "project_access_invitation",
      entityId: contactId,
      summary: input.activeUserId
        ? `Granted ${input.source.displayName} access to ${project.label} with the invitation from ${input.sourceProjectLabel}.`
        : `Added ${project.label} to ${input.source.displayName}'s Compass invitation from ${input.sourceProjectLabel}.`,
    })
    granted++
  }
  return granted
}
