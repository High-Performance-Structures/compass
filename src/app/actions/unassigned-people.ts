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
  identity: z.string().trim().min(1).max(300),
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
        summary: `Connected a person from imported messages to ${data.companyName}.`,
        metadata: { companyId: input.companyId, kind: input.kind, createdPerson: data.createdPerson, projectIds },
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
