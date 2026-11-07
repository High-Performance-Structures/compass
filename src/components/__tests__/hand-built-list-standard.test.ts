import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * ui-standards.md "Record lists": a list that grows (records, people,
 * entries) is a sheet on the shared record table (`useRecordTable` /
 * `useServerRecordTable`) with a registered sheetId. Line items inside one
 * record reorder with `SortableRows` (line-order-standard.test.ts).
 *
 * Any other file that builds its own table, with `<table>`, `<Table>` or
 * TanStack's `useReactTable`, must be listed below with the reason it is not
 * a growing list. "growing list" entries are older lists still waiting to move
 * to the shared sheet: the ceiling below only goes down.
 */

const ROOT = process.cwd()

type Reason =
  /** A printed record or Print Preview page. */
  | "document"
  /** A read-only summary, comparison or calculator for one record or job. */
  | "report"
  /** Rows inside one record that do not reorder (fixed items, allocations). */
  | "line items"
  /** A company setting edited as a grid. */
  | "settings grid"
  /** A schedule chart or calendar grid. */
  | "chart grid"
  /** Rows of an upload or import, checked before they are saved. */
  | "import preview"
  /** Folder and file browsing, which follows the Drive layout. */
  | "file browser"
  /** An older growing list that still needs the shared record table. */
  | "growing list"

/** Shared table code: the record table itself and the table primitive. */
const TABLE_HOMES = new Set([
  "src/components/record-table.tsx",
  "src/components/use-server-record-table.ts",
  "src/components/ui/table.tsx",
])

const HAND_BUILT_TABLES: Readonly<Record<string, Reason>> = {
  "src/app/dashboard/office-maintenance/buildertrend-cutover/page.tsx": "report",
  "src/components/financials/sage-export-preview.tsx": "report",
  "src/components/nutech/bracing-inventory.tsx": "report",
  "src/components/nutech/nutech-truckload-calculator.tsx": "report",
  "src/components/projects/project-budget-panel.tsx": "report",
  "src/components/projects/project-estimate-report-phases.tsx": "report",
  "src/components/projects/project-estimate-version-comparison.tsx": "report",
  "src/components/projects/shop-ticket-sage-hours.tsx": "report",

  "src/components/projects/deposit-request-document.tsx": "document",
  "src/components/projects/pay-application-client-report.tsx": "document",
  "src/components/projects/purchase-order-document.tsx": "document",
  "src/components/projects/shop-ticket-document.tsx": "document",
  "src/components/schedule/schedule-print-document.tsx": "document",

  "src/components/financials/record-payment-dialog.tsx": "line items",
  "src/components/nutech/nutech-bracing-rentals.tsx": "line items",
  "src/components/nutech/nutech-order-invoices.tsx": "line items",
  "src/components/nutech/nutech-order-workspace.tsx": "line items",
  "src/components/projects/estimate-pricing-board.tsx": "line items",
  "src/components/projects/estimate-version-acceptance-fields.tsx": "line items",
  "src/components/projects/pay-application-shop-tickets.tsx": "line items",
  "src/components/projects/project-change-order-version-lines.tsx": "line items",
  // Logs from before the duty log, each waiting for a duty; the entries themselves are the sheet above it.
  "src/components/projects/duty-log-workspace.tsx": "line items",

  "src/components/settings/daily-log-settings-section.tsx": "settings grid",
  "src/components/settings/estimate-pricing-settings-section.tsx": "settings grid",
  "src/components/settings/estimate-settings-section.tsx": "settings grid",
  "src/components/settings/linked-job-settings-section.tsx": "settings grid",
  "src/components/settings/paper-trail-choices.tsx": "settings grid",
  "src/components/settings/permissions-tab.tsx": "settings grid",
  "src/components/settings/portfolio-map-settings-section.tsx": "settings grid",
  "src/components/settings/project-aging-settings-section.tsx": "settings grid",
  "src/components/settings/rate-book-tab.tsx": "settings grid",
  "src/components/settings/record-statuses-tab.tsx": "settings grid",
  "src/components/settings/trade-doc-info-sheet-settings.tsx": "settings grid",
  "src/components/settings/trade-doc-settings-section.tsx": "settings grid",

  "src/components/projects/project-audience-gantt.tsx": "chart grid",
  "src/components/schedule/schedule-baseline-view.tsx": "chart grid",
  "src/components/schedule/schedule-gantt/gantt-task-table.tsx": "chart grid",

  "src/components/projects/project-estimate-buildertrend-import.tsx": "import preview",
  "src/components/projects/project-estimate-planswift-import-client.tsx": "import preview",
  "src/components/settings/trade-doc-import-dialog.tsx": "import preview",

  "src/components/files/file-list.tsx": "file browser",
  "src/components/files/project-file-groups.tsx": "file browser",

  "src/components/client-follow-up/client-follow-up-board.tsx": "growing list",
  "src/components/contacts/internal-contacts-table.tsx": "growing list",
  "src/components/contacts/unassigned-people-table.tsx": "growing list",
  "src/components/equipment/equipment-workspace.tsx": "growing list",
  "src/components/financials/entity-table.tsx": "growing list",
  "src/components/financials/square-receipts-table.tsx": "growing list",
  "src/components/nutech/nutech-catalog-workspace.tsx": "growing list",
  "src/components/people-table.tsx": "growing list",
  "src/components/projects/project-estimate-list.tsx": "growing list",
  "src/components/projects/project-historical-rfq-list.tsx": "growing list",
  "src/components/projects/project-warranty-source-review.tsx": "growing list",
  "src/components/projects/recurring-duties-board.tsx": "growing list",
  "src/components/projects/shop-tickets-workspace.tsx": "growing list",
  "src/components/projects/trade-letters-section.tsx": "growing list",
  "src/components/projects/use-archive-pagination.ts": "growing list",
  "src/components/schedule/schedule-list-view.tsx": "growing list",
  "src/components/schedule/workday-exceptions-view.tsx": "growing list",
  "src/components/settings/account-deletion-requests-card.tsx": "growing list",
  "src/components/settings/invite-links-section.tsx": "growing list",
}

/** Older growing lists still on hand-built tables. Lower it when one moves to the shared sheet; never raise it. */
const GROWING_LIST_CEILING = 19

const HAND_BUILT = /<table\b|<Table\b|\buseReactTable\(/

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__tests__" || entry === "node_modules") return []
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

const files = [...sourceFiles(join(ROOT, "src/components")), ...sourceFiles(join(ROOT, "src/app"))]
  .map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }))

/** Hand-built tables outside the shared homes, except line editors on the shared reorder control. */
const handBuilt = files.filter((file) =>
  !TABLE_HOMES.has(file.path) &&
  HAND_BUILT.test(file.text) &&
  !/\bSortableRows\b/.test(file.text) &&
  !/\buse(?:Server)?RecordTable\(/.test(file.text),
)

describe("hand-built list standard", () => {
  it("puts every new table on the shared record table, or lists why it is not a growing list", () => {
    const unlisted = handBuilt.map((file) => file.path).filter((path) => !(path in HAND_BUILT_TABLES))
    expect(
      unlisted,
      "A growing list uses useRecordTable with a registered sheetId (ui-standards.md \"Record lists\"). Anything else: add it to HAND_BUILT_TABLES with its reason.",
    ).toEqual([])
  })

  it("holds the older growing lists to the ceiling", () => {
    const growing = Object.values(HAND_BUILT_TABLES).filter((reason) => reason === "growing list").length
    // Above: move the new list to useRecordTable instead. Below: one moved, so lower the ceiling to match.
    expect(growing, "Growing lists on hand-built tables must equal GROWING_LIST_CEILING.").toBe(GROWING_LIST_CEILING)
  })

  it("drops entries for files that no longer build their own table", () => {
    const current = new Set(handBuilt.map((file) => file.path))
    // A file listed here that now uses the shared sheet, or was deleted, comes off the list (and the ceiling comes down).
    expect(Object.keys(HAND_BUILT_TABLES).filter((path) => !current.has(path))).toEqual([])
  })
})
