"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  CONNECT_COMPANY_KINDS,
  connectUnassignedPerson,
  type ConnectUnassignedOutcome,
} from "@/lib/domain/contacts/connect-unassigned-person"
import { INTERNAL_MERGE_BLOCKER, searchCompanyMergeCandidates, type CompanyMergeCandidate } from "@/lib/domain/contacts/directory-page"
import { revalidateProjectContactPaths } from "@/lib/domain/contacts/paths"
import { runUnassignedAutoConnect, type UnassignedAutoConnectResult } from "@/lib/domain/contacts/unassigned-auto-connect"
import { archiveUnassignedPerson, saveUnassignedPerson } from "@/lib/domain/contacts/unassigned-person-edit"
import {
  listUnassignedPeople,
  suggestCompanyForImportedName,
  type CompanySuggestion,
  type UnassignedPerson,
} from "@/lib/domain/contacts/unassigned-people"
import { canFeature } from "@/lib/permission-enforcement"
import { can } from "@/lib/permissions"
import { queueProjectContactTrackerRefresh } from "@/lib/project-contact-tracker-refresh"
import { orgContext } from "@/lib/server/action-context"
import { canManageUserAccessRole } from "@/lib/user-roles"

/** People from imported messages not yet connected to a company (Contacts → Unassigned). */
export async function getUnassignedPeople(): Promise<readonly UnassignedPerson[]> {
  const context = await orgContext()
  if (!context.success) return []
  const { db, user, organizationId } = context.data
  if (!(await canFeature(user, "vendors", "read"))) return []
  return listUnassignedPeople(db, organizationId)
}

const kindInput = z.enum(CONNECT_COMPANY_KINDS)
const directoryFeature = (kind: z.infer<typeof kindInput>): string => kind === "vendor" ? "vendors" : "customers"

const searchInput = z.object({ kind: kindInput, search: z.string().trim().max(100) })

/** Companies to connect a person to: the directory's own company search. */
export async function findUnassignedConnectCompanies(
  raw: z.input<typeof searchInput>,
): Promise<ActionResult<readonly CompanyMergeCandidate[]>> {
  try {
    const input = searchInput.parse(raw)
    const context = await orgContext({ feature: directoryFeature(input.kind) })
    if (!context.success) return context
    const { db, organizationId } = context.data
    const candidates = await searchCompanyMergeCandidates(db, organizationId, { kind: input.kind, search: input.search, excludeId: "" })
    return {
      success: true,
      data: candidates.map((candidate) => candidate.blockedReason === INTERNAL_MERGE_BLOCKER
        ? { ...candidate, blockedReason: "People cannot be connected to an internal directory record." }
        : candidate),
    }
  } catch {
    return actionFailure("Could not search records.")
  }
}

/** The company the imported company name points to, when it matches exactly. */
export async function getUnassignedCompanySuggestion(companyName: string | null): Promise<CompanySuggestion | null> {
  const parsed = z.string().trim().max(200).nullable().safeParse(companyName)
  if (!parsed.success || !parsed.data) return null
  const context = await orgContext({ feature: "vendors" })
  if (!context.success) return null
  const { db, user, organizationId } = context.data
  const suggestion = await suggestCompanyForImportedName(db, organizationId, parsed.data)
  if (suggestion?.kind === "customer" && !(await canFeature(user, "customers", "read"))) return null
  return suggestion
}

const connectInput = z.object({
  identity: z.string().trim().min(1).max(4000),
  kind: kindInput,
  companyId: z.string().trim().min(1).max(200),
})

/**
 * "Connect to company…": ties an imported person to a vendor or client the
 * way staff add a contact today (see connect-unassigned-person.ts). Needs the
 * permissions of that add path: adding a vendor person (vendors update) or a
 * client person (customers create), and editing project contacts. Nobody is
 * invited, emailed or notified, and nothing is shared.
 */
export async function connectUnassignedPersonToCompany(
  raw: z.input<typeof connectInput>,
): Promise<ActionResult<ConnectUnassignedOutcome>> {
  try {
    const parsed = connectInput.safeParse(raw)
    if (!parsed.success) return actionFailure("Choose a company to connect this person to.")
    const input = parsed.data
    const context = await orgContext({ feature: "project-contacts", action: "update", mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const directoryAction = input.kind === "vendor" ? "update" : "create"
    if (!can(user, "project", "update") || !(await canFeature(user, directoryFeature(input.kind), directoryAction))) {
      return actionFailure(`You do not have permission to add people to ${input.kind === "vendor" ? "vendors" : "clients"}.`)
    }
    const result = await connectUnassignedPerson({ db, user, organizationId }, input)
    if (!result.success) return result
    const { data } = result
    const projectIds = [...new Set(data.connected.map((row) => row.projectId))]
    for (const projectId of projectIds) {
      await queueProjectContactTrackerRefresh({ db, organizationId, projectId })
      revalidateProjectContactPaths(projectId)
    }
    if (data.connected.length > 0) {
      await recordActivityEvent({
        db, organizationId,
        actor: { id: user.id, email: user.email, displayName: user.displayName,
          firstName: user.firstName, lastName: user.lastName, role: user.role },
        category: "account",
        action: "unassigned_person.connected",
        entityType: input.kind === "vendor" ? "vendor_contact" : data.personId ? "customer_contact" : "customer",
        entityId: data.personId ?? input.companyId,
        summary: data.compassOnlyOnSageLinked
          ? `Added a person from imported BT messages to ${data.companyName}, Compass only (not in Sage).`
          : `Connected a person from imported messages to ${data.companyName}.`,
        metadata: {
          companyId: input.companyId, kind: input.kind, createdPerson: data.createdPerson,
          compassOnly: data.compassOnlyOnSageLinked, projectIds,
        },
      })
    }
    revalidatePath("/dashboard/contacts")
    revalidatePath(input.kind === "vendor" ? "/dashboard/vendors" : "/dashboard/customers")
    return result
  } catch (error) {
    console.error("Failed to connect unassigned person", error)
    return actionFailure("Could not connect this person to the company.")
  }
}

const editInput = z.object({
  identity: z.string().trim().min(1).max(4000),
  name: z.string().trim().min(1).max(200),
  email: z.union([z.literal(""), z.email().max(254)]),
  phone: z.string().trim().max(60),
  companyName: z.string().trim().max(200),
})

/** Same people who can add or remove project contacts may edit and archive an unassigned person. */
async function unassignedEditContext() {
  const context = await orgContext({ feature: "project-contacts", action: "update", mutation: true })
  if (!context.success) return context
  if (!can(context.data.user, "project", "update")) return actionFailure("You do not have permission to edit project contacts.")
  return context
}

/**
 * Edit an unassigned person's name, email, phone and imported company on
 * every project they appear on. Allowed until they accept a Compass
 * invitation. Nobody is invited, emailed or notified.
 */
export async function editUnassignedPerson(
  raw: z.input<typeof editInput>,
): Promise<ActionResult<{ readonly warning: string | null }>> {
  try {
    const parsed = editInput.safeParse({ ...raw, email: raw.email?.trim().toLowerCase() ?? "" })
    if (!parsed.success) return actionFailure("Enter a name and a valid email, or leave the email blank.")
    const input = parsed.data
    const context = await unassignedEditContext()
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const result = await saveUnassignedPerson(db, {
      organizationId,
      identity: input.identity,
      person: { name: input.name, email: input.email, phone: input.phone, companyName: input.companyName },
      now: new Date().toISOString(),
    })
    if (!result.success) return result
    if (result.changed.length > 0) {
      await recordActivityEvent({
        db, organizationId, actor: user,
        category: "account",
        action: "unassigned_person.updated",
        entityType: "project_contact",
        entityId: result.contactIds[0] ?? null,
        summary: `Updated ${input.name}'s contact information (unassigned person from imported messages).`,
        metadata: { identity: input.identity, changed: result.changed, projectIds: result.projectIds },
      })
      for (const projectId of result.projectIds) {
        await queueProjectContactTrackerRefresh({ db, organizationId, projectId })
        revalidateProjectContactPaths(projectId)
      }
      revalidatePath("/dashboard/contacts")
    }
    return { success: true, data: { warning: result.warning } }
  } catch (error) {
    console.error("Failed to edit unassigned person", error)
    return actionFailure("Could not save this person.")
  }
}

/**
 * Archive an unassigned person: they leave every project's contact list.
 * Their rows are kept, never deleted, because imported messages name them.
 */
export async function archiveUnassignedPersonAction(identity: string): Promise<ActionResult<{ readonly name: string }>> {
  try {
    const parsed = z.string().trim().min(1).max(4000).safeParse(identity)
    if (!parsed.success) return actionFailure("Choose a person to archive.")
    const context = await unassignedEditContext()
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const result = await archiveUnassignedPerson(db, { organizationId, identity: parsed.data, now: new Date().toISOString() })
    if (!result.success) return result
    await recordActivityEvent({
      db, organizationId, actor: user,
      category: "account",
      action: "unassigned_person.archived",
      entityType: "project_contact",
      entityId: result.contactIds[0] ?? null,
      summary: `Archived ${result.name} (unassigned person from imported messages) from ${result.projectIds.length} project contact list${result.projectIds.length === 1 ? "" : "s"}.`,
      metadata: { identity: parsed.data, contactIds: [...result.contactIds], projectIds: [...result.projectIds] },
    })
    for (const projectId of result.projectIds) {
      await queueProjectContactTrackerRefresh({ db, organizationId, projectId })
      revalidateProjectContactPaths(projectId)
    }
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { name: result.name } }
  } catch (error) {
    console.error("Failed to archive unassigned person", error)
    return actionFailure("Could not archive this person.")
  }
}

const autoConnectInput = z.object({ apply: z.boolean(), skipped: z.array(z.string().max(400)).max(2000) })

/**
 * "Connect automatically…" (admins): previews, or connects the next bounded
 * batch of people the matcher ties clearly to one vendor or client, through
 * the same path as "Connect to company…". The caller repeats while
 * `remaining` is above zero, then records the run once in Activity.
 */
export async function runUnassignedAutoConnectAction(raw: z.input<typeof autoConnectInput>): Promise<ActionResult<UnassignedAutoConnectResult>> {
  try {
    const input = autoConnectInput.parse(raw)
    const context = await orgContext({ feature: "project-contacts", action: "update", mutation: input.apply })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!canManageUserAccessRole(user.role)) return actionFailure("Only admins can connect people automatically.")
    const result = await runUnassignedAutoConnect({ db, user, organizationId }, input)
    for (const projectId of result.projectIds) {
      await queueProjectContactTrackerRefresh({ db, organizationId, projectId })
      revalidateProjectContactPaths(projectId)
    }
    if (result.projectIds.length > 0) {
      revalidatePath("/dashboard/contacts")
      revalidatePath("/dashboard/vendors")
      revalidatePath("/dashboard/customers")
    }
    return { success: true, data: result }
  } catch (error) {
    console.error("Failed to connect unassigned people automatically", error)
    return actionFailure("Could not connect people automatically.")
  }
}

const runTotalsInput = z.object({
  people: z.number().int().min(0).max(100000),
  contacts: z.number().int().min(0).max(100000),
  failed: z.number().int().min(0).max(100000),
})

/** One Activity record for a whole automatic run (it spans several calls). */
export async function recordUnassignedAutoConnectRun(raw: z.input<typeof runTotalsInput>): Promise<ActionResult<null>> {
  try {
    const totals = runTotalsInput.parse(raw)
    const context = await orgContext({ mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!canManageUserAccessRole(user.role)) return actionFailure("Only admins can connect people automatically.")
    if (totals.people === 0) return { success: true, data: null }
    await recordActivityEvent({
      db, organizationId,
      actor: { id: user.id, email: user.email, displayName: user.displayName, firstName: user.firstName, lastName: user.lastName, role: user.role },
      category: "account",
      action: "unassigned_person.auto_connected",
      entityType: "organization",
      entityId: organizationId,
      summary: `Automatically connected ${totals.people} people from imported messages to their companies (${totals.contacts} project contacts)${totals.failed > 0 ? `; ${totals.failed} could not be connected` : ""}. Nobody was invited or notified.`,
      metadata: { people: totals.people, contacts: totals.contacts, failed: totals.failed },
    })
    return { success: true, data: null }
  } catch (error) {
    console.error("Failed to record the automatic connect run", error)
    return actionFailure("Could not record the run.")
  }
}
