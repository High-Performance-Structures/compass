import { z } from "zod/v4"

import { DAILY_LOG_TODO_MODES, DAILY_LOG_TODO_TYPES } from "@/lib/daily-logs/log-followups"

/*
 * Settings › Daily logs › To-dos and client contact: how daily logs create,
 * work on and complete to-dos and record client contact, in the browser and
 * in Field Mode. Pure and client-safe.
 */

/** How daily logs create and update to-dos and record client contact. */
export const dailyLogFollowUpSettingsSchema = z.object({
  /** Issue and next-step lines: the crew flags them ("ask"), every line ("auto") or none ("off"). */
  todoMode: z.enum(DAILY_LOG_TODO_MODES),
  /** To-do kinds the crew may create from a log. */
  todoTypes: z.array(z.enum(DAILY_LOG_TODO_TYPES)).max(DAILY_LOG_TODO_TYPES.length),
  /** Ticking an Open to-do on a log moves it to In progress. */
  workedMovesToInProgress: z.boolean(),
  /** The crew can mark a to-do Completed on a log; it moves to the company's done status when the log saves. */
  todosCanComplete: z.boolean(),
  /** Blocked to-dos ask "still blocked?" on the next log. */
  carryBlocked: z.boolean(),
  /** To-dos carry a cost code. */
  todoCostCodes: z.boolean(),
  /** Ticking a to-do with a cost code adds a cost code line for its hours. */
  tickAddsLine: z.boolean(),
  /** The crew picks the cost code on a new to-do; off leaves it to the office. */
  crewPicksCostCode: z.boolean(),
  /** Ask "Is it finished?" once a to-do was worked on in this many logs and is still open. */
  finishNudgeAfterLogs: z.number().int().min(1).max(30),
  /** Show "Client contact" on daily logs. */
  clientContact: z.boolean(),
  /** Suggest it when Visitors names a client contact. */
  clientContactSuggest: z.boolean(),
})

export type DailyLogFollowUpSettings = z.infer<typeof dailyLogFollowUpSettingsSchema>

const DEFAULT_DAILY_LOG_FOLLOW_UP_SETTINGS: DailyLogFollowUpSettings = {
  todoMode: "ask",
  todoTypes: [...DAILY_LOG_TODO_TYPES],
  workedMovesToInProgress: true,
  todosCanComplete: true,
  carryBlocked: true,
  todoCostCodes: true,
  tickAddsLine: true,
  crewPicksCostCode: true,
  finishNudgeAfterLogs: 3,
  clientContact: true,
  clientContactSuggest: true,
}

export const DAILY_LOG_FOLLOW_UP_SETTINGS_GROUP = {
  label: "Daily log to-dos and client contact",
  description: "How daily logs create, work on and complete to-dos and record client contact, in the browser and in Field Mode.",
  defaults: DEFAULT_DAILY_LOG_FOLLOW_UP_SETTINGS,
  schema: dailyLogFollowUpSettingsSchema,
}
