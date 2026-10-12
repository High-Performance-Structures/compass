import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectContacts, vendorContacts, vendors } from "@/db/schema"

type Db = ReturnType<typeof getDb>

export type WarrantyAssignee = {
  readonly assignedName: string | null
  readonly assignedProjectContactId: string | null
  readonly assignedVendorId: string | null
}

const UNASSIGNED: WarrantyAssignee = {
  assignedName: null,
  assignedProjectContactId: null,
  assignedVendorId: null,
}

/** Keeps an older, text-only assignment exactly as it was. */
export const NAME_ONLY_PREFIX = "name:"

/**
 * Turns the staff picker's choice into a stored assignment, looked up again on
 * the server so a claim can only point at a contact of this project or a
 * vendor of this organization. The vendor link is what lets that vendor (and
 * only that vendor) see the claim in their workspace.
 */
export async function resolveWarrantyAssignee(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly key: string | null },
): Promise<WarrantyAssignee | { readonly error: string }> {
  const key = input.key?.trim() ?? ""
  if (!key) return UNASSIGNED
  if (key.startsWith(NAME_ONLY_PREFIX)) {
    const name = key.slice(NAME_ONLY_PREFIX.length).trim()
    return name ? { ...UNASSIGNED, assignedName: name } : UNASSIGNED
  }

  if (key.startsWith("project:")) {
    const contact = await db
      .select({
        id: projectContacts.id,
        displayName: projectContacts.displayName,
        vendorId: projectContacts.vendorId,
      })
      .from(projectContacts)
      .where(and(eq(projectContacts.id, key.slice("project:".length)), eq(projectContacts.projectId, input.projectId)))
      .limit(1)
      .then((rows) => rows[0])
    if (!contact) return { error: "That contact is no longer on this project." }
    return { assignedName: contact.displayName, assignedProjectContactId: contact.id, assignedVendorId: contact.vendorId }
  }

  if (key.startsWith("directory:vendor-contact:")) {
    const person = await db
      .select({ name: vendorContacts.name, vendorId: vendorContacts.vendorId })
      .from(vendorContacts)
      .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(
        and(
          eq(vendorContacts.id, key.slice("directory:vendor-contact:".length)),
          eq(vendors.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0])
    if (!person) return { error: "That vendor contact is no longer in the directory." }
    return { ...UNASSIGNED, assignedName: person.name, assignedVendorId: person.vendorId }
  }

  if (key.startsWith("directory:") && !key.slice("directory:".length).includes(":")) {
    const vendor = await db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(and(eq(vendors.id, key.slice("directory:".length)), eq(vendors.organizationId, input.organizationId)))
      .limit(1)
      .then((rows) => rows[0])
    if (!vendor) return { error: "That vendor is no longer in the directory." }
    return { ...UNASSIGNED, assignedName: vendor.name, assignedVendorId: vendor.id }
  }

  return { error: "Choose an assignee from the list." }
}

export type WarrantyAssigneeOption = {
  readonly key: string
  readonly label: string
  /** Person or company name stored on the claim. */
  readonly name: string
  readonly projectContactId: string | null
  readonly vendorId: string | null
}

/**
 * The key the picker should start on for a claim: its linked contact, else
 * its vendor, else a contact whose name matches the older text-only
 * assignment (so one save links it), else the text as-is.
 */
export function warrantyAssigneeKey(
  claim: {
    readonly assignedName: string | null
    readonly assignedProjectContactId: string | null
    readonly assignedVendorId: string | null
  },
  options: readonly WarrantyAssigneeOption[],
): string {
  if (claim.assignedProjectContactId) {
    const linked = options.find((option) => option.projectContactId === claim.assignedProjectContactId)
    if (linked) return linked.key
  }
  if (claim.assignedVendorId) {
    const vendor = options.find((option) => option.key === `directory:${claim.assignedVendorId}`)
    if (vendor) return vendor.key
  }
  const name = claim.assignedName?.trim().toLowerCase()
  if (!name) return ""
  const byName = options.filter((option) => option.name.trim().toLowerCase() === name)
  const projectMatch = byName.find((option) => option.projectContactId !== null)
  const match = projectMatch ?? (byName.length === 1 ? byName[0] : undefined)
  return match ? match.key : `${NAME_ONLY_PREFIX}${claim.assignedName?.trim() ?? ""}`
}

/** Picker options from the project's task assignee options (existing Compass contacts). */
export function warrantyAssigneeOptions(options: {
  readonly projectContacts: readonly { readonly id: string; readonly label: string; readonly name: string; readonly projectContactId: string | null }[]
  readonly directoryContacts: readonly { readonly id: string; readonly label: string; readonly name: string; readonly directoryContactId: string | null }[]
}): readonly WarrantyAssigneeOption[] {
  const seen = new Set<string>()
  const result: WarrantyAssigneeOption[] = []
  for (const option of options.projectContacts) {
    if (seen.has(option.id)) continue
    seen.add(option.id)
    result.push({ key: option.id, label: option.label, name: option.name, projectContactId: option.projectContactId, vendorId: null })
  }
  for (const option of options.directoryContacts) {
    if (seen.has(option.id)) continue
    seen.add(option.id)
    // Only vendors and their people can be resolved on save; customers and
    // other directory entries are left out of the warranty picker.
    if (!option.id.startsWith("directory:vendor-contact:") && option.id.slice("directory:".length).includes(":")) continue
    result.push({
      key: option.id,
      label: option.label,
      name: option.name,
      projectContactId: null,
      vendorId: option.id === `directory:${option.directoryContactId ?? ""}` ? option.directoryContactId : null,
    })
  }
  return result
}
