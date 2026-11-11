"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { actionFailure, type ActionDone, type ActionResult } from "@/lib/action-result"
import { sageEmployeeLinkGapLabel } from "@/lib/domain/contacts/sage-employee-rules"
import { canFeature } from "@/lib/permission-enforcement"
import { sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"
import {
  linkStaffToSageEmployee,
  loadSageEmployeeSyncState,
  requestSageEmployeeRefresh,
  sageEmployeeReaderRunning,
  staffSageLinkOverview,
} from "@/lib/sage/employee-directory-sync"
import { orgContext } from "@/lib/server/action-context"

type StaffSageLinkRow = {
  /** "contact:<id>" or "user:<id>". */
  readonly key: string
  readonly name: string
  readonly email: string | null
  readonly reason: string
  /** The Sage employee an email match found, when automatic linking is off. */
  readonly suggestedSageRecordId: string | null
}

export type StaffSageLinkStatus = {
  readonly available: boolean
  readonly lastSyncedAt: string | null
  readonly readerRunning: boolean
  readonly canLink: boolean
  readonly staff: readonly StaffSageLinkRow[]
  readonly employees: readonly { readonly sageRecordId: string; readonly label: string }[]
}

/** Sage contact review: staff not linked to a Sage employee, and the Sage employees free to link. */
export async function getStaffSageLinkStatus(): Promise<ActionResult<StaffSageLinkStatus>> {
  const context = await orgContext({ feature: "sage-contact-review", action: "read" })
  if (!context.success) return context
  const { db, env, user, organizationId } = context.data
  if (!(await canFeature(user, "employee-contact-private", "read")) || !(await canFeature(user, "internal-directory", "read"))) {
    return actionFailure("You don't have access to staff Sage links.")
  }
  const [state, overview, canLink] = await Promise.all([
    loadSageEmployeeSyncState(db),
    staffSageLinkOverview(db, organizationId),
    canLinkStaff(user),
  ])
  const staff: StaffSageLinkRow[] = [
    ...overview.needsLinking.map((row) => ({
      key: row.target.kind === "contact" ? `contact:${row.target.internalContactId}` : `user:${row.target.user.userId}`,
      name: row.target.kind === "contact" ? row.target.name : row.target.user.name,
      email: row.email,
      reason: sageEmployeeLinkGapLabel(row.gap) + (row.target.kind === "user" ? " · no internal contact yet" : ""),
      suggestedSageRecordId: null,
    })),
    ...overview.emailMatches.map((row) => ({
      key: row.target.kind === "contact" ? `contact:${row.target.internalContactId}` : `user:${row.target.user.userId}`,
      name: row.target.kind === "contact" ? row.target.name : row.target.user.name,
      email: row.employee.email,
      reason: "Same email as a Sage employee; automatic linking is off",
      suggestedSageRecordId: row.employee.sageRecordId,
    })),
  ].sort((left, right) => left.name.localeCompare(right.name))
  return {
    success: true,
    data: {
      available: sageContactOrganizationMatches(env, organizationId),
      lastSyncedAt: state.lastSyncedAt,
      readerRunning: sageEmployeeReaderRunning(state, new Date()),
      canLink,
      staff,
      employees: overview.unlinkedEmployees.map((employee) => ({
        sageRecordId: employee.sageRecordId,
        label: `${employee.name} · #${employee.sageEmployeeNumber}${employee.email ? ` · ${employee.email}` : ""}`,
      })),
    },
  }
}

async function canLinkStaff(user: Parameters<typeof canFeature>[0]): Promise<boolean> {
  const checks = await Promise.all([
    canFeature(user, "sage-contact-review", "approve"),
    canFeature(user, "internal-directory", "update"),
    canFeature(user, "employee-contact-private", "approve"),
  ])
  return checks.every(Boolean)
}

const linkInput = z.object({
  key: z.string().regex(/^(contact|user):.{1,200}$/),
  sageRecordId: z.guid(),
})

/** "Link to Sage employee": an admin links one unlinked staff member to a current Sage employee. */
export async function linkStaffMemberToSageEmployee(raw: z.input<typeof linkInput>): Promise<ActionDone> {
  try {
    const parsed = linkInput.safeParse(raw)
    if (!parsed.success) return actionFailure("Choose a staff member and a Sage employee.")
    const context = await orgContext({ feature: "sage-contact-review", action: "approve", mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!(await canLinkStaff(user))) return actionFailure("You don't have access to link staff to Sage.")
    const separator = parsed.data.key.indexOf(":")
    const id = parsed.data.key.slice(separator + 1)
    const target = parsed.data.key.startsWith("contact:")
      ? { kind: "contact" as const, internalContactId: id }
      : { kind: "user" as const, userId: id }
    const result = await linkStaffToSageEmployee(db, organizationId, { target, sageRecordId: parsed.data.sageRecordId }, user, new Date().toISOString())
    if (!result.success) return result
    revalidatePath("/dashboard/contacts")
    return { success: true }
  } catch (error) {
    console.error("Failed to link staff to a Sage employee", error)
    return actionFailure("Could not link this person to Sage.")
  }
}

/** "Read Sage employees now": the reader reads Sage's employee list on its next check. */
export async function refreshSageEmployees(): Promise<ActionDone> {
  const context = await orgContext({ feature: "sage-contact-review", action: "read", mutation: true })
  if (!context.success) return context
  const { env, organizationId } = context.data
  if (!sageContactOrganizationMatches(env, organizationId)) return actionFailure("Sage isn't connected for this company.")
  await requestSageEmployeeRefresh(env.DB, new Date().toISOString())
  return { success: true }
}
