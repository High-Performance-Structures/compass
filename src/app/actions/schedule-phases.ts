"use server"

import { and, asc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projects, schedulePhaseOptions, scheduleTasks } from "@/db/schema"
import {
  projectTemplates,
  projectTemplateVersions,
  scheduleTemplateItems,
} from "@/db/schema-templates"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { PHASE_LABELS, PHASE_ORDER } from "@/lib/schedule/phase-colors"

export type ReusableSchedulePhaseOption = {
  readonly id: string | null
  readonly value: string
  readonly label: string
  readonly source: "default" | "saved" | "project" | "template"
}

type PhaseMutationResult =
  | { readonly success: true; readonly option: ReusableSchedulePhaseOption }
  | { readonly success: false; readonly error: string }

function normalizedPhaseName(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function phaseKey(value: string): string {
  return normalizedPhaseName(value).toLocaleLowerCase()
}

function validCustomPhase(value: string):
  | { readonly success: true; readonly name: string; readonly key: string }
  | { readonly success: false; readonly error: string } {
  const name = normalizedPhaseName(value)
  if (name.length === 0) {
    return { success: false, error: "Enter a phase name." }
  }
  if (name.length > 100) {
    return { success: false, error: "Phase names are limited to 100 characters." }
  }
  return { success: true, name, key: phaseKey(name) }
}

async function verifyProject(input: {
  readonly projectId: string
  readonly action: "read" | "update" | "delete"
}): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly userId: string
}> {
  const user = await requireAuth()
  requirePermission(user, "schedule", input.action)
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!project) throw new Error("Project not found or access denied.")
  return { db, organizationId, userId: user.id }
}

export async function getSchedulePhaseOptions(
  projectId: string
): Promise<readonly ReusableSchedulePhaseOption[]> {
  const { db, organizationId } = await verifyProject({
    projectId,
    action: "read",
  })
  const [saved, projectRows, publishedVersions] = await Promise.all([
    db
      .select({ id: schedulePhaseOptions.id, name: schedulePhaseOptions.name })
      .from(schedulePhaseOptions)
      .where(eq(schedulePhaseOptions.organizationId, organizationId))
      .orderBy(asc(schedulePhaseOptions.name)),
    db
      .select({ phase: scheduleTasks.phase })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId)),
    db
      .select({ id: projectTemplateVersions.id })
      .from(projectTemplateVersions)
      .innerJoin(
        projectTemplates,
        eq(projectTemplates.id, projectTemplateVersions.templateId)
      )
      .where(
        and(
          eq(projectTemplates.organizationId, organizationId),
          eq(projectTemplates.lifecycleStatus, "active"),
          eq(projectTemplateVersions.status, "published")
        )
      ),
  ])
  const templateRows =
    publishedVersions.length === 0
      ? []
      : await db
          .select({ phase: scheduleTemplateItems.phase })
          .from(scheduleTemplateItems)
          .where(
            inArray(
              scheduleTemplateItems.versionId,
              publishedVersions.map((version) => version.id)
            )
          )

  const options = new Map<string, ReusableSchedulePhaseOption>()
  for (const phase of PHASE_ORDER) {
    options.set(phaseKey(PHASE_LABELS[phase]), {
      id: null,
      value: phase,
      label: PHASE_LABELS[phase],
      source: "default",
    })
  }
  for (const item of saved) {
    const key = phaseKey(item.name)
    if (!options.has(key)) {
      options.set(key, {
        id: item.id,
        value: item.name,
        label: item.name,
        source: "saved",
      })
    }
  }
  for (const row of projectRows) {
    const name = normalizedPhaseName(row.phase)
    const key = phaseKey(name)
    if (name.length > 0 && !options.has(key)) {
      options.set(key, {
        id: null,
        value: name,
        label: name,
        source: "project",
      })
    }
  }
  for (const row of templateRows) {
    const name = normalizedPhaseName(row.phase)
    const key = phaseKey(name)
    if (name.length > 0 && !options.has(key)) {
      options.set(key, {
        id: null,
        value: name,
        label: name,
        source: "template",
      })
    }
  }
  return [...options.values()]
}

export async function saveSchedulePhaseOption(input: {
  readonly projectId: string
  readonly name: string
}): Promise<PhaseMutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const parsed = validCustomPhase(input.name)
    if (!parsed.success) return parsed
    const defaultPhase = PHASE_ORDER.find(
      (phase) => phaseKey(PHASE_LABELS[phase]) === parsed.key
    )
    if (defaultPhase) {
      return {
        success: true,
        option: {
          id: null,
          value: defaultPhase,
          label: PHASE_LABELS[defaultPhase],
          source: "default",
        },
      }
    }
    const { db, organizationId, userId } = await verifyProject({
      projectId: input.projectId,
      action: "update",
    })
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await db
      .insert(schedulePhaseOptions)
      .values({
        id,
        organizationId,
        name: parsed.name,
        normalizedName: parsed.key,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schedulePhaseOptions.organizationId,
          schedulePhaseOptions.normalizedName,
        ],
        set: { name: parsed.name, updatedAt: now },
      })
    const [saved] = await db
      .select({ id: schedulePhaseOptions.id, name: schedulePhaseOptions.name })
      .from(schedulePhaseOptions)
      .where(
        and(
          eq(schedulePhaseOptions.organizationId, organizationId),
          eq(schedulePhaseOptions.normalizedName, parsed.key)
        )
      )
      .limit(1)
    if (!saved) {
      return { success: false, error: "The reusable phase could not be saved." }
    }
    revalidatePath(`/dashboard/projects/${input.projectId}/schedule`)
    return {
      success: true,
      option: {
        id: saved.id,
        value: saved.name,
        label: saved.name,
        source: "saved",
      },
    }
  } catch (error) {
    console.error("Unable to save reusable schedule phase", error)
    return { success: false, error: "Unable to save the reusable phase." }
  }
}

export async function deleteSchedulePhaseOption(input: {
  readonly projectId: string
  readonly optionId: string
}): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const { db, organizationId } = await verifyProject({
      projectId: input.projectId,
      action: "delete",
    })
    await db
      .delete(schedulePhaseOptions)
      .where(
        and(
          eq(schedulePhaseOptions.id, input.optionId),
          eq(schedulePhaseOptions.organizationId, organizationId)
        )
      )
    revalidatePath(`/dashboard/projects/${input.projectId}/schedule`)
    return { success: true }
  } catch (error) {
    console.error("Unable to delete reusable schedule phase", error)
    return { success: false, error: "Unable to remove the reusable phase." }
  }
}
