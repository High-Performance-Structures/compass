"use server"

import { and, eq, inArray, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import {
  customerContacts,
  customers,
  projectContacts,
  vendorContacts,
  vendors,
} from "@/db/schema"
import {
  sageContactChangeProposals,
  sageContactCreateProposals,
  sageContactReadRequests,
  sageContactSnapshots,
  sageClientProjectWriteOperations,
} from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requirePermission } from "@/lib/permissions"
import { queueProjectContactTrackerRefresh } from "@/lib/project-contact-tracker-refresh"

const mergeKind = z.enum(["customer_company", "vendor_company", "customer_person", "vendor_person"])
type MergeKind = z.infer<typeof mergeKind>
const mergeInput = z.object({
  kind: mergeKind,
  sourceId: z.string().min(1).max(200),
  destinationId: z.string().min(1).max(200),
})
type MergeInput = z.infer<typeof mergeInput>

export type ContactMergePreview = {
  readonly kind: MergeKind
  readonly sourceName: string
  readonly destinationName: string
  readonly sourceEmail: string | null
  readonly destinationEmail: string | null
  readonly peopleCount: number
  readonly projectContactCount: number
  readonly retainedIdentityNotice: string | null
  readonly blockers: readonly string[]
}
type PreviewResult =
  | { readonly success: true; readonly preview: ContactMergePreview }
  | { readonly success: false; readonly error: string }
type MergeResult =
  | { readonly success: true; readonly keptId: string; readonly warning?: string }
  | { readonly success: false; readonly error: string }

function activeProposal(status: string): boolean {
  return ["queued", "running", "awaiting_review", "pending", "approved", "needs_reconciliation"].includes(status)
}

async function context(kind: MergeKind, mutation: boolean) {
  const user = await requireAuth()
  const orgId = requireOrg(user)
  if (isDemoUser(user.id) || isDemoOrg(orgId)) throw new Error("DEMO_READ_ONLY")
  const feature = kind.startsWith("customer") ? "customers" : "vendors"
  await requireFeaturePermission(user, feature, "read")
  if (mutation) {
    await requireFeaturePermission(user, feature, "update")
    await requireFeaturePermission(user, feature, "delete")
    requirePermission(user, kind.startsWith("customer") ? "customer" : "vendor", "delete")
  }
  const { env } = await getCloudflareContext()
  return { user, orgId, db: getDb(env.DB), d1: env.DB }
}

async function inspect(input: MergeInput): Promise<{
  readonly preview: ContactMergePreview
  readonly sourceSnapshot: string
  readonly destinationSnapshot: string
  readonly affectedProjectIds: readonly string[]
}> {
  const { orgId, db } = await context(input.kind, false)
  const blockers: string[] = []
  const company = input.kind.endsWith("company")
  const customer = input.kind.startsWith("customer")
  const source = company
    ? customer
      ? await db.select().from(customers).where(and(eq(customers.id, input.sourceId), eq(customers.organizationId, orgId))).get()
      : await db.select().from(vendors).where(and(eq(vendors.id, input.sourceId), eq(vendors.organizationId, orgId))).get()
    : customer
      ? await db.select({ person: customerContacts, company: customers }).from(customerContacts)
          .innerJoin(customers, eq(customers.id, customerContacts.customerId))
          .where(and(eq(customerContacts.id, input.sourceId), eq(customers.organizationId, orgId))).get()
      : await db.select({ person: vendorContacts, company: vendors }).from(vendorContacts)
          .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
          .where(and(eq(vendorContacts.id, input.sourceId), eq(vendors.organizationId, orgId))).get()
  const destination = company
    ? customer
      ? await db.select().from(customers).where(and(eq(customers.id, input.destinationId), eq(customers.organizationId, orgId))).get()
      : await db.select().from(vendors).where(and(eq(vendors.id, input.destinationId), eq(vendors.organizationId, orgId))).get()
    : customer
      ? await db.select({ person: customerContacts, company: customers }).from(customerContacts)
          .innerJoin(customers, eq(customers.id, customerContacts.customerId))
          .where(and(eq(customerContacts.id, input.destinationId), eq(customers.organizationId, orgId))).get()
      : await db.select({ person: vendorContacts, company: vendors }).from(vendorContacts)
          .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
          .where(and(eq(vendorContacts.id, input.destinationId), eq(vendors.organizationId, orgId))).get()
  if (!source || !destination) throw new Error("Both records must exist in this organization.")
  if (input.sourceId === input.destinationId) throw new Error("Choose two different records.")

  const sourcePerson = !company && "person" in source ? source.person : null
  const destinationPerson = !company && "person" in destination ? destination.person : null
  const sourceCompany = company && "name" in source ? source : null
  const destinationCompany = company && "name" in destination ? destination : null
  const sourceName = sourcePerson?.name ?? sourceCompany?.name ?? ""
  const destinationName = destinationPerson?.name ?? destinationCompany?.name ?? ""
  const sourceEmail = sourcePerson?.email ?? sourceCompany?.email ?? null
  const destinationEmail = destinationPerson?.email ?? destinationCompany?.email ?? null
  const sourceParentId = sourcePerson && "customerId" in sourcePerson ? sourcePerson.customerId
    : sourcePerson && "vendorId" in sourcePerson ? sourcePerson.vendorId : null
  const destinationParentId = destinationPerson && "customerId" in destinationPerson ? destinationPerson.customerId
    : destinationPerson && "vendorId" in destinationPerson ? destinationPerson.vendorId : null
  if (!company && sourceParentId !== destinationParentId) blockers.push("People may only be merged within the same company.")
  if (!company && "company" in source && "company" in destination) {
    for (const parent of [source.company, destination.company]) {
      if (typeof parent !== "object" || parent === null) continue
      if (("mergedIntoCustomerId" in parent && parent.mergedIntoCustomerId) ||
        ("directoryStatus" in parent && parent.directoryStatus !== "active")) {
        blockers.push("The parent company is archived or merged.")
        break
      }
    }
  }
  if (sourcePerson && (!sourcePerson.active || sourcePerson.mergedIntoPersonId)) blockers.push("The record to archive is already inactive or merged.")
  if (destinationPerson && (!destinationPerson.active || destinationPerson.mergedIntoPersonId)) blockers.push("The record to keep is inactive or merged.")
  if (sourcePerson && (sourcePerson.userId || sourcePerson.sageContactId || sourcePerson.sageLineNumber !== null)) {
    blockers.push("Keep the person with the Compass account or Sage identity; that record cannot be archived.")
  }
  if (sourceCompany && customer && "mergedIntoCustomerId" in sourceCompany && sourceCompany.mergedIntoCustomerId) blockers.push("The source client is already merged.")
  if (destinationCompany && customer && "mergedIntoCustomerId" in destinationCompany && destinationCompany.mergedIntoCustomerId) blockers.push("The destination client is already merged.")
  if (sourceCompany && !customer && "directoryStatus" in sourceCompany && sourceCompany.directoryStatus !== "active") blockers.push("The source vendor is not active.")
  if (destinationCompany && !customer && "directoryStatus" in destinationCompany && destinationCompany.directoryStatus !== "active") blockers.push("The destination vendor is not active.")
  // Imported directory IDs stay on the archived row, whose merge pointer preserves
  // their provenance. Accounting IDs cannot use that path: active Sage/NetSuite
  // workflows still address the company row directly.
  if (sourceCompany && customer && "sageClientId" in sourceCompany &&
    (sourceCompany.sageClientId || sourceCompany.sageClientNumber)) {
    blockers.push("Keep the client with the Sage identity. If both clients have different Sage numbers, reconcile those accounting records before merging in Compass.")
  }
  if (sourceCompany && customer && "netsuiteId" in sourceCompany && sourceCompany.netsuiteId) {
    blockers.push("Keep the client with the NetSuite identity; this merge does not transfer accounting links.")
  }
  if (sourceCompany && !customer && "sageVendorId" in sourceCompany &&
    (sourceCompany.sageVendorId || sourceCompany.sageVendorNumber)) {
    blockers.push("Keep the vendor with the Sage identity. If both vendors have different Sage numbers, reconcile those accounting records before merging in Compass.")
  }
  if (sourceCompany && !customer && "netsuiteId" in sourceCompany && sourceCompany.netsuiteId) {
    blockers.push("Keep the vendor with the NetSuite identity; this merge does not transfer accounting links.")
  }
  if (company && customer && sourceCompany && destinationCompany &&
    "relationshipType" in sourceCompany && "relationshipType" in destinationCompany &&
    sourceCompany.relationshipType !== destinationCompany.relationshipType) {
    blockers.push("A lead and a client need an explicit relationship decision before merging.")
  }
  if (company && !customer && sourceCompany && destinationCompany &&
    "category" in sourceCompany && "category" in destinationCompany &&
    (sourceCompany.category.trim().toLowerCase() === "internal" || destinationCompany.category.trim().toLowerCase() === "internal")) {
    blockers.push("Internal directory records cannot be merged here.")
  }

  const children = company
    ? customer
      ? await db.select().from(customerContacts).where(eq(customerContacts.customerId, input.sourceId))
      : await db.select().from(vendorContacts).where(eq(vendorContacts.vendorId, input.sourceId))
    : []
  if (children.some((person) => person.userId || person.sageContactId || person.sageLineNumber !== null)) {
    blockers.push("A person at the source company has a Compass account or Sage identity. Merge that identity separately first.")
  }
  const destinationChildren = company
    ? customer
      ? await db.select().from(customerContacts).where(eq(customerContacts.customerId, input.destinationId))
      : await db.select().from(vendorContacts).where(eq(vendorContacts.vendorId, input.destinationId))
    : []
  if (children.some((person) => person.isPrimary) && destinationChildren.some((person) => person.isPrimary && person.active)) {
    blockers.push("Both companies have a primary person. Choose one primary person before merging.")
  }
  const projectRows = await db.select({
    id: projectContacts.id,
    projectId: projectContacts.projectId,
    sourceEntityType: projectContacts.sourceEntityType,
    sourceEntityId: projectContacts.sourceEntityId,
  }).from(projectContacts).where(company
    ? customer
      ? or(eq(projectContacts.customerId, input.sourceId), and(eq(projectContacts.sourceEntityType, "customer"), eq(projectContacts.sourceEntityId, input.sourceId)))
      : or(eq(projectContacts.vendorId, input.sourceId), and(eq(projectContacts.sourceEntityType, "vendor"), eq(projectContacts.sourceEntityId, input.sourceId)))
    : customer
      ? or(eq(projectContacts.customerContactId, input.sourceId),
          and(eq(projectContacts.sourceEntityType, "customer_contact"), eq(projectContacts.sourceEntityId, input.sourceId)))
      : or(eq(projectContacts.vendorContactId, input.sourceId),
          and(eq(projectContacts.sourceEntityType, "vendor_contact"), eq(projectContacts.sourceEntityId, input.sourceId))))
  const destinationProjectRows = await db.select({ projectId: projectContacts.projectId }).from(projectContacts).where(company
    ? customer
      ? or(eq(projectContacts.customerId, input.destinationId),
          and(eq(projectContacts.sourceEntityType, "customer"), eq(projectContacts.sourceEntityId, input.destinationId)))
      : or(eq(projectContacts.vendorId, input.destinationId),
          and(eq(projectContacts.sourceEntityType, "vendor"), eq(projectContacts.sourceEntityId, input.destinationId)))
    : customer
      ? or(eq(projectContacts.customerContactId, input.destinationId),
          and(eq(projectContacts.sourceEntityType, "customer_contact"), eq(projectContacts.sourceEntityId, input.destinationId)))
      : or(eq(projectContacts.vendorContactId, input.destinationId),
          and(eq(projectContacts.sourceEntityType, "vendor_contact"), eq(projectContacts.sourceEntityId, input.destinationId))))
  const destinationProjectIds = new Set(destinationProjectRows.map((row) => row.projectId))
  if (projectRows.some((row) => destinationProjectIds.has(row.projectId))) {
    blockers.push("Both records occur on the same project. Resolve duplicate project contacts before merging.")
  }

  const sourceIds = company ? [input.sourceId, ...children.map((person) => person.id)] : [input.sourceId]
  const kinds = company
    ? customer ? ["client_company", "client_person"] : ["vendor_company", "vendor_person"]
    : [customer ? "client_person" : "vendor_person"]
  const [reads, changes, creates] = await Promise.all([
    db.select({ status: sageContactReadRequests.status }).from(sageContactReadRequests)
      .where(and(eq(sageContactReadRequests.organizationId, orgId), inArray(sageContactReadRequests.kind, kinds), inArray(sageContactReadRequests.entityId, sourceIds))),
    db.select({ status: sageContactChangeProposals.status }).from(sageContactChangeProposals)
      .where(and(eq(sageContactChangeProposals.organizationId, orgId), inArray(sageContactChangeProposals.kind, kinds), inArray(sageContactChangeProposals.entityId, sourceIds))),
    company
      ? db.select({ status: sageContactCreateProposals.status }).from(sageContactCreateProposals)
          .where(and(eq(sageContactCreateProposals.organizationId, orgId), customer
            ? eq(sageContactCreateProposals.customerId, input.sourceId)
            : eq(sageContactCreateProposals.vendorId, input.sourceId)))
      : Promise.resolve([]),
  ])
  if ([...reads, ...changes, ...creates].some((row) => activeProposal(row.status))) {
    blockers.push("A Sage review or bridge operation is still active for the source. Finish or reject it first.")
  }
  const [snapshots, clientWrites] = await Promise.all([
    db.select({ id: sageContactSnapshots.id }).from(sageContactSnapshots).where(and(
      eq(sageContactSnapshots.organizationId, orgId),
      inArray(sageContactSnapshots.kind, kinds),
      inArray(sageContactSnapshots.entityId, sourceIds)
    )).limit(1),
    company && customer
      ? db.select({ status: sageClientProjectWriteOperations.status }).from(sageClientProjectWriteOperations)
          .where(and(eq(sageClientProjectWriteOperations.organizationId, orgId),
            eq(sageClientProjectWriteOperations.customerId, input.sourceId)))
      : Promise.resolve([]),
  ])
  if (snapshots.length > 0) blockers.push("The source has a Sage snapshot. Keep its linked identity and merge the other record into it.")
  if (clientWrites.some((row) => activeProposal(row.status))) {
    blockers.push("A Sage client/project write is still active for the source.")
  }
  return {
    preview: {
      kind: input.kind, sourceName, destinationName, sourceEmail, destinationEmail,
      peopleCount: children.length, projectContactCount: projectRows.length,
      retainedIdentityNotice: sourceCompany && "buildertrendContactId" in sourceCompany && sourceCompany.buildertrendContactId
        ? `Buildertrend contact #${sourceCompany.buildertrendContactId} remains on the archived record, which points to the survivor. This does not merge the two Buildertrend records.`
        : sourceCompany && "sourceRecordId" in sourceCompany && sourceCompany.sourceRecordId
          ? "The imported source ID remains on the archived record, which points to the survivor. This does not merge records in the source system."
          : sourcePerson?.sourceRecordId
            ? "The imported person ID remains on the archived record, which points to the survivor. This does not merge records in the source system."
            : null,
      blockers,
    },
    sourceSnapshot: JSON.stringify(source),
    destinationSnapshot: JSON.stringify(destination),
    affectedProjectIds: Array.from(new Set(projectRows.map((row) => row.projectId))),
  }
}

export async function previewContactMerge(raw: MergeInput): Promise<PreviewResult> {
  try {
    const input = mergeInput.parse(raw)
    return { success: true, preview: (await inspect(input)).preview }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not preview merge." }
  }
}

export async function mergeDuplicateContacts(raw: MergeInput): Promise<MergeResult> {
  try {
    const input = mergeInput.parse(raw)
    const { user, orgId, d1 } = await context(input.kind, true)
    const { preview, sourceSnapshot, destinationSnapshot, affectedProjectIds } = await inspect(input)
    if (preview.blockers.length > 0) return { success: false, error: preview.blockers.join(" ") }
    const now = new Date().toISOString()
    const company = input.kind.endsWith("company")
    const customer = input.kind.startsWith("customer")
    const statements: D1PreparedStatement[] = [
      d1.prepare(`INSERT INTO contact_merge_events
        (id, organization_id, kind, source_id, destination_id, source_snapshot_json,
         destination_snapshot_json, moved_people_count, moved_project_contacts_count,
         merged_by_user_id, merged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), orgId, input.kind, input.sourceId, input.destinationId,
          sourceSnapshot, destinationSnapshot, preview.peopleCount, preview.projectContactCount, user.id, now),
    ]
    if (company) {
      // Move children first: the project-contact scope trigger checks the child's current parent.
      statements.push(d1.prepare(customer
        ? "UPDATE customer_contacts SET customer_id = ?, updated_at = ? WHERE customer_id = ?"
        : "UPDATE vendor_contacts SET vendor_id = ?, updated_at = ? WHERE vendor_id = ?")
        .bind(input.destinationId, now, input.sourceId))
      statements.push(d1.prepare(customer
        ? "UPDATE project_contacts SET customer_id = ?, source_entity_id = CASE WHEN source_entity_type = 'customer' AND source_entity_id = ? THEN ? ELSE source_entity_id END, source_record_id = CASE WHEN source_entity_type = 'customer' AND source_record_id = ? THEN ? ELSE source_record_id END, updated_at = ? WHERE customer_id = ? OR (source_entity_type = 'customer' AND source_entity_id = ?)"
        : "UPDATE project_contacts SET vendor_id = ?, source_entity_id = CASE WHEN source_entity_type = 'vendor' AND source_entity_id = ? THEN ? ELSE source_entity_id END, source_record_id = CASE WHEN source_entity_type = 'vendor' AND source_record_id = ? THEN ? ELSE source_record_id END, updated_at = ? WHERE vendor_id = ? OR (source_entity_type = 'vendor' AND source_entity_id = ?)")
        .bind(input.destinationId, input.sourceId, input.destinationId, input.sourceId, input.destinationId, now, input.sourceId, input.sourceId))
      statements.push(d1.prepare(customer
        ? "UPDATE customers SET merged_into_customer_id = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND merged_into_customer_id IS NULL"
        : "UPDATE vendors SET merged_into_vendor_id = ?, directory_status = 'merged', updated_at = ? WHERE id = ? AND organization_id = ? AND merged_into_vendor_id IS NULL")
        .bind(input.destinationId, now, input.sourceId, orgId))
    } else {
      statements.push(d1.prepare(customer
        ? "UPDATE project_contacts SET customer_contact_id = ?, source_entity_id = CASE WHEN source_entity_type = 'customer_contact' AND source_entity_id = ? THEN ? ELSE source_entity_id END, source_record_id = CASE WHEN source_entity_type = 'customer_contact' AND source_record_id = ? THEN ? ELSE source_record_id END, updated_at = ? WHERE customer_contact_id = ? OR (source_entity_type = 'customer_contact' AND source_entity_id = ?)"
        : "UPDATE project_contacts SET vendor_contact_id = ?, source_entity_id = CASE WHEN source_entity_type = 'vendor_contact' AND source_entity_id = ? THEN ? ELSE source_entity_id END, source_record_id = CASE WHEN source_entity_type = 'vendor_contact' AND source_record_id = ? THEN ? ELSE source_record_id END, updated_at = ? WHERE vendor_contact_id = ? OR (source_entity_type = 'vendor_contact' AND source_entity_id = ?)")
        .bind(input.destinationId, input.sourceId, input.destinationId, input.sourceId, input.destinationId, now, input.sourceId, input.sourceId))
      statements.push(d1.prepare(customer
        ? "UPDATE customer_contacts SET is_primary = 1, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM customer_contacts WHERE id = ? AND is_primary = 1)"
        : "UPDATE vendor_contacts SET is_primary = 1, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM vendor_contacts WHERE id = ? AND is_primary = 1)")
        .bind(now, input.destinationId, input.sourceId))
      statements.push(d1.prepare(customer
        ? "UPDATE customer_contacts SET active = 0, merged_into_person_id = ?, is_primary = 0, updated_at = ? WHERE id = ? AND active = 1 AND merged_into_person_id IS NULL"
        : "UPDATE vendor_contacts SET active = 0, merged_into_person_id = ?, is_primary = 0, updated_at = ? WHERE id = ? AND active = 1 AND merged_into_person_id IS NULL")
        .bind(input.destinationId, now, input.sourceId))
    }
    await d1.batch(statements)
    const db = getDb(d1)
    let trackerWarning = false
    for (const projectId of affectedProjectIds) {
      try {
        await queueProjectContactTrackerRefresh({ db, organizationId: orgId, projectId })
      } catch {
        trackerWarning = true
      }
    }
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return {
      success: true,
      keptId: input.destinationId,
      ...(trackerWarning ? { warning: "Merged, but a project registry refresh could not be queued. Please retry the registry sync." } : {}),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not merge contacts." }
  }
}
