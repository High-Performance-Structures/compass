/**
 * The shape of one status-column check in the drift detector's registry
 * (./status-checks.ts). A domain module that owns its tables for reads
 * (identity, for one) declares its own entry with these types and the
 * registry lists it, so the table is named only inside its owner.
 */
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

import type { RecordStatusType } from "@/lib/domain/record-statuses/statuses"

/** What the detector needs from a declared machine (src/lib/shared/state-machine.ts). */
export type DeclaredMachine = {
  readonly name: string
  readonly states: readonly string[]
}

/**
 * How a row reaches its company: its own organization column, its project's,
 * or its schedule item's project. The first one present wins; with none, or
 * all null, the row belongs to no company and every company sees it.
 */
export type StatusCheckOwner = {
  readonly organization?: AnySQLiteColumn
  readonly project?: AnySQLiteColumn
  readonly scheduleTask?: AnySQLiteColumn
}

/** Which rows of the table the machine governs; omitted for every row. */
export type StatusCheckScope =
  | { readonly column: AnySQLiteColumn; readonly equals: readonly string[] }
  | { readonly column: AnySQLiteColumn; readonly isNotNull: true }

export type StatusCheck =
  /** The machine lists every value the column may hold. */
  | {
      readonly kind: "machine"
      readonly machine: DeclaredMachine
      readonly column: AnySQLiteColumn
      readonly owner: StatusCheckOwner
      readonly scope?: StatusCheckScope
    }
  /**
   * The machine covers only Compass's automatic moves; staff may also pick
   * any of their company's statuses for the record type (Settings ›
   * Statuses), in any spelling that list reads as one of them.
   */
  | {
      readonly kind: "company_statuses"
      readonly machine: DeclaredMachine
      readonly recordType: RecordStatusType
      readonly column: AnySQLiteColumn
      readonly owner: StatusCheckOwner
      readonly scope: StatusCheckScope
    }
  /** The machine's state is worked out from other columns, so no stored value can drift. */
  | { readonly kind: "not_stored"; readonly machine: DeclaredMachine; readonly reason: string }
