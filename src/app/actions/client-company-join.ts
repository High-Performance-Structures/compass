"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { customers } from "@/db/schema"
import { activityActorName } from "@/lib/activity-log"
import {
  clientCompanyJoinBatch,
  clientCompanyJoinOptions,
  inspectClientCompanyJoin,
  type ClientCompanyJoinPerson,
} from "@/lib/domain/contacts/join-client-company"
import type { CompanyMergeCount } from "@/lib/domain/contacts/company-merge"
import { queueProjectContactTrackerRefresh } from "@/lib/project-contact-tracker-refresh"
import { orgContext } from "@/lib/server/action-context"

/*
 * "Company" on a standalone client record: choose an existing client company
 * and the record becomes a person of it (join-client-company.ts). Editing a
 * client is the permission, as for every other client directory edit.
 */

const joinInput = z.object({
  recordId: z.string().min(1).max(200),
  companyId: z.string().min(1).max(200),
})

export type ClientCompanyOption = { readonly id: string; readonly name: string; readonly sageClientNumber: string | null }

export type ClientCompanyJoinPreview = {
  readonly recordName: string
  readonly companyName: string
  readonly person: Pick<ClientCompanyJoinPerson, "kind" | "name">
  readonly projectContactCount: number
  readonly projectCount: number
  readonly signInMoves: boolean
  readonly otherPeople: readonly string[]
  readonly moves: readonly CompanyMergeCount[]
  readonly warnings: readonly string[]
  readonly blockers: readonly string[]
}

type Failure = { readonly success: false; readonly error: string }

function failure(error: unknown, fallback: string): Failure {
  return { success: false, error: error instanceof Error ? error.message : fallback }
}

/** The client companies a standalone client record can join. */
export async function getClientCompanyOptions(
  recordId: string
): Promise<{ readonly success: true; readonly options: readonly ClientCompanyOption[] } | Failure> {
  const context = await orgContext({ feature: "customers", action: "read" })
  if (!context.success) return context
  try {
    const { env, organizationId } = context.data
    return { success: true, options: await clientCompanyJoinOptions(env.DB, { organizationId, recordId }) }
  } catch (error) {
    return failure(error, "Could not load client companies.")
  }
}

/** What joining the company would do, and anything that blocks it. */
export async function previewClientCompanyJoin(
  raw: z.input<typeof joinInput>
): Promise<{ readonly success: true; readonly preview: ClientCompanyJoinPreview } | Failure> {
  const context = await orgContext({ feature: "customers", action: "update" })
  if (!context.success) return context
  try {
    const input = joinInput.parse(raw)
    const { env, organizationId } = context.data
    const plan = await inspectClientCompanyJoin(env.DB, { organizationId, ...input })
    return {
      success: true,
      preview: {
        recordName: plan.recordName,
        companyName: plan.companyName,
        person: { kind: plan.person.kind, name: plan.person.name },
        projectContactCount: plan.projectContacts.length,
        projectCount: new Set(plan.projectContacts.map((row) => row.projectId)).size,
        signInMoves: plan.signIn !== null,
        otherPeople: plan.otherPeople,
        moves: plan.moves,
        warnings: plan.warnings,
        blockers: plan.blockers,
      },
    }
  } catch (error) {
    return failure(error, "Could not check the client company.")
  }
}

/** Makes the client record a person of the client company, in one atomic batch. */
export async function joinClientCompany(
  raw: z.input<typeof joinInput>
): Promise<{ readonly success: true; readonly companyId: string; readonly warning?: string } | Failure> {
  const context = await orgContext({ feature: "customers", action: "update", mutation: true })
  if (!context.success) return context
  try {
    const input = joinInput.parse(raw)
    const { env, db, organizationId, user } = context.data
    const plan = await inspectClientCompanyJoin(env.DB, { organizationId, ...input })
    if (plan.blockers.length > 0) return { success: false, error: plan.blockers.join(" ") }
    await env.DB.batch(clientCompanyJoinBatch(env.DB, plan, {
      userId: user.id,
      name: activityActorName({ id: user.id, email: user.email, displayName: user.displayName, firstName: user.firstName, lastName: user.lastName, role: user.role }),
      role: user.role,
      now: new Date().toISOString(),
    }))
    // Every write is guarded; when the record changed since the check, nothing happened.
    const joined = await db.select({ mergedInto: customers.mergedIntoCustomerId }).from(customers)
      .where(and(eq(customers.id, input.recordId), eq(customers.organizationId, organizationId))).get()
    if (joined?.mergedInto !== input.companyId) return { success: false, error: "The client changed while joining. Nothing was changed; please try again." }
    let trackerWarning = false
    for (const projectId of new Set(plan.projectContacts.map((row) => row.projectId))) {
      try {
        await queueProjectContactTrackerRefresh({ db, organizationId, projectId })
      } catch {
        trackerWarning = true
      }
    }
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return {
      success: true,
      companyId: input.companyId,
      ...(trackerWarning ? { warning: "Joined, but a project registry refresh could not be queued. Please retry the registry sync." } : {}),
    }
  } catch (error) {
    return failure(error, "Could not join the client company.")
  }
}
