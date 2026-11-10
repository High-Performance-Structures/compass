/**
 * Reads behind the selection lead-time warnings (rules in lead-time-rules.ts):
 * today in the company's time zone, the company's warning window and each
 * Selection Phase's due date (Settings > Selections and the job's schedule),
 * and the job's selections whose choices carry a lead time. Read only.
 */
import { asc, eq } from "drizzle-orm"

import { projectFinishSelections, scheduleTasks } from "@/db/schema"
import { projectSelectionChoices } from "@/db/schema-selection-choices"
import { projectSelectionDecisions } from "@/db/schema-selection-decisions"
import { companyTimeZone } from "@/lib/daily-logs/log-followups-server"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { roundDueDate } from "@/lib/selections/rounds"
import type { Db } from "@/lib/server/action-context"
import { dateKeyInTimeZone } from "@/lib/work-calendar"

import { selectionLeadTimeWarning, selectionNeededByDate, type SelectionLeadTimeWarning } from "./lead-time-rules"

export type LeadTimeContext = {
  /** Today in the company's time zone, "YYYY-MM-DD". */
  readonly today: string
  readonly warnDays: number
  /** Each Selection Phase's due date on this job, by round key (null: no schedule match). */
  readonly phaseDueDates: ReadonlyMap<string, string | null>
}

/**
 * The company's warning window and today's date, plus the Selection Phase due
 * dates. Pass `phaseDueDates` when the caller already has them (the round
 * cards) to skip reading the schedule again.
 */
export async function loadLeadTimeContext(
  db: Db,
  input: {
    readonly projectId: string
    readonly organizationId: string
    readonly now?: Date
    readonly phaseDueDates?: ReadonlyMap<string, string | null>
  },
): Promise<LeadTimeContext> {
  const [settings, timeZone] = await Promise.all([
    readFeatureSettings(db, input.organizationId, "selections"),
    companyTimeZone(db, input.organizationId),
  ])
  let phaseDueDates = input.phaseDueDates
  if (!phaseDueDates) {
    const schedule = await db
      .select({ title: scheduleTasks.title, startDate: scheduleTasks.startDate })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, input.projectId))
      .orderBy(asc(scheduleTasks.startDate))
    phaseDueDates = new Map(settings.rounds.map((round) => [round.id, roundDueDate(round, schedule)]))
  }
  return { today: dateKeyInTimeZone(input.now ?? new Date(), timeZone), warnDays: settings.leadTimeWarningDays, phaseDueDates }
}

/** The date a selection is needed by: its own due date, else its Selection Phase's. */
export function neededByFor(context: LeadTimeContext, decisionDueDate: string | null, roundKey: string | null): string | null {
  return selectionNeededByDate(decisionDueDate, roundKey ? (context.phaseDueDates.get(roundKey) ?? null) : null)
}

export type SelectionLeadTimeWarningRow = SelectionLeadTimeWarning & { readonly selectionName: string }

/** The job's selections that need ordering soon (or are already late), one warning each. */
export async function loadSelectionLeadTimeWarnings(
  db: Db,
  projectId: string,
  context: LeadTimeContext,
): Promise<readonly SelectionLeadTimeWarningRow[]> {
  const [selections, choices] = await Promise.all([
    db
      .select({
        id: projectFinishSelections.id,
        name: projectFinishSelections.name,
        status: projectFinishSelections.status,
        roundKey: projectFinishSelections.roundKey,
        decisionDueDate: projectSelectionDecisions.decisionDueDate,
      })
      .from(projectFinishSelections)
      .leftJoin(projectSelectionDecisions, eq(projectSelectionDecisions.selectionId, projectFinishSelections.id))
      .where(eq(projectFinishSelections.projectId, projectId)),
    // Choices with no lead time never warn, but a pick without one still governs its selection.
    db
      .select({
        id: projectSelectionChoices.id,
        selectionId: projectSelectionChoices.selectionId,
        chosen: projectSelectionChoices.chosen,
        status: projectSelectionChoices.status,
        leadTimeDays: projectSelectionChoices.leadTimeDays,
      })
      .from(projectSelectionChoices)
      .where(eq(projectSelectionChoices.projectId, projectId)),
  ])
  const bySelection = new Map<string, (typeof choices)[number][]>()
  for (const choice of choices) {
    const list = bySelection.get(choice.selectionId) ?? []
    list.push(choice)
    bySelection.set(choice.selectionId, list)
  }
  return selections.flatMap((selection) => {
    const warning = selectionLeadTimeWarning({
      selectionId: selection.id,
      status: selection.status,
      neededByDate: neededByFor(context, selection.decisionDueDate, selection.roundKey),
      choices: bySelection.get(selection.id) ?? [],
      today: context.today,
      warnDays: context.warnDays,
    })
    return warning ? [{ ...warning, selectionName: selection.name }] : []
  })
}
