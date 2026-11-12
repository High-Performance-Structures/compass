"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionFailure, type ActionFailure } from "@/lib/action-result"
import { crewInputProblem, listCrews, type Crew } from "@/lib/domain/identity/crews"
import { deleteCrew, saveCrew } from "@/lib/domain/identity/store"
import { activeStaff } from "@/lib/domain/identity/reads"
import { PROJECT_DEPARTMENTS } from "@/lib/domain/project/statuses"
import { orgContext } from "@/lib/server/action-context"

/** Settings › People › Crews: the company's crews and the staff who can join them. */
export type CrewSettings = {
  readonly crews: readonly Crew[]
  readonly staff: readonly { readonly id: string; readonly name: string }[]
  readonly canEdit: boolean
}

export async function getCrewSettings(): Promise<{ readonly success: true; readonly data: CrewSettings } | ActionFailure> {
  const context = await orgContext({ feature: "teams", action: "read" })
  if (!context.success) return context
  const { db, organizationId } = context.data
  const [crews, staff, editor] = await Promise.all([
    listCrews(db, organizationId),
    activeStaff(db, organizationId),
    orgContext({ feature: "teams", action: "update" }),
  ])
  return { success: true, data: { crews, staff, canEdit: editor.success } }
}

const crewSchema = z.object({
  id: z.string().min(1).nullable(),
  name: z.string(),
  department: z.enum(PROJECT_DEPARTMENTS).nullable(),
  leadUserId: z.string().min(1).nullable(),
  memberIds: z.array(z.string().min(1)),
})

export async function saveCrewSettings(
  raw: z.input<typeof crewSchema>,
): Promise<{ readonly success: true; readonly id: string } | ActionFailure> {
  const parsed = crewSchema.safeParse(raw)
  if (!parsed.success) return actionFailure("Check the crew's details.")
  const context = await orgContext({ feature: "teams", action: "update", mutation: true })
  if (!context.success) return context
  const { db, organizationId } = context.data
  const input = parsed.data
  const staffIds = new Set((await activeStaff(db, organizationId)).map((person) => person.id))
  const problem = crewInputProblem(input, staffIds)
  if (problem) return actionFailure(problem)
  const id = await saveCrew(db, { ...input, organizationId, now: new Date().toISOString() })
  if (!id) return actionFailure("Another crew already has that name.")
  revalidatePath("/dashboard/settings")
  return { success: true, id }
}

export async function deleteCrewSettings(crewId: string): Promise<{ readonly success: true } | ActionFailure> {
  const context = await orgContext({ feature: "teams", action: "delete", mutation: true })
  if (!context.success) return context
  if (!(await deleteCrew(context.data.db, context.data.organizationId, crewId))) return actionFailure("Crew not found.")
  revalidatePath("/dashboard/settings")
  return { success: true }
}
