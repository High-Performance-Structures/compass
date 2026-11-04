"use server"

import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { customerContacts, customers, vendorContacts, vendors } from "@/db/schema"
import { sageContactChangeProposals } from "@/db/schema-sage"
import { isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requireOrg } from "@/lib/org-scope"
import { sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"
import {
  sageContactExtendedFields,
  type SageContactFieldChange,
  type SageContactKind,
} from "@/lib/sage/contact-change-proposal"
import {
  isRecentSageRead,
  latestSageSnapshot,
  parseSageChanges,
  requestSageEditFromCompass,
  sageSnapshotFromRow,
  type SageEditRequestOutcome,
  type SageProposalContext,
} from "@/lib/sage/contact-proposal-service"
import { HOLDING_SAGE_CHANGE_STATUSES, holdingSageChange } from "@/lib/sage/sage-held-fields"
import { SAGE_SHARED_FIELDS, sageSharedChanges, type SageLinkedEditKind } from "@/lib/sage/sage-linked-edit-fields"
import { vendorCategoryFromSage } from "@/lib/sage/vendor-category-lock"
import { requireUserContext, type Db } from "@/lib/server/action-context"

/**
 * Inline editing of Sage-linked clients and vendors: every field shows its
 * new value in Compass at once. Sage-shared fields also become one reviewed
 * Sage change request per record (see sage-linked-edit-fields.ts), and Sage
 * → Compass syncs leave those fields alone until the request is finished
 * (sage-held-fields.ts).
 */

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type SagePendingChange = {
  readonly proposalId: string
  /** pending, approved or running; conflict or failed when the write needs a retry or a rejection. */
  readonly status: string
  readonly changes: readonly SageContactFieldChange[]
  /** Why the Sage write failed or did not read back, for conflict and failed. */
  readonly error: string | null
}

export type SageLinkedEditState = {
  /** The company carries a reviewed Sage record id (not only a number). */
  readonly verified: boolean
  /** Sage contact sync is set up for this organization. */
  readonly bridgeConfigured: boolean
  /** The company's last Sage read is recent enough to request a change. */
  readonly fresh: boolean
  /** Sage-shared fields the Sage writer has not sent yet (writer update pending). */
  readonly unavailableFields: readonly string[]
  /** Unfinished change requests by record id: the company and its Sage people. */
  readonly pending: Readonly<Record<string, SagePendingChange>>
  /** Vendors only: Sage's vendor type when it sets the Compass category. */
  readonly categoryFromSageType: string | null
}

export type SageEditOutcomeItem = {
  readonly label: string
  readonly outcome: SageEditRequestOutcome
}

export type SageLinkedSaveResult = Result<{ readonly sage: readonly SageEditOutcomeItem[] }>

const companyKindSchema = z.enum(["client_company", "vendor_company"])
const textValues = z.record(z.string(), z.string().nullable())

async function pendingFor(
  db: Db,
  organizationId: string,
  records: readonly { readonly kind: SageContactKind; readonly id: string }[]
): Promise<Record<string, SagePendingChange>> {
  const ids = records.map((record) => record.id)
  if (ids.length === 0) return {}
  const rows = await db.select({
    id: sageContactChangeProposals.id,
    kind: sageContactChangeProposals.kind,
    entityId: sageContactChangeProposals.entityId,
    status: sageContactChangeProposals.status,
    changesJson: sageContactChangeProposals.changesJson,
    errorMessage: sageContactChangeProposals.errorMessage,
  }).from(sageContactChangeProposals).where(and(
    eq(sageContactChangeProposals.organizationId, organizationId),
    inArray(sageContactChangeProposals.entityId, ids),
    inArray(sageContactChangeProposals.status, [...HOLDING_SAGE_CHANGE_STATUSES])
  )).orderBy(asc(sageContactChangeProposals.requestedAt))
  const pending: Record<string, SagePendingChange> = {}
  // Oldest first, so the latest request is the one shown.
  for (const row of rows) {
    if (!records.some((record) => record.id === row.entityId && record.kind === row.kind)) continue
    pending[row.entityId] = {
      proposalId: row.id, status: row.status, changes: parseSageChanges(row.changesJson) ?? [],
      error: row.status === "conflict" || row.status === "failed" ? row.errorMessage ?? "The Sage write did not finish." : null,
    }
  }
  return pending
}

/** What the inline form needs to show pending Sage values and locked fields. */
export async function getSageLinkedEditState(kindInput: string, entityId: string): Promise<Result<SageLinkedEditState>> {
  try {
    const kind = companyKindSchema.safeParse(kindInput)
    if (!kind.success || !entityId.trim()) return { success: false, error: "Invalid record" }
    const { user, db, env } = await requireUserContext()
    const organizationId = requireOrg(user)
    await requireFeaturePermission(user, kind.data === "client_company" ? "customers" : "vendors", "read")
    const records: { kind: SageContactKind; id: string }[] = [{ kind: kind.data, id: entityId }]
    let verified = false
    let categoryFromSageType: string | null = null
    if (kind.data === "vendor_company") {
      const vendor = await db.select().from(vendors)
        .where(and(eq(vendors.id, entityId), eq(vendors.organizationId, organizationId))).get()
      if (!vendor) return { success: false, error: "Vendor not found" }
      verified = Boolean(vendor.sageVendorId)
      categoryFromSageType = await vendorCategoryFromSage(db, organizationId, vendor)
      const people = await db.select({ id: vendorContacts.id }).from(vendorContacts).where(and(
        eq(vendorContacts.vendorId, entityId), eq(vendorContacts.active, true), isNotNull(vendorContacts.sageContactId)))
      records.push(...people.map((person) => ({ kind: "vendor_person" as const, id: person.id })))
    } else {
      const customer = await db.select({ sageClientId: customers.sageClientId }).from(customers)
        .where(and(eq(customers.id, entityId), eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId))).get()
      if (!customer) return { success: false, error: "Client not found" }
      verified = Boolean(customer.sageClientId)
      const people = await db.select({ id: customerContacts.id }).from(customerContacts).where(and(
        eq(customerContacts.customerId, entityId), eq(customerContacts.active, true), isNotNull(customerContacts.sageContactId)))
      records.push(...people.map((person) => ({ kind: "client_person" as const, id: person.id })))
    }
    const snapshotRow = await latestSageSnapshot(db, organizationId, kind.data, entityId)
    const snapshot = snapshotRow ? sageSnapshotFromRow(snapshotRow) : null
    const unavailableFields = snapshot
      ? sageContactExtendedFields(kind.data).filter((field) => !Object.prototype.hasOwnProperty.call(snapshot.fields, field))
      : []
    return {
      success: true,
      data: {
        verified,
        bridgeConfigured: sageContactOrganizationMatches(env, organizationId),
        fresh: Boolean(snapshotRow && isRecentSageRead(snapshotRow.capturedAt)),
        unavailableFields,
        pending: await pendingFor(db, organizationId, records),
        categoryFromSageType,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not load Sage edit state" }
  }
}

async function proposalContext(): Promise<SageProposalContext> {
  const { user, db, env } = await requireUserContext()
  return { user, organizationId: requireOrg(user), db, env }
}

async function requestIfChanged(
  context: SageProposalContext,
  kind: SageLinkedEditKind,
  entityId: string,
  label: string,
  current: Readonly<Record<string, unknown>>,
  submitted: Readonly<Record<string, unknown>>
): Promise<SageEditOutcomeItem | null> {
  const changes = sageSharedChanges(kind, current, submitted)
  if (Object.keys(changes).length === 0) return null
  return { label, outcome: await requestSageEditFromCompass(context, kind, entityId, changes) }
}

const vendorRequestSchema = z.object({
  sage: textValues,
  contacts: z.array(z.object({
    id: z.string().nullable(),
    name: z.string(),
    title: z.string(),
    email: z.string(),
    phone: z.string(),
  })),
})

/**
 * The Sage half of saving a Sage-linked vendor's inline form, after the form
 * has saved its Compass-only fields with updateVendor: changes to the
 * company's Sage fields and to each Sage person become Sage change requests.
 * Compass shows the new values at once; Sage catches up after approval.
 */
export async function requestSageLinkedVendorChanges(vendorId: string, input: unknown): Promise<SageLinkedSaveResult> {
  try {
    const parsed = vendorRequestSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: "Invalid vendor details" }
    const context = await proposalContext()
    if (isDemoUser(context.user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(context.user, "vendors", "update")
    const { db, organizationId } = context
    const vendor = await db.select().from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId))).get()
    if (!vendor) return { success: false, error: "Vendor not found" }
    if (!vendor.sageVendorId && !vendor.sageVendorNumber) {
      return { success: false, error: "This vendor is not linked to Sage." }
    }
    const people = await db.select().from(vendorContacts).where(and(
      eq(vendorContacts.vendorId, vendorId), eq(vendorContacts.active, true), isNotNull(vendorContacts.sageContactId)))
    const sagePeople = new Map(people.map((person) => [person.id, person]))
    const sage: SageEditOutcomeItem[] = []
    const company = await requestIfChanged(context, "vendor_company", vendorId, vendor.name, vendor, parsed.data.sage)
    if (company) sage.push(company)
    for (const contact of parsed.data.contacts) {
      const person = contact.id ? sagePeople.get(contact.id) : undefined
      if (!person) continue
      const item = await requestIfChanged(context, "vendor_person", person.id, person.name, person, contact)
      if (item) sage.push(item)
    }
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { sage } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not request Sage changes" }
  }
}

const customerRequestSchema = z.object({ sage: textValues })

/** The Sage half of saving a Sage-linked client (see requestSageLinkedVendorChanges). */
export async function requestSageLinkedCustomerChanges(customerId: string, input: unknown): Promise<SageLinkedSaveResult> {
  try {
    const parsed = customerRequestSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: "Invalid client details" }
    const context = await proposalContext()
    if (isDemoUser(context.user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(context.user, "customers", "update")
    const { db, organizationId } = context
    const customer = await db.select().from(customers).where(and(
      eq(customers.id, customerId), eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId))).get()
    if (!customer) return { success: false, error: "Client not found" }
    if (!customer.sageClientId && !customer.sageClientNumber) {
      return { success: false, error: "This client is not linked to Sage." }
    }
    const item = await requestIfChanged(context, "client_company", customerId, customer.name, customer, parsed.data.sage)
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { sage: item ? [item] : [] } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not request Sage changes" }
  }
}

const personSaveSchema = z.object({
  name: z.string(),
  title: z.string(),
  email: z.string(),
  phone: z.string(),
})

/** A Sage person at a client: every edited field is Sage-shared, so it becomes a change request. */
export async function saveSageLinkedCustomerPerson(personId: string, input: unknown): Promise<SageLinkedSaveResult> {
  try {
    const parsed = personSaveSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: "Invalid contact details" }
    const context = await proposalContext()
    if (isDemoUser(context.user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const { db, organizationId } = context
    const person = await db.select({
      id: customerContacts.id, name: customerContacts.name, title: customerContacts.title,
      email: customerContacts.email, phone: customerContacts.phone, sageContactId: customerContacts.sageContactId,
    }).from(customerContacts).innerJoin(customers, eq(customerContacts.customerId, customers.id)).where(and(
      eq(customerContacts.id, personId), eq(customers.organizationId, organizationId), eq(customerContacts.active, true))).get()
    if (!person) return { success: false, error: "Client contact not found" }
    if (!person.sageContactId) return { success: false, error: "This person is not linked to Sage." }
    const item = await requestIfChanged(context, "client_person", person.id, person.name, person, parsed.data)
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { sage: item ? [item] : [] } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not save contact" }
  }
}

const linkedKindSchema = z.enum(["client_company", "vendor_company", "client_person", "vendor_person"])

/** Compass's current Sage-shared values of one record, or null when it is not in the organization. */
async function compassSageValues(
  db: Db,
  organizationId: string,
  kind: SageLinkedEditKind,
  entityId: string
): Promise<Readonly<Record<string, unknown>> | null> {
  if (kind === "vendor_company") {
    return await db.select().from(vendors)
      .where(and(eq(vendors.id, entityId), eq(vendors.organizationId, organizationId))).get() ?? null
  }
  if (kind === "client_company") {
    return await db.select().from(customers)
      .where(and(eq(customers.id, entityId), eq(customers.organizationId, organizationId))).get() ?? null
  }
  if (kind === "vendor_person") {
    const row = await db.select({ person: vendorContacts }).from(vendorContacts)
      .innerJoin(vendors, eq(vendorContacts.vendorId, vendors.id))
      .where(and(eq(vendorContacts.id, entityId), eq(vendors.organizationId, organizationId))).get()
    return row?.person ?? null
  }
  const row = await db.select({ person: customerContacts }).from(customerContacts)
    .innerJoin(customers, eq(customerContacts.customerId, customers.id))
    .where(and(eq(customerContacts.id, entityId), eq(customers.organizationId, organizationId))).get()
  return row?.person ?? null
}

/**
 * Sends a Sage change that failed or did not read back again, asking Sage
 * for the values Compass shows now. Needs a fresh approval like any request.
 */
export async function retrySageLinkedChange(kindInput: string, entityId: string): Promise<SageLinkedSaveResult> {
  try {
    const kind = linkedKindSchema.safeParse(kindInput)
    if (!kind.success || !entityId.trim()) return { success: false, error: "Invalid record" }
    const context = await proposalContext()
    if (isDemoUser(context.user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(context.user, kind.data.startsWith("client") ? "customers" : "vendors", "update")
    const { db, organizationId } = context
    const stalled = await holdingSageChange(db, organizationId, kind.data, entityId)
    if (!stalled || (stalled.status !== "conflict" && stalled.status !== "failed")) {
      return { success: false, error: "There is no failed Sage change to retry for this record." }
    }
    const current = await compassSageValues(db, organizationId, kind.data, entityId)
    if (!current) return { success: false, error: "Record not found" }
    const fields = (parseSageChanges(stalled.changesJson) ?? []).map((change) => change.field)
      .filter((field) => SAGE_SHARED_FIELDS[kind.data].includes(field))
    const values: Record<string, string | null> = {}
    for (const field of fields) {
      const value = current[field]
      values[field] = typeof value === "string" ? value : null
    }
    const name = typeof current.name === "string" ? current.name : "Record"
    const outcome = await requestSageEditFromCompass(context, kind.data, entityId, values)
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { sage: [{ label: name, outcome }] } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not retry the Sage change" }
  }
}
