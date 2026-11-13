/**
 * What Compass itself may do to a to-do's status (issue #1329, phase 2).
 * Pure: no database access.
 *
 * Staff pick any of their company's to-do statuses by hand (Settings ›
 * Statuses), and a person ticks a to-do done; nothing here limits that. This
 * machine covers only the moves a saved daily log makes as a side effect:
 *
 *   open ──start──▶ in_progress          worked on (company setting)
 *   blocked ──unblock──▶ in_progress     the log says the block is cleared
 *   open | in_progress | blocked ──complete──▶ complete
 *                                        the log's explicit Completed sign-off
 *                                        (a blocked to-do is unblocked first, so
 *                                        its history records the block cleared)
 *
 * Done stays a person's decision: "complete" is only reached through the
 * sign-off someone ticks on the log, never from plain "worked on". Archived,
 * complete and company-added statuses are never moved by automation. The
 * store (store.ts) applies a log's moves as one compare-and-set write on the
 * status the log read, so a to-do changed meanwhile is left as staff set it.
 */
import { defaultRecordStatusList, recordStatusExactKey } from "@/lib/domain/record-statuses/rules"
import { RECORD_STATUS_REGISTRY } from "@/lib/domain/record-statuses/registry"
import { defineMachine, nextState } from "@/lib/shared/state-machine"
import { isListValue } from "@/lib/shared/statuses"

export const todoAutomation = defineMachine({
  name: "to-do status automation",
  states: ["open", "in_progress", "blocked", "complete"],
  initial: "open",
  terminal: ["complete"],
  transitions: {
    start: { from: ["open"], to: "in_progress" },
    unblock: { from: ["blocked"], to: "in_progress" },
    complete: { from: ["open", "in_progress", "blocked"], to: "complete" },
  },
})

export type TodoAutomationEvent = keyof typeof todoAutomation.transitions

/** The built-in to-do status a stored value really is (its key or a known spelling), or null. */
function builtInKey(stored: string): string | null {
  return recordStatusExactKey(defaultRecordStatusList("todo"), stored)
}

/**
 * The status `event` moves a to-do with stored status `stored` to, or null
 * when the machine doesn't allow it from there (the to-do is left as it is).
 */
export function automaticTodoStatusAfter(event: TodoAutomationEvent, stored: string): string | null {
  const key = builtInKey(stored)
  if (!isListValue(todoAutomation.states, key)) return null
  const next = nextState(todoAutomation, key, event)
  return next.ok ? next.to : null
}

/** Where `events`, applied in order, take a to-do from `stored`; null when any of them isn't allowed. */
export function automaticTodoStatusAfterEvents(events: readonly TodoAutomationEvent[], stored: string): string | null {
  let status: string | null = stored
  for (const event of events) {
    if (status === null) return null
    status = automaticTodoStatusAfter(event, status)
  }
  return status
}

/**
 * Every stored spelling of the status the moves were decided from: its key,
 * the registry aliases for it, and `stored` itself ("Open"). The store's
 * compare-and-set matches these exactly; empty for a status automation
 * never moves.
 */
export function automaticTodoSourceSpellings(stored: string): readonly string[] {
  const key = builtInKey(stored)
  if (!isListValue(todoAutomation.states, key)) return []
  const aliases = Object.entries(RECORD_STATUS_REGISTRY.todo.aliases)
    .filter(([, aliasKey]) => aliasKey === key)
    .map(([alias]) => alias)
  return [...new Set([key, ...aliases, stored])]
}
