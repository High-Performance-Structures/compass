import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"

import { internalContacts, organizationMembers, users } from "@/db/schema"
import { sageBridgeStatus, sageEmployeeDirectoryEntries } from "@/db/schema-sage"
import { recordActivityEvents, type ActivityActor } from "@/lib/activity-log"
import {
  internalContactIdForUser,
  planSageEmployeeLinks,
  planSageEmployeeStatus,
  sageEmployeeIsCurrent,
  sageEmployeeName,
  staffContactIsLinked,
  type SageEmployeeLink,
  type SageEmployeeRecord,
  type SageEmployeeStatusChange,
  type StaffContactRecord,
  type StaffNeedingSageLink,
  type StaffUserRecord,
} from "@/lib/domain/contacts/sage-employee-rules"
import {
  insertLinkedInternalContactStatement,
  linkInternalContactToSageEmployeeStatement,
  setInternalContactActiveFromSageStatement,
} from "@/lib/domain/contacts/store"
import { insertSageContactLinkEvent, insertSageContactReadRequest } from "@/lib/domain/sage-bridge/contact-store"
import { replaceSageEmployeeDirectory, sageBridgeHeartbeatStatement, type SageEmployeeDirectoryRow } from "@/lib/domain/sage-bridge/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Ties staff to their Sage employee record. The private, read-only Sage
 * employee reader asks every few minutes whether a read is due (an hour since
 * the last one, or someone pressed "Read Sage employees now" in Sage contact
 * review), reads dbo.employ when it is, and posts the whole list. Compass
 * stores it, links unlinked staff by email (sage-employee-rules.ts), and sets
 * each linked staff contact active or inactive to match Sage. Both steps
 * follow the company's Sage contact review settings. Nothing is written to
 * Sage, and a Compass user or membership is never changed: only the internal
 * contact's active flag, which is what automatic field app access reads.
 */

const SAGE_EMPLOYEE_SYNC_INTERVAL_MS = 60 * 60 * 1000
const READER_STALE_MS = 30 * 60 * 1000
const SAGE_ACTOR: ActivityActor = { id: null, email: "sage", displayName: "Sage employee list", firstName: null, lastName: null, role: "system" }

export type SageEmployeeSyncState = {
  readonly lastSyncedAt: string | null
  readonly refreshRequestedAt: string | null
  readonly readerLastSeenAt: string | null
}

export async function loadSageEmployeeSyncState(db: Db): Promise<SageEmployeeSyncState> {
  const rows = await db
    .select({ id: sageBridgeStatus.id, lastSeenAt: sageBridgeStatus.lastSeenAt })
    .from(sageBridgeStatus)
    .where(inArray(sageBridgeStatus.id, ["employee-sync", "employee-refresh-request", "employee-reader"]))
  const at = (id: string): string | null => rows.find((row) => row.id === id)?.lastSeenAt ?? null
  return { lastSyncedAt: at("employee-sync"), refreshRequestedAt: at("employee-refresh-request"), readerLastSeenAt: at("employee-reader") }
}

/** Whether the reader should read Sage's employees now, and why. */
export function sageEmployeeSyncDue(state: SageEmployeeSyncState, now: Date): { readonly due: boolean; readonly reason: string } {
  if (!state.lastSyncedAt) return { due: true, reason: "never_synced" }
  if (state.refreshRequestedAt && state.refreshRequestedAt > state.lastSyncedAt) return { due: true, reason: "refresh_requested" }
  const age = now.getTime() - Date.parse(state.lastSyncedAt)
  if (!Number.isFinite(age) || age >= SAGE_EMPLOYEE_SYNC_INTERVAL_MS) return { due: true, reason: "interval" }
  return { due: false, reason: "up_to_date" }
}

export function sageEmployeeReaderRunning(state: SageEmployeeSyncState, now: Date): boolean {
  const seen = state.readerLastSeenAt ? Date.parse(state.readerLastSeenAt) : Number.NaN
  return Number.isFinite(seen) && now.getTime() - seen <= READER_STALE_MS
}

/** Asks the reader to read Sage's employees on its next check (within a few minutes). */
export async function requestSageEmployeeRefresh(database: D1Database, now: string): Promise<void> {
  await sageBridgeHeartbeatStatement(database, "employee-refresh-request", now).run()
}

/** The company's stored copy of Sage's employees. */
async function loadSageEmployees(db: Db, organizationId: string): Promise<readonly SageEmployeeRecord[]> {
  return db
    .select({
      sageRecordId: sageEmployeeDirectoryEntries.sageRecordId,
      sageEmployeeNumber: sageEmployeeDirectoryEntries.sageEmployeeNumber,
      firstName: sageEmployeeDirectoryEntries.firstName,
      lastName: sageEmployeeDirectoryEntries.lastName,
      email: sageEmployeeDirectoryEntries.email,
      sageStatusCode: sageEmployeeDirectoryEntries.sageStatusCode,
      inactive: sageEmployeeDirectoryEntries.inactive,
    })
    .from(sageEmployeeDirectoryEntries)
    .where(eq(sageEmployeeDirectoryEntries.organizationId, organizationId))
}

/** Every internal contact of the company, and the active staff logins that have none. */
async function loadStaffDirectory(db: Db, organizationId: string): Promise<{
  readonly contacts: readonly StaffContactRecord[]
  readonly usersWithoutContact: readonly StaffUserRecord[]
}> {
  const [contacts, members] = await Promise.all([
    db
      .select({
        internalContactId: internalContacts.id,
        userId: internalContacts.userId,
        name: internalContacts.name,
        email: internalContacts.email,
        userEmail: users.email,
        active: internalContacts.active,
        sageEmployeeId: internalContacts.sageEmployeeId,
        sageEmployeeNumber: internalContacts.sageEmployeeNumber,
      })
      .from(internalContacts)
      .leftJoin(users, eq(users.id, internalContacts.userId))
      .where(eq(internalContacts.organizationId, organizationId)),
    db
      .select({
        userId: users.id,
        role: organizationMembers.role,
        email: users.email,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(
        eq(organizationMembers.organizationId, organizationId),
        eq(users.isActive, true),
        sql`NOT EXISTS (SELECT 1 FROM internal_contacts ic WHERE ic.organization_id = ${organizationId} AND ic.user_id = ${users.id})`,
      )),
  ])
  const usersWithoutContact = members
    .filter((member) => isInternalStaffRole(member.role))
    .map((member): StaffUserRecord => ({
      userId: member.userId,
      name: member.displayName?.trim() || [member.firstName, member.lastName].map((part) => part?.trim() ?? "").filter(Boolean).join(" ") || member.email,
      email: member.email,
      phone: member.phone,
    }))
  return { contacts, usersWithoutContact }
}

type SageEmployeeLinkMethod = "email" | "manual"

/**
 * Writes links: an existing contact gets the Sage ids, a staff login without
 * a contact gets one created already linked. Each link that lands is recorded
 * as a Sage link event, queues a Sage read of the employee's contact details,
 * and is logged to Activity. Returns the links that landed.
 */
async function writeSageEmployeeLinks(
  db: Db,
  organizationId: string,
  links: readonly SageEmployeeLink[],
  options: { readonly method: SageEmployeeLinkMethod; readonly actor: ActivityActor; readonly now: string }
): Promise<readonly SageEmployeeLink[]> {
  const { now } = options
  const statements = links.map((link) => link.target.kind === "contact"
    ? linkInternalContactToSageEmployeeStatement(db, {
      organizationId, internalContactId: link.target.internalContactId,
      sageEmployeeId: link.employee.sageRecordId, sageEmployeeNumber: link.employee.sageEmployeeNumber, now,
    })
    : insertLinkedInternalContactStatement(db, {
      id: internalContactIdForUser(organizationId, link.target.user.userId),
      organizationId,
      userId: link.target.user.userId,
      name: link.target.user.name,
      email: link.target.user.email.trim().toLowerCase(),
      phone: link.target.user.phone,
      sageEmployeeId: link.employee.sageRecordId,
      sageEmployeeNumber: link.employee.sageEmployeeNumber,
      sourceSystem: "compass_user",
      sourceRecordId: link.target.user.userId,
      active: true,
      syncStatus: "manual",
      createdAt: now,
      updatedAt: now,
    }))
  const [first, ...rest] = statements
  if (!first) return []
  const results = await db.batch([first, ...rest])
  const landed = links.flatMap((link, index) => {
    const id = results[index]?.[0]?.id
    return id ? [{ link, internalContactId: id }] : []
  })
  const audit = landed.flatMap(({ link, internalContactId }) => {
    const requestId = crypto.randomUUID()
    const base = {
      organizationId, kind: "employee", entityId: internalContactId,
      sageRecordId: link.employee.sageRecordId, sageRecordNumber: link.employee.sageEmployeeNumber,
      parentSageRecordId: null, requestedByUserId: options.actor.id, requestedAt: now,
    }
    return [
      // The decision itself, already complete: never claimed by the bridge.
      insertSageContactReadRequest(db, {
        ...base, id: requestId, purpose: "directory_match", status: "linked",
        reviewedByUserId: options.actor.id, reviewedAt: now, completedAt: now,
      }),
      insertSageContactLinkEvent(db, {
        id: crypto.randomUUID(), requestId, organizationId, actorUserId: options.actor.id, eventType: "linked",
        detailJson: JSON.stringify({ method: options.method, sageRecordId: link.employee.sageRecordId,
          sageRecordNumber: link.employee.sageEmployeeNumber, email: link.employee.email }),
        createdAt: now,
      }),
      // Same as a reviewed link: read the employee's email, phones and address from Sage.
      insertSageContactReadRequest(db, { ...base, id: crypto.randomUUID(), purpose: "refresh", status: "queued" }),
    ]
  })
  const [head, ...tail] = audit
  if (head) await db.batch([head, ...tail])
  await recordActivityEvents(db, landed.map(({ link, internalContactId }) => ({
    organizationId,
    actor: options.actor,
    category: "account",
    action: "internal_contact.sage_linked",
    entityType: "internal_contact",
    entityId: internalContactId,
    summary: `Linked ${link.target.kind === "contact" ? link.target.name : link.target.user.name} to Sage employee ${link.employee.sageEmployeeNumber}${options.method === "email" ? " (same email)" : ""}`,
    metadata: { method: options.method, sageEmployeeNumber: link.employee.sageEmployeeNumber, createdContact: link.target.kind === "user" },
    createdAt: now,
  })))
  return landed.map(({ link }) => link)
}

async function writeSageEmployeeStatus(
  db: Db,
  organizationId: string,
  changes: readonly SageEmployeeStatusChange[],
  now: string
): Promise<readonly SageEmployeeStatusChange[]> {
  const [first, ...rest] = changes.map((change) => setInternalContactActiveFromSageStatement(db, {
    organizationId, internalContactId: change.internalContactId, active: change.active, now,
  }))
  if (!first) return []
  const results = await db.batch([first, ...rest])
  const applied = changes.filter((_, index) => (results[index]?.length ?? 0) > 0)
  await recordActivityEvents(db, applied.map((change) => ({
    organizationId,
    actor: SAGE_ACTOR,
    category: "account",
    action: change.active ? "internal_contact.sage_reactivated" : "internal_contact.sage_deactivated",
    entityType: "internal_contact",
    entityId: change.internalContactId,
    summary: change.active
      ? `${change.name} is active again: Sage shows employee ${change.employee.sageEmployeeNumber} as current`
      : `${change.name} was made inactive: Sage shows employee ${change.employee.sageEmployeeNumber} as not current`,
    metadata: { sageEmployeeNumber: change.employee.sageEmployeeNumber, sageStatusCode: change.employee.sageStatusCode, sageInactive: change.employee.inactive },
    createdAt: now,
  })))
  return applied
}

export type SageEmployeeSyncSummary = {
  readonly employees: number
  readonly linked: number
  readonly needsLinking: number
  readonly deactivated: number
  readonly reactivated: number
}

/** Stores Sage's employee list, then links staff by email and follows status, as the company's settings allow. */
export async function applySageEmployeeDirectory(
  db: Db,
  database: D1Database,
  organizationId: string,
  rows: readonly SageEmployeeDirectoryRow[],
  now: string
): Promise<SageEmployeeSyncSummary> {
  await replaceSageEmployeeDirectory(db, organizationId, rows, now)
  await sageBridgeHeartbeatStatement(database, "employee-sync", now).run()
  const [settings, staff] = await Promise.all([
    readFeatureSettings(db, organizationId, "sage-contact-review"),
    loadStaffDirectory(db, organizationId),
  ])
  // Status first, from the contacts as they were: a new link is to a current employee, so it never changes status.
  const statusChanges = settings.employeeStatusFollowsSage ? planSageEmployeeStatus({ employees: rows, contacts: staff.contacts }) : []
  const applied = await writeSageEmployeeStatus(db, organizationId, statusChanges, now)
  const plan = planSageEmployeeLinks({ employees: rows, contacts: staff.contacts, usersWithoutContact: staff.usersWithoutContact })
  const linked = settings.autoLinkEmployeesByEmail
    ? await writeSageEmployeeLinks(db, organizationId, plan.links, { method: "email", actor: SAGE_ACTOR, now })
    : []
  return {
    employees: rows.length,
    linked: linked.length,
    needsLinking: plan.needsLinking.length + (settings.autoLinkEmployeesByEmail ? 0 : plan.links.length),
    deactivated: applied.filter((change) => !change.active).length,
    reactivated: applied.filter((change) => change.active).length,
  }
}

export type StaffSageLinkOverview = {
  readonly needsLinking: readonly StaffNeedingSageLink[]
  /** Email matches waiting because automatic linking is off. */
  readonly emailMatches: readonly SageEmployeeLink[]
  /** Current Sage employees not linked to anyone, for linking by hand. */
  readonly unlinkedEmployees: readonly { readonly sageRecordId: string; readonly sageEmployeeNumber: string; readonly name: string; readonly email: string | null }[]
}

/** Staff not linked to Sage and why, from the last stored Sage employee list. */
export async function staffSageLinkOverview(db: Db, organizationId: string): Promise<StaffSageLinkOverview> {
  const [employees, staff] = await Promise.all([loadSageEmployees(db, organizationId), loadStaffDirectory(db, organizationId)])
  const plan = planSageEmployeeLinks({ employees, contacts: staff.contacts, usersWithoutContact: staff.usersWithoutContact })
  const linkedIds = new Set(staff.contacts.map((contact) => contact.sageEmployeeId?.trim().toLowerCase()).filter(Boolean))
  const linkedNumbers = new Set(staff.contacts.map((contact) => contact.sageEmployeeNumber?.trim()).filter(Boolean))
  const unlinkedEmployees = employees
    .filter((employee) => sageEmployeeIsCurrent(employee) &&
      !linkedIds.has(employee.sageRecordId.toLowerCase()) && !linkedNumbers.has(employee.sageEmployeeNumber))
    .map((employee) => ({ sageRecordId: employee.sageRecordId, sageEmployeeNumber: employee.sageEmployeeNumber, name: sageEmployeeName(employee), email: employee.email }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return { needsLinking: plan.needsLinking, emailMatches: plan.links, unlinkedEmployees }
}

export type StaffSageLinkTarget =
  | { readonly kind: "contact"; readonly internalContactId: string }
  | { readonly kind: "user"; readonly userId: string }

/**
 * An admin links one unlinked staff member to a current Sage employee chosen
 * from the stored Sage list. Callers check permissions and revalidate.
 */
export async function linkStaffToSageEmployee(
  db: Db,
  organizationId: string,
  input: { readonly target: StaffSageLinkTarget; readonly sageRecordId: string },
  actor: ActivityActor,
  now: string
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  const [employees, staff] = await Promise.all([loadSageEmployees(db, organizationId), loadStaffDirectory(db, organizationId)])
  const wanted = input.sageRecordId.trim().toLowerCase()
  const employee = employees.find((entry) => entry.sageRecordId.toLowerCase() === wanted)
  if (!employee) return { success: false, error: "That Sage employee is not in the last Sage employee list." }
  if (!sageEmployeeIsCurrent(employee)) return { success: false, error: "That Sage employee is not current in Sage." }
  const taken = staff.contacts.some((contact) => contact.sageEmployeeId?.trim().toLowerCase() === wanted ||
    contact.sageEmployeeNumber?.trim() === employee.sageEmployeeNumber)
  if (taken) return { success: false, error: "That Sage employee is already linked to another contact." }
  let target: SageEmployeeLink["target"] | null = null
  if (input.target.kind === "contact") {
    const id = input.target.internalContactId
    const contact = staff.contacts.find((entry) => entry.internalContactId === id)
    if (!contact || !contact.active) return { success: false, error: "Staff contact was not found." }
    if (staffContactIsLinked(contact)) return { success: false, error: "This contact is already linked to Sage." }
    target = { kind: "contact", internalContactId: contact.internalContactId, name: contact.name }
  } else {
    const id = input.target.userId
    const user = staff.usersWithoutContact.find((entry) => entry.userId === id)
    if (!user) return { success: false, error: "Staff member was not found, or already has a contact." }
    target = { kind: "user", user }
  }
  const landed = await writeSageEmployeeLinks(db, organizationId, [{ target, employee }], { method: "manual", actor, now })
  return landed.length === 1 ? { success: true } : { success: false, error: "The contact or Sage employee changed meanwhile. Reload and try again." }
}
