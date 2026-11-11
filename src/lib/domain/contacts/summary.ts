// Contacts domain: the project Contacts page summary (who is on the job, their
// invitation and account status, where each contact came from). Read only.
import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm"

import { customers, projectAccessInvitations, projectContacts, projectContactSourceLinks, projectMembers, users, vendors } from "@/db/schema"
import { activeDirectoryIdentityKeys } from "@/lib/contact-identity-ownership"
import { chunkD1Values } from "@/lib/d1-query"
import {
  projectContactAccessStatus,
  projectContactCompassAccountStatus,
  type ProjectContactCompassAccountStatus,
  type ProjectContactInvitationSnapshot,
} from "@/lib/project-contact-access-status"
import { canViewHistoricalProjectContacts } from "@/lib/project-contact-display"
import type { ProjectContext } from "@/lib/server/action-context"
import { contactsProjectContext } from "./access"
import { projectContactPersonStatusSql } from "./person-status"

import { buildCsiGroups, buildGroups, normalizeEmailKey, toContactItem } from "./rules"
import { resolvedProjectContacts } from "./resolved-project-contacts"
import type {
  ProjectContactAudience,
  ProjectContactItem,
  ProjectContactsSummary,
  ProjectContactsSummaryOptions,
} from "./types"

type ContactRow = Awaited<ReturnType<typeof resolvedProjectContacts>>[number]
type InvitationSnapshot = ProjectContactInvitationSnapshot & Pick<ProjectContactItem, "welcomeEmail">

function visibilityWhere(audience: ProjectContactAudience): SQL | undefined {
  if (audience === "owner") {
    return and(eq(projectContacts.active, true), eq(projectContacts.ownerPortalVisible, true))
  }
  if (audience === "sub_vendor") {
    return and(eq(projectContacts.active, true), eq(projectContacts.subVendorPortalVisible, true))
  }
  return and(
    eq(projectContacts.active, true),
    or(
      eq(projectContacts.internalVisible, true),
      eq(projectContacts.ownerPortalVisible, true),
      eq(projectContacts.subVendorPortalVisible, true)
    )
  )
}

const historicalWhere = and(
  eq(projectContacts.active, false),
  eq(projectContacts.contactType, "internal"),
  or(
    // Staff removed from Contacts: archiving took them off this job.
    sql`exists (
      select 1 from internal_contacts ic
      where ic.id = ${projectContacts.internalContactId} and ic.active = 0
    )`,
    and(
      eq(projectContacts.sourceSystem, "buildertrend"),
      // Inactive imports also include superseded duplicates. Only surface rows
      // that the cutover explicitly classified as historical staff records.
      sql`case
        when json_valid(${projectContacts.notes}) = 1
          then json_extract(${projectContacts.notes}, '$.formerEmployeeStatus')
        else null
      end in ('former_employee', 'former_employee_or_review')`
    )
  ),
  sql`not exists (
    select 1
    from project_contacts active_contact
    where active_contact.project_id = ${projectContacts.projectId}
      and active_contact.active = 1
      and active_contact.contact_type = 'internal'
      and (
        (
          ${projectContacts.sourceEntityId} is not null
          and active_contact.source_entity_id = ${projectContacts.sourceEntityId}
        )
        or (
          trim(coalesce(${projectContacts.email}, '')) <> ''
          and lower(trim(active_contact.email)) = lower(trim(${projectContacts.email}))
        )
      )
  )`
)

function directoryEntityIds(rows: readonly ContactRow[]): readonly string[] {
  return rows.flatMap((row) => {
    const ids: string[] = []
    if (
      (row.sourceEntityType === "customer" ||
        row.sourceEntityType === "vendor" ||
        row.sourceEntityType === "customer_contact" ||
        row.sourceEntityType === "vendor_contact") &&
      row.sourceEntityId
    ) {
      ids.push(row.sourceEntityId)
    }
    if (row.customerContactId) ids.push(row.customerContactId)
    if (row.vendorContactId) ids.push(row.vendorContactId)
    return ids
  })
}

/** Strongest status wins when one email has several accounts. */
function accountStatusByEmail(
  accounts: readonly { readonly id: string; readonly email: string; readonly isActive: boolean }[]
): ReadonlyMap<string, ProjectContactCompassAccountStatus> {
  const statuses = new Map<string, ProjectContactCompassAccountStatus>()
  for (const account of accounts) {
    const email = normalizeEmailKey(account.email)
    if (!email) continue
    const current = statuses.get(email)
    const next = projectContactCompassAccountStatus(account)
    if (current === undefined || next === "active" || (next === "inactive" && current === "not_registered")) {
      statuses.set(email, next)
    }
  }
  return statuses
}

function sourceCounts(
  links: readonly { readonly matchStatus: string }[]
): Pick<
  ProjectContactsSummary,
  | "matchedSourceCount"
  | "unmatchedSourceCount"
  | "reviewSourceCount"
  | "pendingAssignmentSourceCount"
  | "approvedSourceCount"
> {
  const count = (statuses: readonly string[]): number =>
    links.filter((link) => statuses.includes(link.matchStatus)).length
  return {
    matchedSourceCount: count(["matched", "approved"]),
    unmatchedSourceCount: count(["unmatched"]),
    reviewSourceCount: count(["review"]),
    pendingAssignmentSourceCount: count(["pending_assignment"]),
    approvedSourceCount: count(["approved"]),
  }
}

/** Sage numbers of the contacts' vendor and client companies, keyed "vendor:<id>" / "customer:<id>". */
async function companySageNumbers(
  db: ProjectContext["db"],
  rows: readonly { readonly vendorId: string | null; readonly customerId: string | null }[]
): Promise<ReadonlyMap<string, string>> {
  const vendorIds = [...new Set(rows.flatMap((row) => (row.vendorId ? [row.vendorId] : [])))]
  const customerIds = [...new Set(rows.flatMap((row) => (row.customerId ? [row.customerId] : [])))]
  const [vendorRows, customerRows] = await Promise.all([
    Promise.all(chunkD1Values(vendorIds).map((ids) =>
      db.select({ id: vendors.id, number: vendors.sageVendorNumber }).from(vendors).where(inArray(vendors.id, [...ids])))),
    Promise.all(chunkD1Values(customerIds).map((ids) =>
      db.select({ id: customers.id, number: customers.sageClientNumber }).from(customers).where(inArray(customers.id, [...ids])))),
  ])
  const numbers = new Map<string, string>()
  for (const row of vendorRows.flat()) if (row.number) numbers.set(`vendor:${row.id}`, row.number)
  for (const row of customerRows.flat()) if (row.number) numbers.set(`customer:${row.id}`, row.number)
  return numbers
}

/** Unexpired Compass invites waiting on other jobs of the company, by email. */
async function vendorInvitesPendingElsewhere(
  db: ProjectContext["db"],
  input: { readonly organizationId: string; readonly projectId: string; readonly emails: readonly string[] }
): Promise<ReadonlyMap<string, InvitationSnapshot>> {
  const pending = new Map<string, InvitationSnapshot>()
  const emails = [...new Set(input.emails)]
  if (emails.length === 0) return pending
  const now = Date.now()
  const chunks = await Promise.all(
    chunkD1Values(emails).map((batch) =>
      db
        .select({
          email: projectAccessInvitations.email,
          workosExpiresAt: projectAccessInvitations.workosExpiresAt,
        })
        .from(projectAccessInvitations)
        .where(
          and(
            eq(projectAccessInvitations.organizationId, input.organizationId),
            ne(projectAccessInvitations.projectId, input.projectId),
            eq(projectAccessInvitations.status, "sent"),
            inArray(sql<string>`lower(trim(${projectAccessInvitations.email}))`, [...batch])
          )
        )
    )
  )
  for (const invitation of chunks.flat()) {
    const expiresAt = invitation.workosExpiresAt ? new Date(invitation.workosExpiresAt).getTime() : Number.NaN
    if (Number.isFinite(expiresAt) && expiresAt <= now) continue
    const email = normalizeEmailKey(invitation.email)
    if (!pending.has(email)) {
      pending.set(email, {
        status: "sent",
        workosExpiresAt: invitation.workosExpiresAt,
        acceptedUserActive: null,
        welcomeEmail: null,
      })
    }
  }
  return pending
}

async function loadProjectContactsSummary(
  context: ProjectContext,
  audience: ProjectContactAudience,
  options: ProjectContactsSummaryOptions
): Promise<ProjectContactsSummary> {
  const { db, project } = context
  const projectId = project.id
  const organizationId = project.organizationId
  if (!organizationId) throw new Error("Project not found")

  const includeHistorical =
    options.includeHistorical === true &&
    audience === "internal" &&
    canViewHistoricalProjectContacts(context.user.role)
  const rows = await resolvedProjectContacts(db, {
    organizationId,
    projectId,
    where: includeHistorical ? or(visibilityWhere(audience), historicalWhere) : visibilityWhere(audience),
    order: "summary",
  })

  const contactEmails = Array.from(
    new Set(rows.map((row) => normalizeEmailKey(row.email)).filter((email) => email.length > 0))
  )
  const [directoryIdentityKeys, invitationRows, activeProjectMemberRows, compassAccountChunks, sourceLinks, sageNumbers, personRows] =
    await Promise.all([
      activeDirectoryIdentityKeys({ db, organizationId, entityIds: directoryEntityIds(rows) }),
      db
        .select({
          projectContactId: projectAccessInvitations.projectContactId,
          email: projectAccessInvitations.email,
          status: projectAccessInvitations.status,
          workosExpiresAt: projectAccessInvitations.workosExpiresAt,
          emailStatus: projectAccessInvitations.emailStatus,
          emailNextAttemptAt: projectAccessInvitations.emailNextAttemptAt,
          acceptedUserActive: users.isActive,
          invitedAt: projectAccessInvitations.invitedAt,
        })
        .from(projectAccessInvitations)
        .leftJoin(users, eq(users.id, projectAccessInvitations.acceptedBy))
        .where(eq(projectAccessInvitations.projectId, projectId))
        .orderBy(desc(projectAccessInvitations.invitedAt)),
      db
        .select({ userId: users.id, email: users.email })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(and(eq(projectMembers.projectId, projectId), eq(users.isActive, true))),
      Promise.all(
        chunkD1Values(contactEmails).map((emails) =>
          db
            .select({ id: users.id, email: users.email, isActive: users.isActive })
            .from(users)
            .where(inArray(sql<string>`lower(trim(${users.email}))`, [...emails]))
        )
      ),
      db
        .select({ matchStatus: projectContactSourceLinks.matchStatus })
        .from(projectContactSourceLinks)
        .where(eq(projectContactSourceLinks.projectId, projectId)),
      companySageNumbers(db, rows),
      db
        .select({ id: projectContacts.id, personStatus: projectContactPersonStatusSql() })
        .from(projectContacts)
        .where(
          and(
            eq(projectContacts.projectId, projectId),
            eq(projectContacts.active, true)
          )
        ),
    ])

  const compassAccountStatuses = accountStatusByEmail(compassAccountChunks.flat())
  const latestInvitationByContactId = new Map<string, InvitationSnapshot>()
  const latestInvitationByEmail = new Map<string, InvitationSnapshot>()
  for (const invitation of invitationRows) {
    const snapshot: InvitationSnapshot = {
      status: invitation.status,
      workosExpiresAt: invitation.workosExpiresAt,
      acceptedUserActive: invitation.acceptedUserActive,
      welcomeEmail: { status: invitation.emailStatus, nextAttemptAt: invitation.emailNextAttemptAt },
    }
    if (invitation.projectContactId && !latestInvitationByContactId.has(invitation.projectContactId)) {
      latestInvitationByContactId.set(invitation.projectContactId, snapshot)
    }
    const email = normalizeEmailKey(invitation.email)
    if (email && !latestInvitationByEmail.has(email)) latestInvitationByEmail.set(email, snapshot)
  }
  const pendingElsewhereByEmail = await vendorInvitesPendingElsewhere(db, {
    organizationId,
    projectId,
    emails: rows
      .filter((row) => row.active && (row.contactType === "supplier" || row.contactType === "subcontractor"))
      .map((row) => normalizeEmailKey(row.email))
      .filter((email) => email.length > 0 && !latestInvitationByEmail.has(email)),
  })
  const activeProjectUserIds = new Set(activeProjectMemberRows.map((member) => member.userId))
  const activeProjectEmails = new Set(activeProjectMemberRows.map((member) => normalizeEmailKey(member.email)))

  const personStatusById = new Map(personRows.map((row) => [row.id, row.personStatus]))
  // Archived people (removed from Contacts, or former staff whose account is
  // inactive or no longer in the company) read as historical records. The
  // row itself is not changed.
  const isArchivedPerson = (row: ContactRow): boolean =>
    row.active && personStatusById.get(row.id) === "archived_person"

  const toProjectContactItem = (row: ContactRow): ProjectContactItem => {
    const email = normalizeEmailKey(row.email)
    const compassAccountStatus = compassAccountStatuses.get(email) ?? "not_registered"
    const ownInvitation =
      latestInvitationByContactId.get(row.id) ?? (email ? latestInvitationByEmail.get(email) : undefined) ?? null
    // A supplier or subcontractor with no invite from this job still reads "invite pending" when
    // one is waiting from another job of the company. Status only: it grants nothing here.
    const vendorRow = row.contactType === "supplier" || row.contactType === "subcontractor"
    const latestInvitation = ownInvitation ?? (vendorRow ? pendingElsewhereByEmail.get(email) ?? null : null)
    const activeProjectMember =
      (row.sourceEntityType === "user" && row.sourceEntityId !== null && activeProjectUserIds.has(row.sourceEntityId)) ||
      (email.length > 0 && activeProjectEmails.has(email))

    return toContactItem(
      row,
      row.active
        ? projectContactAccessStatus({
            companyStaff: personStatusById.get(row.id) === "current_staff",
            activeProjectMember,
            latestInvitation,
            compassAccountStatus,
          })
        : "not_invited",
      (row.sourceEntityId !== null && directoryIdentityKeys.has(`${row.sourceEntityType}:${row.sourceEntityId}`)) ||
        (row.vendorContactId !== null && directoryIdentityKeys.has(`vendor_contact:${row.vendorContactId}`)) ||
        (row.customerContactId !== null && directoryIdentityKeys.has(`customer_contact:${row.customerContactId}`)),
      compassAccountStatus,
      ownInvitation?.welcomeEmail ?? null,
      (row.vendorId ? sageNumbers.get(`vendor:${row.vendorId}`) : undefined) ??
        (row.customerId ? sageNumbers.get(`customer:${row.customerId}`) : undefined) ?? null
    )
  }
  const allContacts = rows.filter((row) => row.active && !isArchivedPerson(row)).map(toProjectContactItem)
  const historicalContacts = [
    ...rows.filter((row) => !row.active),
    ...(includeHistorical ? rows.filter(isArchivedPerson).map((row) => ({ ...row, active: false })) : []),
  ].map(toProjectContactItem)
  const countType = (type: ProjectContactItem["contactType"]): number =>
    allContacts.filter((contact) => contact.contactType === type).length

  return {
    audience,
    totalCount: allContacts.length,
    ownerCount: countType("owner"),
    supplierCount: countType("supplier"),
    subcontractorCount: countType("subcontractor"),
    internalCount: countType("internal"),
    visibleToOwnerCount: allContacts.filter((contact) => contact.ownerPortalVisible).length,
    visibleToSubVendorCount: allContacts.filter((contact) => contact.subVendorPortalVisible).length,
    ...sourceCounts(sourceLinks),
    groups: buildGroups(allContacts),
    csiGroups: buildCsiGroups(allContacts),
    allContacts,
    historicalContacts,
  }
}

/**
 * The project contacts summary for the signed-in viewer: contacts project
 * access (organization scope), then the summary for the audience.
 */
export async function readProjectContactsSummary(
  projectId: string,
  audience: ProjectContactAudience = "internal",
  options: ProjectContactsSummaryOptions = {}
): Promise<ProjectContactsSummary> {
  const context = await contactsProjectContext(projectId)
  return loadProjectContactsSummary(context, audience, options)
}
