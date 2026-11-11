/**
 * The Request access workflow (approved 2026-11-10):
 *
 * 1. A signed-in person asks to join a company that allows requests
 *    (`submitAccessRequest`). One pending request per person and company.
 * 2. The company's admins review it in Settings > People > Access requests.
 * 3. An admin links it to the person's directory record and approves
 *    (`approveAccessRequest`): the person joins the company with the chosen
 *    role, the directory person is linked to their login, and every job
 *    that directory person is on opens to them through the same grant the
 *    project invitation uses (`grantProjectContactAccess`). Or the admin
 *    declines (`declineAccessRequest`) and nothing is shared.
 *
 * Nothing is ever granted without an admin's approval. Emails and
 * notifications are sent by ./notify.ts after these return.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm"

import {
  customerContacts,
  customers,
  organizationMembers,
  projectContacts,
  projects,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { organizationAccessRequests } from "@/db/schema-access-requests"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { grantProjectContactAccess } from "@/lib/domain/contacts/prior-project-access"
import { contactAccountLinkStatements } from "@/lib/domain/contacts/store"
import { ensureExternalOrganizationMembership, insertOrganizationMember } from "@/lib/domain/identity/store"
import { projectNumberAndName } from "@/lib/project-display-name"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

import { companyAccessRequest, isOrganizationMember, requestableOrganization } from "./queries"
import {
  ACCESS_REQUEST_KIND_LABELS,
  accessRequestInputSchema,
  approveAccessRequestSchema,
  approvedOrganizationRole,
  canDecideAccessRequests,
  projectRoleForContactType,
  type AccessRequestInput,
  type ApproveAccessRequestInput,
} from "./rules"
import { decideAccessRequest, insertAccessRequest, reopenAccessRequest, setAccessRequestProjectCount } from "./store"
import type { AccessRequestKind } from "./statuses"

type Failure = { readonly success: false; readonly error: string }
type Result<T> = { readonly success: true; readonly data: T } | Failure

function fail(error: string): Failure {
  return { success: false, error }
}

/** Who is acting: the signed-in user with their active company and role there. */
export type AccessRequestActor = ActivityActor & {
  readonly id: string
  readonly organizationId: string | null
  readonly isActive: boolean
}

function requesterActor(user: { readonly id: string; readonly email: string; readonly displayName: string | null }): ActivityActor {
  return { id: user.id, email: user.email, displayName: user.displayName, firstName: null, lastName: null, role: "requester" }
}

// ---------------------------------------------------------------------------
// The person asking
// ---------------------------------------------------------------------------

export type SubmittedAccessRequest = {
  readonly requestId: string
  readonly organizationId: string
  readonly organizationName: string
  readonly kind: AccessRequestKind
  readonly requesterName: string
  readonly companyName: string | null
}

/** Records a pending request. Refused for a company that doesn't allow requests or that the person already belongs to. */
export async function submitAccessRequest(
  db: Db,
  requester: { readonly id: string; readonly email: string; readonly displayName: string | null },
  input: AccessRequestInput,
  now = new Date().toISOString(),
): Promise<Result<SubmittedAccessRequest>> {
  const parsed = accessRequestInputSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please review the request.")
  const value = parsed.data
  const org = await requestableOrganization(db, value.organizationId)
  if (!org) return fail("That company isn't taking access requests in Compass.")
  if (await isOrganizationMember(db, org.id, requester.id)) {
    return fail(`You already have access to ${org.name}. Choose it from the company menu.`)
  }
  const requestId = crypto.randomUUID()
  const inserted = await insertAccessRequest(db, {
    id: requestId,
    organizationId: org.id,
    userId: requester.id,
    kind: value.kind,
    // A company name only means something for a vendor.
    companyName: value.kind === "vendor" ? value.companyName : null,
    phone: value.phone,
    jobReference: value.jobReference,
    note: value.note,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  })
  if (!inserted) return fail(`Your request to ${org.name} is already waiting for approval.`)
  const requesterName = requester.displayName?.trim() || requester.email
  await recordActivityEvent({
    db,
    organizationId: org.id,
    actor: requesterActor(requester),
    category: "access",
    action: "access_request.submitted",
    entityType: "organization_access_request",
    entityId: requestId,
    summary: `${requesterName} (${requester.email}) asked for access as a ${ACCESS_REQUEST_KIND_LABELS[value.kind].toLowerCase()}.`,
    createdAt: now,
  })
  return {
    success: true,
    data: { requestId, organizationId: org.id, organizationName: org.name, kind: value.kind, requesterName, companyName: value.companyName },
  }
}

/** The person takes back their own pending request. */
export async function withdrawAccessRequest(
  db: Db,
  requester: { readonly id: string; readonly email: string; readonly displayName: string | null },
  requestId: string,
  now = new Date().toISOString(),
): Promise<Result<null>> {
  const row = await db
    .select({ organizationId: organizationAccessRequests.organizationId, userId: organizationAccessRequests.userId })
    .from(organizationAccessRequests)
    .where(eq(organizationAccessRequests.id, requestId))
    .get()
  if (!row || row.userId !== requester.id) return fail("Request not found.")
  const changed = await decideAccessRequest(db, requestId, { status: "withdrawn", decidedBy: requester.id, now })
  if (!changed) return fail("This request was already decided.")
  await recordActivityEvent({
    db,
    organizationId: row.organizationId,
    actor: requesterActor(requester),
    category: "access",
    action: "access_request.withdrawn",
    entityType: "organization_access_request",
    entityId: requestId,
    summary: `${requester.displayName?.trim() || requester.email} withdrew their access request.`,
    createdAt: now,
  })
  return { success: true, data: null }
}

// ---------------------------------------------------------------------------
// The company's admins
// ---------------------------------------------------------------------------

function requireDecider(actor: AccessRequestActor): string | Failure {
  if (!actor.isActive || !actor.organizationId || !canDecideAccessRequests(actor.role)) {
    return fail("Only an account administrator can review access requests.")
  }
  return actor.organizationId
}

export type DecidedAccessRequest = {
  readonly requestId: string
  readonly organizationId: string
  readonly organizationName: string
  readonly requesterUserId: string
  readonly requesterEmail: string
  readonly requesterName: string
  readonly requesterFirstName: string | null
  readonly kind: AccessRequestKind
}

export type ApprovedAccessRequest = DecidedAccessRequest & {
  readonly role: string
  /** Jobs opened, by label. */
  readonly projects: readonly string[]
  /** Jobs kept staff-only (for example under a legal hold), by label; invite from the job if they should see one. */
  readonly skippedProjects: readonly string[]
}

type LinkedPerson = { readonly id: string; readonly userId: string | null }

async function clientPerson(db: Db, organizationId: string, personId: string): Promise<LinkedPerson | undefined> {
  return db
    .select({ id: customerContacts.id, userId: customerContacts.userId })
    .from(customerContacts)
    .innerJoin(customers, eq(customers.id, customerContacts.customerId))
    .where(and(
      eq(customerContacts.id, personId),
      eq(customers.organizationId, organizationId),
      eq(customerContacts.active, true),
      isNull(customerContacts.mergedIntoPersonId),
      isNull(customers.mergedIntoCustomerId),
    ))
    .get()
}

async function vendorPerson(db: Db, organizationId: string, personId: string): Promise<LinkedPerson | undefined> {
  return db
    .select({ id: vendorContacts.id, userId: vendorContacts.userId })
    .from(vendorContacts)
    .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
    .where(and(
      eq(vendorContacts.id, personId),
      eq(vendors.organizationId, organizationId),
      eq(vendors.directoryStatus, "active"),
      eq(vendorContacts.active, true),
      isNull(vendorContacts.mergedIntoPersonId),
      isNull(vendors.mergedIntoVendorId),
    ))
    .get()
}

const jobColumns = {
  contactId: projectContacts.id,
  contactType: projectContacts.contactType,
  projectId: projects.id,
  projectName: projects.name,
  projectNumber: projects.projectNumber,
  staffOnly: projects.importedConversationsStaffOnly,
}

/** "Rita <Rita@X.com>" or " rita@x.com " -> "rita@x.com". */
export function plainEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const wrapped = value.match(/<([^<>]+)>/)
  const email = (wrapped ? wrapped[1] : value).trim().toLowerCase()
  return email.includes("@") ? email : null
}

/**
 * Every active job contact for this directory person, with what the grant
 * needs. For a client this also includes owner job contacts that name no
 * directory person yet but sit under a (not merged) client record and carry
 * the requester's own sign-in email, on the job contact or its client record.
 * Most owners imported from Buildertrend look like that. Read-only: no job
 * contact or directory row is changed to make the match.
 */
async function personJobs(
  db: Db,
  organizationId: string,
  kind: "client" | "vendor",
  personId: string,
  requesterEmail: string,
) {
  const base = and(eq(projects.organizationId, organizationId), eq(projectContacts.active, true))
  if (kind === "vendor") {
    return db.select(jobColumns).from(projectContacts)
      .innerJoin(projects, eq(projects.id, projectContacts.projectId))
      .where(and(base, eq(projectContacts.vendorContactId, personId)))
  }
  const linked = await db.select(jobColumns).from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .where(and(base, eq(projectContacts.customerContactId, personId)))
  const email = plainEmail(requesterEmail)
  if (!email) return linked
  const like = `%${email}%`
  const unpersoned = await db
    .select({ ...jobColumns, contactEmail: projectContacts.email, customerEmail: customers.email })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .innerJoin(customers, eq(customers.id, projectContacts.customerId))
    .where(and(
      base,
      isNull(projectContacts.customerContactId),
      eq(customers.organizationId, organizationId),
      isNull(customers.mergedIntoCustomerId),
      or(sql`lower(${projectContacts.email}) LIKE ${like}`, sql`lower(${customers.email}) LIKE ${like}`),
    ))
  const seen = new Set(linked.map((job) => job.contactId))
  const matched = unpersoned
    .filter((job) => plainEmail(job.contactEmail) === email || plainEmail(job.customerEmail) === email)
    .filter((job) => !seen.has(job.contactId))
    .map((job) => ({
      contactId: job.contactId,
      contactType: job.contactType,
      projectId: job.projectId,
      projectName: job.projectName,
      projectNumber: job.projectNumber,
      staffOnly: job.staffOnly,
    }))
  return [...linked, ...matched]
}

/**
 * Approves a pending request. The request is claimed first (pending →
 * approved) so two admins can't both approve; if granting fails part way it
 * goes back to pending and the admin can try again. Each grant step is
 * idempotent, so a retry finishes the job.
 */
export async function approveAccessRequest(
  db: Db,
  database: D1Database,
  actor: AccessRequestActor,
  input: ApproveAccessRequestInput,
  now = new Date().toISOString(),
): Promise<Result<ApprovedAccessRequest>> {
  const organizationId = requireDecider(actor)
  if (typeof organizationId !== "string") return organizationId
  const parsed = approveAccessRequestSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please review the approval.")
  const choice = parsed.data
  const found = await companyAccessRequest(db, organizationId, choice.requestId)
  if (!found) return fail("Request not found.")
  const { request } = found
  if (request.status !== "pending") return fail("This request was already decided.")
  if (request.kind !== choice.kind) return fail("Reload the request and try again.")
  if (!found.requesterActive) return fail("This person's Compass account is deactivated.")

  const existing = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, request.userId)))
    .get()
  // Never change a staff member's role from a request.
  if (existing && isInternalStaffRole(existing.role)) return fail("This person is already on your staff in Compass.")
  if (existing && choice.kind === "employee") return fail("This person already has access. Change their role in People.")

  const person = choice.kind === "client"
    ? await clientPerson(db, organizationId, choice.customerContactId)
    : choice.kind === "vendor"
      ? await vendorPerson(db, organizationId, choice.vendorContactId)
      : null
  if (choice.kind !== "employee") {
    if (!person) return fail("That directory contact wasn't found or is inactive.")
    if (person.userId && person.userId !== request.userId) {
      return fail("That directory contact is already linked to a different Compass login.")
    }
  }

  const role = approvedOrganizationRole(choice)
  const claimed = await decideAccessRequest(db, request.id, {
    status: "approved",
    decidedBy: actor.id,
    now,
    customerContactId: choice.kind === "client" ? choice.customerContactId : null,
    vendorContactId: choice.kind === "vendor" ? choice.vendorContactId : null,
    grantedRole: role,
  })
  if (!claimed) return fail("This request was already decided.")

  const opened: string[] = []
  const skipped: string[] = []
  try {
    if (choice.kind === "employee") {
      await insertOrganizationMember(db, { id: crypto.randomUUID(), organizationId, userId: request.userId, role, joinedAt: now })
    } else if (person) {
      await ensureExternalOrganizationMembership(db, { organizationId, userId: request.userId, role, now })
      if (person.userId !== request.userId) {
        // The same compare-and-set link (with its audit row) the Contacts page uses.
        const results = await database.batch(contactAccountLinkStatements(database, {
          kind: choice.kind === "client" ? "client_person" : "vendor_person",
          organizationId,
          personId: person.id,
          previousUserId: person.userId,
          nextUserId: request.userId,
          changedByUserId: actor.id,
          now,
        }))
        if (results[0]?.meta.changes !== 1) throw new Error("The directory contact changed while you were approving. Reload and try again.")
      }
      const email = found.requesterEmail.trim().toLowerCase()
      const jobs = await personJobs(db, organizationId, choice.kind, person.id, found.requesterEmail)
      // One grant per job, as the project invitation does: each step reads and
      // writes that job's membership, conversation and access rows.
      for (const job of jobs) {
        const label = job.projectNumber ? projectNumberAndName({ projectNumber: job.projectNumber, name: job.projectName }, " - ") : job.projectName
        const projectRole = projectRoleForContactType(job.contactType)
        if (!projectRole) continue
        if (job.staffOnly) {
          skipped.push(label)
          continue
        }
        await grantProjectContactAccess(db, {
          organizationId,
          projectId: job.projectId,
          projectContactId: job.contactId,
          email,
          role: projectRole,
          activeUserId: request.userId,
          workosInvitationId: null,
          workosExpiresAt: null,
          invitedBy: actor.id,
          now,
        })
        await recordActivityEvent({
          db,
          organizationId,
          projectId: job.projectId,
          actor,
          category: "access",
          action: "project.access_granted",
          entityType: "project_access_invitation",
          entityId: job.contactId,
          summary: `Granted ${found.requesterName} access to ${label} by approving their access request.`,
          createdAt: now,
        })
        opened.push(label)
      }
    }
    await setAccessRequestProjectCount(db, request.id, opened.length, now)
  } catch (error) {
    await reopenAccessRequest(db, request.id, new Date().toISOString())
    throw error
  }

  await recordActivityEvent({
    db,
    organizationId,
    actor,
    category: "access",
    action: "access_request.approved",
    entityType: "organization_access_request",
    entityId: request.id,
    summary: `Approved ${found.requesterName}'s access request as ${role}${opened.length ? ` with ${opened.length} job${opened.length === 1 ? "" : "s"}` : ""}.`,
    metadata: { role, projects: opened.length, skipped: skipped.length },
    createdAt: now,
  })
  return {
    success: true,
    data: {
      requestId: request.id,
      organizationId,
      organizationName: found.organizationName,
      requesterUserId: request.userId,
      requesterEmail: found.requesterEmail,
      requesterName: found.requesterName,
      requesterFirstName: found.requesterFirstName,
      kind: request.kind,
      role,
      projects: opened,
      skippedProjects: skipped,
    },
  }
}

/** Declines a pending request. Nothing is shared. */
export async function declineAccessRequest(
  db: Db,
  actor: AccessRequestActor,
  requestId: string,
  now = new Date().toISOString(),
): Promise<Result<DecidedAccessRequest>> {
  const organizationId = requireDecider(actor)
  if (typeof organizationId !== "string") return organizationId
  const found = await companyAccessRequest(db, organizationId, requestId)
  if (!found) return fail("Request not found.")
  const changed = await decideAccessRequest(db, requestId, { status: "declined", decidedBy: actor.id, now })
  if (!changed) return fail("This request was already decided.")
  await recordActivityEvent({
    db,
    organizationId,
    actor,
    category: "access",
    action: "access_request.declined",
    entityType: "organization_access_request",
    entityId: requestId,
    summary: `Declined ${found.requesterName}'s access request.`,
    createdAt: now,
  })
  return {
    success: true,
    data: {
      requestId,
      organizationId,
      organizationName: found.organizationName,
      requesterUserId: found.request.userId,
      requesterEmail: found.requesterEmail,
      requesterName: found.requesterName,
      requesterFirstName: found.requesterFirstName,
      kind: found.request.kind,
    },
  }
}

