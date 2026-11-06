/**
 * The code defaults for each record type's statuses: the built-in statuses
 * Compass code depends on, in workflow order, with their default label,
 * color, group and filter button. A company's Settings › Statuses rows are
 * merged over these (./rules.ts). With no company rows, every list behaves
 * exactly as these defaults say. Pure: no database access, safe in the
 * browser.
 *
 * Adding a record type is one entry here (plus its key in
 * RECORD_STATUS_TYPES). `records` says where its records keep their status,
 * so Settings can tell whether a company-added status is in use.
 */
import { PROJECT_TODO_RECORD_TYPES } from "@/lib/project-todos"

import type { RecordStatusColor, RecordStatusGroup, RecordStatusType } from "./statuses"

type RecordStatusDefault = {
  readonly key: string
  readonly label: string
  readonly color: RecordStatusColor
  readonly group: RecordStatusGroup
}

/** Where a record type's rows keep their status (both tables reach the organization through the project). */
type RecordStatusStorage =
  | { readonly table: "project_operations"; readonly sourceRecordTypes: readonly string[] }
  | { readonly table: "project_rfis" }

export type RecordStatusTypeDefinition = {
  /** The record type's name in Settings, plural ("Purchase orders"). */
  readonly label: string
  /** The built-in statuses, in workflow order. */
  readonly statuses: readonly RecordStatusDefault[]
  /** Stored spellings (normalized) that mean one of the built-in statuses. */
  readonly aliases: Readonly<Record<string, string>>
  /**
   * The built-in status an unknown stored value is read as. Without one, an
   * unknown value keeps its own text and counts as open.
   */
  readonly unknownKey?: string
  readonly records: RecordStatusStorage
}

const status = (key: string, label: string, color: RecordStatusColor, group: RecordStatusGroup): RecordStatusDefault => ({
  key,
  label,
  color,
  group,
})

export const RECORD_STATUS_REGISTRY: Readonly<Record<RecordStatusType, RecordStatusTypeDefinition>> = {
  purchase_order: {
    label: "Purchase orders",
    statuses: [
      status("draft", "Draft", "gray", "open"),
      status("approved", "Approved", "green", "open"),
      status("sent", "Sent", "blue", "open"),
      status("ordered", "Ordered", "blue", "open"),
      status("partially_received", "Partially received", "orange", "open"),
      status("received", "Received", "orange", "open"),
      status("complete", "Complete", "gray", "closed"),
      status("closed", "Closed", "gray", "closed"),
      status("void", "Void", "red", "void"),
    ],
    aliases: {
      completed: "complete",
      archived: "closed",
      declined: "closed",
      voided: "void",
      cancelled: "void",
      canceled: "void",
    },
    records: { table: "project_operations", sourceRecordTypes: ["purchase_order"] },
  },
  rfq: {
    label: "RFQs",
    statuses: [
      status("draft", "Draft", "gray", "open"),
      status("sent", "Sent", "blue", "open"),
      status("response_received", "Response received", "orange", "open"),
      status("awarded", "Awarded", "green", "closed"),
      status("declined", "Declined", "gray", "closed"),
      status("complete", "Complete", "gray", "closed"),
      status("closed", "Closed", "gray", "closed"),
      status("void", "Void", "red", "void"),
    ],
    aliases: { completed: "complete", cancelled: "void", canceled: "void", voided: "void" },
    records: { table: "project_operations", sourceRecordTypes: ["rfq"] },
  },
  rfi: {
    label: "RFIs",
    statuses: [
      status("new", "New", "blue", "open"),
      status("in_progress", "In progress", "green", "open"),
      status("info_needed", "Info needed", "orange", "open"),
      status("complete", "Complete", "gray", "closed"),
      status("void", "Void", "red", "void"),
    ],
    aliases: {
      open: "new",
      answered: "in_progress",
      additional_information_needed: "info_needed",
      closed: "complete",
      completed: "complete",
      cancelled: "void",
      canceled: "void",
    },
    unknownKey: "new",
    records: { table: "project_rfis" },
  },
  todo: {
    label: "To-dos",
    statuses: [
      status("open", "Open", "blue", "open"),
      status("in_progress", "In progress", "green", "open"),
      status("blocked", "Blocked", "orange", "open"),
      status("complete", "Complete", "gray", "closed"),
      status("archived", "Archived", "gray", "void"),
    ],
    aliases: {
      archive: "archived",
      cancelled: "archived",
      completed: "complete",
      closed: "complete",
      done: "complete",
      on_hold: "blocked",
    },
    unknownKey: "open",
    records: { table: "project_operations", sourceRecordTypes: PROJECT_TODO_RECORD_TYPES },
  },
}
