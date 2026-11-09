/**
 * Selection rounds on a job: the round cards (due date from the job's
 * schedule, chosen count, over/under the allowance) and the "ready to
 * finalize" alert. Rounds are the company's (Settings > Selections); a
 * selection joins one through its round_key.
 *
 * When every selection in a round has an owner's pick, project staff get
 * one alert through the shared notifications (in-app, email, push). If a
 * pick is cleared again, the alert record is removed so the next completion
 * alerts again.
 */
import { asc, eq } from "drizzle-orm"

import { projectSelectionRoundAlerts } from "@/db/schema-selection-choices"
import { projects, scheduleTasks } from "@/db/schema"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { SelectionRound } from "@/lib/feature-settings/selection-settings"
import { notifyProjectStaffOfOutsideEvent } from "@/lib/notifications/events"
import { roundDueDate, roundProgress, type RoundProgress } from "@/lib/selections/rounds"
import type { SelectionSheetRow } from "@/lib/selections/sheet"
import type { Db } from "@/lib/server/action-context"

import { loadSelectionSheet } from "./selection-sheet-read"
import { clearRoundAlerts, recordRoundAlert } from "./template-store"

export type RoundCard = RoundProgress & {
  readonly key: string
  readonly name: string
  readonly dueDate: string | null
  /** Staff were already told it is ready to finalize. */
  readonly alerted: boolean
}

function cards(
  rounds: readonly SelectionRound[],
  rows: readonly SelectionSheetRow[],
  schedule: readonly { readonly title: string; readonly startDate: string }[],
  alerted: ReadonlySet<string>,
): readonly RoundCard[] {
  const selections = rows.map((row) => ({ roundKey: row.roundKey, hasPick: row.pickTitle !== null, deltaCents: row.deltaCents }))
  return rounds.map((round) => ({
    key: round.id,
    name: round.name,
    dueDate: roundDueDate(round, schedule),
    alerted: alerted.has(round.id),
    ...roundProgress(round.id, selections),
  }))
}

/** The company's rounds as cards for this job, in release order. */
export async function loadRoundCards(
  db: Db,
  projectId: string,
  organizationId: string,
  rows?: readonly SelectionSheetRow[],
): Promise<readonly RoundCard[]> {
  const [settings, sheet, schedule, alerts] = await Promise.all([
    readFeatureSettings(db, organizationId, "selections"),
    rows ? Promise.resolve(rows) : loadSelectionSheet(db, projectId),
    db
      .select({ title: scheduleTasks.title, startDate: scheduleTasks.startDate })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId))
      .orderBy(asc(scheduleTasks.startDate)),
    db.select({ roundKey: projectSelectionRoundAlerts.roundKey }).from(projectSelectionRoundAlerts).where(eq(projectSelectionRoundAlerts.projectId, projectId)),
  ])
  return cards(settings.rounds, sheet, schedule, new Set(alerts.map((alert) => alert.roundKey)))
}

/**
 * After a pick or a round assignment changes: alert staff once for each
 * round that just became complete, and forget alerts for rounds that no
 * longer are. A notification failure is logged; the pick is already saved.
 */
export async function checkRoundsReady(db: Db, projectId: string, actorUserId: string | null): Promise<void> {
  try {
    const project = await db.select({ organizationId: projects.organizationId, name: projects.name }).from(projects).where(eq(projects.id, projectId)).get()
    if (!project?.organizationId) return
    const organizationId = project.organizationId
    const rounds = await loadRoundCards(db, projectId, organizationId)
    await clearRoundAlerts(db, projectId, rounds.filter((round) => !round.ready && round.alerted).map((round) => round.key))
    const now = new Date().toISOString()
    // Usually one round at a time; each needs its own guarded insert before its alert.
    for (const round of rounds.filter((item) => item.ready && !item.alerted)) {
      // One alert per round: the insert only succeeds for the first caller.
      if (!(await recordRoundAlert(db, projectId, round.key, now))) continue
      await notifyProjectStaffOfOutsideEvent({
        organizationId,
        projectId,
        eventType: "selection_round_ready",
        sourceType: "selection_round",
        sourceId: `${projectId}:${round.key}`,
        title: `${round.name} selections ready to finalize`,
        body: `Every selection in ${round.name} on ${project.name} has the owner's pick (${round.chosen} of ${round.total}). Review the picks and finalize the round.`,
        href: `/dashboard/projects/${encodeURIComponent(projectId)}/selections`,
        priority: "high",
        ownerUserId: null,
      })
    }
  } catch (error) {
    console.error("[selections] round readiness check failed", { projectId, actorUserId, error })
  }
}
