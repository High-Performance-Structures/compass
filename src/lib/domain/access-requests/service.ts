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
import type { z } from "zod/v4"

import {
  customerContacts,
  customers,
  projectContacts,
  projects,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { membershipsView } from "@/lib/domain/identity/views"
import { organizationAccessRequests } from "@/db/schema-access-requests"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { directoryPersonWithEmail } from "@/lib/domain/contacts/directory-people"
import { grantProjectContactAccess } from "@/lib/domain/contacts/prior-project-access"
import { contactAccountLinkStatements, insertCustomer, insertCustomerPerson, insertVendor, insertVendorPersonStatement } from "@/lib/domain/contacts/store"
import { ensureExternalOrganizationMembership, insertOrganizationMember } from "@/lib/domain/identity/store"
import type { UserRole } from "@/lib/domain/identity/statuses"
import { projectNumberAndName } from "@/lib/project-display-name"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole, isSupplierRole } from "@/lib/user-roles"

import { companyAccessRequest, isOrganizationMember, requestableOrganization } from "./queries"
import {
  ACCESS_REQUEST_KIND_LABELS,
  accessRequestInputSchema,
  approveAccessRequestSchema,
  approvedOrganizationRole,
  canDecideAccessRequests,
  CLIENT_RECORD_OPTION_PREFIX,
  NEW_DIRECTORY_RECORD_OPTION,
  VENDOR_COMPANY_OPTION_PREFIX,
  projectRoleForContactType,
  type AccessRequestInput,
  type ApproveAccessRequestInput,
} from "./rules"
import { closeAccessRequest, insertAccessRequest, markAccessRequestApproved, recordAccessRequestGrant, rememberAccessRequestPerson, reopenAccessRequest } from "./store"
import type { AccessRequestKind } from "./statuses"
import { resolvedContactColumns, withContactDirectory } from "@/lib/domain/contacts/resolved-columns"

const memberships = membershipsView()

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
  const changed = await closeAccessRequest(db, requestId, "withdraw", { decidedBy: requester.id, now })
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

/**
 * A client record picked directly. Many clients are kept as one record
 * (often imported from Buildertrend) with no people under it, and a login
 * links to a person. Uses the record's active person with the requester's or
 * the record's email when there is one; otherwise adds that person to the
 * record from its own name, email and phone, the same directory person the
 * Contacts page would add. Never touches job contacts.
 */
async function clientPersonForRecord(
  db: Db,
  organizationId: string,
  customerId: string,
  requester: { readonly name: string; readonly email: string },
  now: string,
): Promise<LinkedPerson | undefined> {
  const requesterEmail = requester.email
  const record = await db
    .select({ id: customers.id, name: customers.name, email: customers.email, phone: customers.phone })
    .from(customers)
    .where(and(
      eq(customers.id, customerId),
      eq(customers.organizationId, organizationId),
      isNull(customers.mergedIntoCustomerId),
    ))
    .get()
  if (!record) return undefined
  const emails = new Set([plainEmail(requesterEmail), plainEmail(record.email)].filter((email): email is string => email !== null))
  const people = await db
    .select({ id: customerContacts.id, userId: customerContacts.userId, email: customerContacts.email })
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, record.id), eq(customerContacts.active, true), isNull(customerContacts.mergedIntoPersonId)))
  const same = people.find((person) => {
    const email = plainEmail(person.email)
    return email !== null && emails.has(email)
  })
  if (same) return { id: same.id, userId: same.userId }
  const id = crypto.randomUUID()
  await insertCustomerPerson(db, {
    id,
    customerId: record.id,
    // The record is this person when it carries their email; otherwise it's their company.
    name: plainEmail(record.email) === plainEmail(requesterEmail) ? record.name : requester.name,
    email: plainEmail(requesterEmail) ?? plainEmail(record.email),
    phone: record.phone,
    isPrimary: people.length === 0,
    createdAt: now,
    updatedAt: now,
  })
  return { id, userId: null }
}

/**
 * A vendor company picked directly: its active person with the requester's
 * email, or the requester added to it as a new person. Never touches job
 * contacts.
 */
async function vendorPersonForCompany(
  db: Db,
  organizationId: string,
  vendorId: string,
  requester: { readonly name: string; readonly email: string; readonly phone: string | null },
  now: string,
): Promise<LinkedPerson | undefined> {
  const company = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"), isNull(vendors.mergedIntoVendorId)))
    .get()
  if (!company) return undefined
  const email = plainEmail(requester.email)
  const people = await db
    .select({ id: vendorContacts.id, userId: vendorContacts.userId, email: vendorContacts.email })
    .from(vendorContacts)
    .where(and(eq(vendorContacts.vendorId, company.id), eq(vendorContacts.active, true), isNull(vendorContacts.mergedIntoPersonId)))
  const same = people.find((person) => email !== null && plainEmail(person.email) === email)
  if (same) return { id: same.id, userId: same.userId }
  const id = crypto.randomUUID()
  await insertVendorPersonStatement(db, {
    id, vendorId: company.id, name: requester.name, email, phone: requester.phone,
    isPrimary: people.length === 0, createdAt: now, updatedAt: now,
  })
  return { id, userId: null }
}

/**
 * Nobody in the directory matched, so the admin approves the request as a
 * new client or vendor: the directory record is made from what the person
 * entered, then they are its person. An admin chose this; nothing is created
 * without that click.
 */
async function newDirectoryPerson(
  db: Db,
  organizationId: string,
  kind: "client" | "vendor",
  requester: { readonly name: string; readonly email: string; readonly phone: string | null; readonly companyName: string | null; readonly vendorRole: string | null },
  now: string,
): Promise<LinkedPerson | undefined> {
  const id = crypto.randomUUID()
  if (kind === "client") {
    await insertCustomer(db, {
      id, organizationId, name: requester.name, email: plainEmail(requester.email), phone: requester.phone,
      company: requester.companyName, relationshipType: "client", createdAt: now, updatedAt: now,
    })
    return clientPersonForRecord(db, organizationId, id, requester, now)
  }
  await insertVendor(db, {
    id, organizationId, name: requester.companyName?.trim() || requester.name,
    category: isSupplierRole(requester.vendorRole) ? "Supplier" : "Subcontractor",
    email: plainEmail(requester.email), phone: requester.phone, createdAt: now, updatedAt: now,
  })
  return vendorPersonForCompany(db, organizationId, id, requester, now)
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
function plainEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const wrapped = value.match(/<([^<>]+)>/)
  const email = (wrapped ? wrapped[1] : value).trim().toLowerCase()
  return email.includes("@") ? email : null
}

/**
 * Every active job contact for this directory person, with what the grant
 * needs. For a client this also includes owner job contacts that name no
 * directory person yet but sit under a client record (merged or not) whose
 * email is the requester's own sign-in email. The job contact's email is the
 * one Compass shows (resolved from that record); the copy saved on the job
 * contact is history and never matched. Read-only: no job contact or
 * directory row is changed to make the match.
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
  // The job contact's email is its directory record's (resolved), never the
  // copy saved on the job contact when it was added.
  const unpersoned = await withContactDirectory(db
    .select({ ...jobColumns, contactEmail: resolvedContactColumns.email, customerEmail: customers.email })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .innerJoin(customers, eq(customers.id, projectContacts.customerId))
    .where(and(
      base,
      isNull(projectContacts.customerContactId),
      eq(customers.organizationId, organizationId),
      or(sql`lower(${resolvedContactColumns.email}) LIKE ${like}`, sql`lower(${customers.email}) LIKE ${like}`),
    )).$dynamic(), organizationId)
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

type ApprovalChoice = z.output<typeof approveAccessRequestSchema>
type Requester = {
  readonly name: string; readonly email: string; readonly phone: string | null
  readonly companyName: string | null; readonly vendorRole: string | null
}

/** The admin's pick, as a directory id with no prefix. */
function pickedId(choice: ApprovalChoice): string {
  return choice.kind === "client" ? choice.customerContactId : choice.kind === "vendor" ? choice.vendorContactId : ""
}

/**
 * Checks the admin's pick before the request is claimed, without writing:
 * a picked person must be live and not another login's; a picked client
 * record or vendor company must be live. Returns an error, or null.
 */
async function checkPick(db: Db, organizationId: string, choice: ApprovalChoice, requester: PickRequester): Promise<string | null> {
  if (choice.kind === "employee") return null
  const picked = pickedId(choice)
  if (picked === NEW_DIRECTORY_RECORD_OPTION) {
    // A retry reuses the record its failed attempt made (resolvePerson).
    if (await earlierAttemptPerson(db, organizationId, choice.kind, requester)) return null
    const same = await directoryPersonWithEmail(db, organizationId, choice.kind, requester.email)
    return same
      ? `${same.label} is already in your ${choice.kind === "client" ? "clients" : "vendors"} with this email. Pick them instead of adding a new ${choice.kind}.`
      : null
  }
  const notFound = "That directory contact wasn't found or is inactive."
  if (choice.kind === "client" && picked.startsWith(CLIENT_RECORD_OPTION_PREFIX)) {
    const record = await db.select({ id: customers.id }).from(customers).where(and(
      eq(customers.id, picked.slice(CLIENT_RECORD_OPTION_PREFIX.length)),
      eq(customers.organizationId, organizationId),
      isNull(customers.mergedIntoCustomerId),
    )).get()
    return record ? null : notFound
  }
  if (choice.kind === "vendor" && picked.startsWith(VENDOR_COMPANY_OPTION_PREFIX)) {
    const company = await db.select({ id: vendors.id }).from(vendors).where(and(
      eq(vendors.id, picked.slice(VENDOR_COMPANY_OPTION_PREFIX.length)),
      eq(vendors.organizationId, organizationId),
      eq(vendors.directoryStatus, "active"),
      isNull(vendors.mergedIntoVendorId),
    )).get()
    return company ? null : notFound
  }
  const person = choice.kind === "client" ? await clientPerson(db, organizationId, picked) : await vendorPerson(db, organizationId, picked)
  if (!person) return notFound
  return person.userId && person.userId !== requester.userId ? LINKED_ELSEWHERE : null
}

/** Who asked, and the directory person an earlier failed attempt at this approval created, if any. */
type PickRequester = {
  readonly userId: string
  readonly email: string
  readonly customerContactId: string | null
  readonly vendorContactId: string | null
}

/** The person a failed earlier "new" approval of this request added, if still live. */
async function earlierAttemptPerson(db: Db, organizationId: string, kind: "client" | "vendor", requester: PickRequester): Promise<LinkedPerson | undefined> {
  const earlier = kind === "client" ? requester.customerContactId : requester.vendorContactId
  if (!earlier) return undefined
  return kind === "client" ? clientPerson(db, organizationId, earlier) : vendorPerson(db, organizationId, earlier)
}

const LINKED_ELSEWHERE = "That directory contact is already linked to a different Compass login."

/** The directory person an approval links, adding one when the admin picked a record, a company or "new". */
async function resolvePerson(
  db: Db,
  organizationId: string,
  choice: Exclude<ApprovalChoice, { readonly kind: "employee" }>,
  requester: Requester,
  attempt: { readonly requestId: string; readonly pick: PickRequester },
  now: string,
): Promise<LinkedPerson | undefined> {
  const picked = pickedId(choice)
  if (picked === NEW_DIRECTORY_RECORD_OPTION) {
    const earlier = await earlierAttemptPerson(db, organizationId, choice.kind, attempt.pick)
    if (earlier) return earlier
    const made = await newDirectoryPerson(db, organizationId, choice.kind, requester, now)
    // Saved before granting, so a retry after a failed grant finds it.
    if (made) await rememberAccessRequestPerson(db, attempt.requestId, { kind: choice.kind, personId: made.id, now })
    return made
  }
  if (choice.kind === "client") {
    return picked.startsWith(CLIENT_RECORD_OPTION_PREFIX)
      ? clientPersonForRecord(db, organizationId, picked.slice(CLIENT_RECORD_OPTION_PREFIX.length), requester, now)
      : clientPerson(db, organizationId, picked)
  }
  return picked.startsWith(VENDOR_COMPANY_OPTION_PREFIX)
    ? vendorPersonForCompany(db, organizationId, picked.slice(VENDOR_COMPANY_OPTION_PREFIX.length), requester, now)
    : vendorPerson(db, organizationId, picked)
}

/**
 * Approves a pending request.
 *
 * Order matters (issue #1329): everything is checked read-only first, then
 * the request is claimed (pending -> approved, compare-and-set), and only the
 * admin who won the claim writes anything. So two admins approving at once,
 * or an approval racing a decline or the person's withdrawal, end with one
 * outcome, one set of grants and one email, and the loser never adds
 * directory records or access. Claiming before granting (rather than
 * granting, then claiming) means a request that ended declined or withdrawn
 * never gave anyone access.
 *
 * If granting fails after the claim, the request goes back to pending and
 * the admin can try again; each grant step is idempotent, so a retry
 * finishes the job.
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
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, request.userId)))
    .get()
  // Never change a staff member's role from a request.
  if (existing && isInternalStaffRole(existing.role)) return fail("This person is already on your staff in Compass.")
  if (existing && choice.kind === "employee") return fail("This person already has access. Change their role in People.")
  const pick: PickRequester = {
    userId: request.userId, email: found.requesterEmail,
    customerContactId: request.customerContactId, vendorContactId: request.vendorContactId,
  }
  const pickProblem = await checkPick(db, organizationId, choice, pick)
  if (pickProblem) return fail(pickProblem)

  const role = approvedOrganizationRole(choice)
  const claimed = await markAccessRequestApproved(db, request.id, { decidedBy: actor.id, grantedRole: role, now })
  if (!claimed) return fail("This request was already decided.")

  const requester: Requester = {
    name: found.requesterName, email: found.requesterEmail, phone: request.phone,
    companyName: request.companyName, vendorRole: choice.kind === "vendor" ? choice.role : null,
  }
  let granted: Result<{ readonly opened: readonly string[]; readonly skipped: readonly string[] }>
  try {
    granted = await grantApprovedRequest(db, database, actor, { organizationId, requestId: request.id, userId: request.userId, choice, role, requester, pick, now })
  } catch (error) {
    await reopenAfterFailedGrant(db, request.id)
    throw error
  }
  if (!granted.success) {
    await reopenAfterFailedGrant(db, request.id)
    return granted
  }
  const { opened, skipped } = granted.data

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

async function reopenAfterFailedGrant(db: Db, requestId: string): Promise<void> {
  const reopened = await reopenAccessRequest(db, requestId, new Date().toISOString())
  if (!reopened) console.error("[access-requests] approval failed and could not reopen; a newer request is pending", requestId)
}

/** The claimed approval's writes: the directory person, membership, the link, then each job. Runs only for the admin who won the claim. */
async function grantApprovedRequest(
  db: Db,
  database: D1Database,
  actor: AccessRequestActor,
  input: {
    readonly organizationId: string; readonly requestId: string; readonly userId: string
    readonly choice: ApprovalChoice; readonly role: UserRole; readonly requester: Requester; readonly pick: PickRequester; readonly now: string
  },
): Promise<Result<{ readonly opened: readonly string[]; readonly skipped: readonly string[] }>> {
  const { organizationId, choice, role, now } = input
  const opened: string[] = []
  const skipped: string[] = []
  if (choice.kind === "employee") {
    await insertOrganizationMember(db, { id: crypto.randomUUID(), organizationId, userId: input.userId, role, joinedAt: now })
    await recordAccessRequestGrant(db, input.requestId, { customerContactId: null, vendorContactId: null, projectCount: 0, now })
    return { success: true, data: { opened, skipped } }
  }

  const person = await resolvePerson(db, organizationId, choice, input.requester, { requestId: input.requestId, pick: input.pick }, now)
  if (!person) return fail("That directory contact wasn't found or is inactive.")
  if (person.userId && person.userId !== input.userId) return fail(LINKED_ELSEWHERE)
  // The membership comes first: the directory link requires the login to be
  // a client or vendor member of the company (a database trigger).
  await ensureExternalOrganizationMembership(db, { organizationId, userId: input.userId, role, now })
  if (person.userId !== input.userId) {
    // The same compare-and-set link (with its audit row) the Contacts page uses.
    const results = await database.batch(contactAccountLinkStatements(database, {
      kind: choice.kind === "client" ? "client_person" : "vendor_person",
      organizationId,
      personId: person.id,
      previousUserId: person.userId,
      nextUserId: input.userId,
      changedByUserId: actor.id,
      now,
    }))
    if (results[0]?.meta.changes !== 1) return fail("The directory contact changed while you were approving. Reload and try again.")
  }

  const email = input.requester.email.trim().toLowerCase()
  const jobs = await personJobs(db, organizationId, choice.kind, person.id, input.requester.email)
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
    const granted = await grantProjectContactAccess(db, {
      organizationId,
      projectId: job.projectId,
      projectContactId: job.contactId,
      email,
      role: projectRole,
      activeUserId: input.userId,
      workosInvitationId: null,
      workosExpiresAt: null,
      invitedBy: actor.id,
      now,
    })
    // Staff took the contact off this job while the request was approved.
    if (!granted) {
      skipped.push(label)
      continue
    }
    await recordActivityEvent({
      db,
      organizationId,
      projectId: job.projectId,
      actor,
      category: "access",
      action: "project.access_granted",
      entityType: "project_access_invitation",
      entityId: job.contactId,
      summary: `Granted ${input.requester.name} access to ${label} by approving their access request.`,
      createdAt: now,
    })
    opened.push(label)
  }
  await recordAccessRequestGrant(db, input.requestId, {
    customerContactId: choice.kind === "client" ? person.id : null,
    vendorContactId: choice.kind === "vendor" ? person.id : null,
    projectCount: opened.length,
    now,
  })
  return { success: true, data: { opened, skipped } }
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
  const changed = await closeAccessRequest(db, requestId, "decline", { decidedBy: actor.id, now })
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

