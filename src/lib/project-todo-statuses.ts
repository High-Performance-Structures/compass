/**
 * What a to-do's status means, read through the company's to-do statuses
 * (Settings › Statuses): a status that counts as Closed is completed, one
 * that counts as Void is archived, and the rest are active. Pure.
 *
 * Workflow steps that move a to-do between built-in statuses (worked on a
 * daily log moves "open" to "in_progress"; done is ticked by a person and
 * saves "complete"; archive and restore save "archived" and "open") stay
 * keyed on those built-in keys.
 */
import { recordStatusGroup, type RecordStatusList } from "@/lib/domain/record-statuses/rules"

export function isArchivedTodoStatus(statuses: RecordStatusList, status: string): boolean {
  return recordStatusGroup(statuses, status) === "void"
}

export function isCompletedTodoStatus(statuses: RecordStatusList, status: string): boolean {
  return recordStatusGroup(statuses, status) === "closed"
}
