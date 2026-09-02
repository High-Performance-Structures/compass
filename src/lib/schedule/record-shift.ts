import type { getDb } from "@/db"
import type { AuthUser } from "@/lib/auth"
import { recordActivityEvent } from "@/lib/activity-log"
import { notifyScheduleEndDateExtended } from "@/lib/notifications/events"
import type { ScheduleShiftSummary } from "@/lib/schedule/shift-tracking"

type RecordScheduleShiftInput = {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string
  readonly actor: AuthUser
  readonly sourceType: string
  readonly sourceId: string | null
  readonly sourceLabel: string
  readonly reason: string
  readonly summary: ScheduleShiftSummary
}

export async function recordScheduleShift(
  input: RecordScheduleShiftInput
): Promise<void> {
  if (input.summary.affectedItemCount === 0) return

  await recordActivityEvent({
    db: input.db,
    organizationId: input.organizationId,
    projectId: input.projectId,
    actor: input.actor,
    category: "schedule",
    action: "schedule.shift_recorded",
    entityType: input.sourceType,
    entityId: input.sourceId,
    summary: `Recorded schedule shift for ${input.sourceLabel}: ${input.reason}`,
    metadata: {
      reason: input.reason,
      affectedItemCount: input.summary.affectedItemCount,
      previousProjectEnd: input.summary.previousProjectEnd,
      nextProjectEnd: input.summary.nextProjectEnd,
      extendsProjectEnd: input.summary.extendsProjectEnd,
    },
  })

  if (
    !input.summary.extendsProjectEnd ||
    input.summary.previousProjectEnd === null ||
    input.summary.nextProjectEnd === null
  ) {
    return
  }

  try {
    await notifyScheduleEndDateExtended({
      organizationId: input.organizationId,
      projectId: input.projectId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      previousProjectEnd: input.summary.previousProjectEnd,
      nextProjectEnd: input.summary.nextProjectEnd,
      reason: input.reason,
      changedBy: input.actor,
    })
  } catch (error) {
    // The schedule mutation and durable activity history are already saved.
    // Keep the user's edit successful while surfacing delivery failures.
    console.error("Unable to notify project administrators of schedule extension", error)
  }
}
