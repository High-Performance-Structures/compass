import { z } from "zod/v4"

import type {
  OwnerUpdateScheduleSelection,
  OwnerUpdateTodoSelection,
} from "@/lib/owner-updates/snapshot"

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const scheduleSelectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string(),
  startDate: z.string().regex(ISO_DATE_PATTERN),
  endDate: z.string().regex(ISO_DATE_PATTERN),
  assignedTo: z.string().nullable(),
  status: z.string(),
  percentComplete: z.number().min(0).max(100),
  notes: z.string(),
})

const todoSelectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  priority: z.string(),
  assigneeName: z.string().nullable(),
  companyName: z.string().nullable(),
  dueDate: z.string().nullable(),
  timing: z.union([z.literal("reporting_period"), z.literal("upcoming")]),
  notes: z.string(),
})

export const ownerUpdateDraftEditSchema = z.object({
  title: z.string(),
  updateDate: z.string(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  summary: z.string(),
  sourceDailyLogIds: z.array(z.string()).default([]),
  selectedPhotoIds: z.array(z.string()).default([]),
  selectedDocumentIds: z.array(z.string()).default([]),
  completedScheduleItems: z.array(scheduleSelectionSchema).default([]),
  lookAheadScheduleItems: z.array(scheduleSelectionSchema).default([]),
  todos: z.array(todoSelectionSchema).default([]),
})

const ownerUpdateDraftBackupSchema = z.object({
  version: z.literal(1),
  savedAt: z.string(),
  serverUpdatedAt: z.string(),
  draft: ownerUpdateDraftEditSchema,
})

export type OwnerUpdateDraftEdit = {
  readonly title: string
  readonly updateDate: string
  readonly periodStart: string
  readonly periodEnd: string
  readonly summary: string
  readonly sourceDailyLogIds: readonly string[]
  readonly selectedPhotoIds: readonly string[]
  readonly selectedDocumentIds: readonly string[]
  readonly completedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly lookAheadScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly todos: readonly OwnerUpdateTodoSelection[]
}

export type OwnerUpdateDraftBackup = {
  readonly version: 1
  readonly savedAt: string
  readonly serverUpdatedAt: string
  readonly draft: OwnerUpdateDraftEdit
}

export function parseOwnerUpdateDraftEdit(
  value: unknown
):
  | { readonly success: true; readonly data: OwnerUpdateDraftEdit }
  | { readonly success: false } {
  const result = ownerUpdateDraftEditSchema.safeParse(value)
  if (!result.success) return { success: false }

  return {
    success: true,
    data: {
      title: result.data.title,
      updateDate: result.data.updateDate,
      periodStart: result.data.periodStart ?? result.data.updateDate,
      periodEnd: result.data.periodEnd ?? result.data.updateDate,
      summary: result.data.summary,
      sourceDailyLogIds: result.data.sourceDailyLogIds,
      selectedPhotoIds: result.data.selectedPhotoIds,
      selectedDocumentIds: result.data.selectedDocumentIds,
      completedScheduleItems: result.data.completedScheduleItems,
      lookAheadScheduleItems: result.data.lookAheadScheduleItems,
      todos: result.data.todos,
    },
  }
}

export function ownerUpdateDraftStorageKey(
  userId: string,
  projectId: string,
  updateId: string
): string {
  return `compass:owner-update-draft:${userId}:${projectId}:${updateId}`
}

export function serializeOwnerUpdateDraftBackup(input: {
  readonly draft: OwnerUpdateDraftEdit
  readonly serverUpdatedAt: string
  readonly savedAt?: string
}): string {
  return JSON.stringify({
    version: 1,
    savedAt: input.savedAt ?? new Date().toISOString(),
    serverUpdatedAt: input.serverUpdatedAt,
    draft: input.draft,
  })
}

export function parseRecoverableOwnerUpdateDraft(
  value: string | null,
  currentServerUpdatedAt: string
): OwnerUpdateDraftBackup | null {
  if (value === null || value.trim().length === 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }

  const result = ownerUpdateDraftBackupSchema.safeParse(parsed)
  if (!result.success) return null

  const draftResult = parseOwnerUpdateDraftEdit(result.data.draft)
  if (!draftResult.success) return null

  if (
    !Number.isFinite(Date.parse(result.data.savedAt)) ||
    result.data.serverUpdatedAt !== currentServerUpdatedAt
  ) {
    return null
  }

  return {
    version: result.data.version,
    savedAt: result.data.savedAt,
    serverUpdatedAt: result.data.serverUpdatedAt,
    draft: draftResult.data,
  }
}
