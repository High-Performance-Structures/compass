import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { ColumnDef } from "@tanstack/react-table"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { internalContactColumns } from "@/components/contacts/internal-contacts-table"
import { participantReviewColumns } from "@/components/contacts/participant-review-table"
import { unassignedPeopleColumns } from "@/components/contacts/unassigned-people-table"
import { peopleColumns } from "@/components/people-table"
import { accountDeletionRequestColumns } from "@/components/settings/account-deletion-requests-card"
import { inviteLinkColumns } from "@/components/settings/invite-links-section"
import { customerColumns } from "@/components/financials/customers-table"
import { billedItemColumns, receivedPaymentColumns } from "@/components/financials/received-payments-panel"
import { invoiceColumns } from "@/components/financials/project-invoices-table"
import { vendorColumns } from "@/components/financials/vendors-table"
import { conversationColumns } from "@/components/correspondence/correspondence-inbox-columns"
import { dailyLogColumns } from "@/components/projects/daily-log/daily-log-record-table"
import { dutyLogColumns } from "@/components/projects/duty-log-record-table"
import { changeOrderColumns } from "@/components/projects/project-change-order-record-table"
import { financialQueueColumns } from "@/components/projects/project-financial-queue-table"
import { rfiColumns } from "@/components/projects/project-rfi-record-table"
import { rfqColumns } from "@/components/projects/project-rfq-record-table"
import { projectTodoColumns } from "@/components/projects/project-todo-table-columns"
import { purchaseOrderColumns } from "@/components/purchase-orders/purchase-order-record-table"
import { CUSTOMER_SORT_IDS, VENDOR_SORT_IDS } from "@/lib/domain/contacts/directory-page"
import { REVIEW_SORT_IDS } from "@/lib/domain/conversations/imported-participant-review"
import { recurringDutyColumns } from "@/components/projects/recurring-duties-board"
import { scheduleListColumns } from "@/components/schedule/schedule-list-columns"
import { workdayExceptionColumns } from "@/components/schedule/workday-exceptions-view"
import { DEFAULT_DISPLAY_COLOR_PALETTE } from "@/lib/schedule/appearance"
import { boardColumns as nuTechOrderColumns } from "@/components/nutech/nutech-order-board"
import { followUpJobColumns } from "@/components/client-follow-up/client-follow-up-board"
import { machineColumns, machineLogEntryColumns } from "@/components/equipment/equipment-workspace"
import { creditMemoColumns } from "@/components/financials/credit-memos-table"
import { financialInvoiceColumns } from "@/components/financials/invoices-table"
import { paymentColumns } from "@/components/financials/payments-table"
import { squareReceiptColumns } from "@/components/financials/square-receipts-table"
import { vendorBillColumns } from "@/components/financials/vendor-bills-table"
import { catalogProductColumns } from "@/components/nutech/nutech-catalog-workspace"
import type { NuTechCatalogWorkspace } from "@/app/actions/nutech-catalog"
import { estimateColumns } from "@/components/projects/project-estimate-list"
import { shopTicketColumns } from "@/components/projects/shop-tickets-workspace"
import { tradeLetterColumns } from "@/components/projects/trade-letters-section"
import { warrantySourceColumns } from "@/components/projects/project-warranty-source-review"
import { archiveEditionColumns } from "@/components/projects/project-archive-library"
import { defaultRecordStatusList } from "@/lib/domain/record-statuses/rules"
import { LIST_SHEETS } from "@/lib/domain/settings/list-sheet-registry"

/*
 * ui-standards.md "Record lists": every sheet on the shared record table
 * registers a sheetId, so its columns follow company and personal settings.
 */

const ROOT = process.cwd()
const HOOK_HOMES = new Set(["src/components/record-table.tsx", "src/components/use-server-record-table.ts"])

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
  .filter((file) => !HOOK_HOMES.has(file.path))

describe("list sheet standard", () => {
  it("passes a sheetId to every shared record table", () => {
    const missing = files.flatMap((file) => {
      const calls = file.text.match(/\buse(?:Server)?RecordTable\(/g)?.length ?? 0
      const sheets = file.text.match(/\bsheetId:/g)?.length ?? 0
      return calls > sheets ? [`${file.path}: ${calls} table(s), ${sheets} sheetId(s)`] : []
    })
    expect(missing, "Register the sheet in src/lib/domain/settings/list-sheet-registry.ts and pass its sheetId.").toEqual([])
  })

  it("passes sheet ids as literals, never bare or undefined", () => {
    const tableFiles = files.filter((file) => /\buse(?:Server)?RecordTable\(/.test(file.text))
    const loose = tableFiles.flatMap((file) => [
      ...[...file.text.matchAll(/\bsheetId\s*[,}]/g)].map(() => `${file.path}: shorthand sheetId`),
      ...[...file.text.matchAll(/\bsheetId:\s*([^\n,}]+)/g)].flatMap((match) => {
        const value = match[1] ?? ""
        // Only string literals may remain once ternary conditions (`audience === "staff" ?`, `allJobs ?`) are removed.
        const rest = value.replace(/[\w.]+\s*[=!]==\s*"[^"]*"/g, "").replace(/[\w.]+\s*\?/g, "?").replace(/"[^"]*"/g, "").replace(/[?:\s()]/g, "")
        return rest === "" && /"/.test(value) ? [] : [`${file.path}: sheetId: ${value.trim()}`]
      }),
    ])
    expect(loose).toEqual([])
  })

  it("uses only registered sheet ids", () => {
    const registered = new Set(LIST_SHEETS.map((sheet) => sheet.id))
    const unknown = files.flatMap((file) =>
      [...file.text.matchAll(/\bsheetId:\s*([^\n,}]+)/g)].flatMap((match) =>
        // Literals compared against (`audience === "staff" ? ...`) are not sheet ids.
        [...(match[1] ?? "").matchAll(/"([^"]*)"/g)]
          .filter((literal) => !/[=!]==\s*$/.test((match[1] ?? "").slice(0, literal.index)))
          .map((literal) => literal[1] ?? "")
          .filter((id) => !registered.has(id))
          .map((id) => `${file.path}: ${id}`),
      ),
    )
    expect(unknown).toEqual([])
  })

  it("matches each registered sheet's table columns and sortability", () => {
    const noop = (): void => undefined
    const catalogWorkspace: NuTechCatalogWorkspace = { canImport: true, canDelete: true, versions: [], activeVersionId: null, products: [], sageCostCodes: [], namedCostCodes: [] }
    const builders: Readonly<Record<string, () => readonly ColumnDef<never>[]>> = {
      "purchase-orders.job": () => purchaseOrderColumns(false, "open", defaultRecordStatusList("purchase_order")),
      "purchase-orders.all-jobs": () => purchaseOrderColumns(true, "open", defaultRecordStatusList("purchase_order")),
      "rfis.job": () => rfiColumns("staff", { kind: "link", href: () => "/" }, defaultRecordStatusList("rfi")),
      "rfis.trade-partner": () => rfiColumns("vendor", { kind: "select", onSelect: noop }, defaultRecordStatusList("rfi")),
      "messages.job": () => conversationColumns({ filter: "inbox", searching: false, hitsFor: () => [], onOpen: noop, selection: { selected: new Set(), visibleIds: [], locked: false, onToggle: noop, onToggleAll: noop } }),
      "daily-logs.job": () => dailyLogColumns(new Set(), noop, noop),
      "duty-log.workspace": () => dutyLogColumns({ canChange: () => true, pending: false, onEdit: noop, onDelete: noop }),
      "change-orders.job": () => changeOrderColumns(() => "/"),
      "financials.queue": () => financialQueueColumns({ href: () => null, projectDriveUrl: null, developerModeEnabled: true }),
      "rfqs.job": () => rfqColumns(() => "/", defaultRecordStatusList("rfq")),
      "todos.job": () => projectTodoColumns({ statuses: defaultRecordStatusList("todo"), projectId: "p", canManage: true, developerModeEnabled: true, onOpen: noop }),
      "payments.billed": () => billedItemColumns({ projectId: "p", canRecord: true, canSettle: true, onRecord: noop, onPrepaid: noop }),
      "invoices.job": () => invoiceColumns(() => "/"),
      "payments.received": () => receivedPaymentColumns({ canRecord: true, canVoid: true, onApply: noop, onVoid: noop }),
      "nutech.orders": () => nuTechOrderColumns(),
      vendors: () => vendorColumns({ onView: noop }, {}, { selectable: true, developerMode: true }),
      customers: () => customerColumns({ onEdit: noop }, { selectable: true, developerMode: true }),
      "contacts.review": () => participantReviewColumns(noop),
      "contacts.internal": () => internalContactColumns({ canEdit: true, canArchive: true, busy: false, onEdit: noop, onArchive: noop, onRestore: noop }, { developerMode: true, hasActions: true }),
      "contacts.unassigned": () => unassignedPeopleColumns({ canEdit: true, canConnect: true, onEdit: noop, onConnect: noop, onArchive: noop }),
      "settings.people": () => peopleColumns({ onEditUser: noop }),
      "settings.invite-links": () => inviteLinkColumns({ onCopy: noop, onRevoke: noop }),
      "settings.account-deletion-requests": () => accountDeletionRequestColumns({ busyId: null, onStart: noop, onComplete: noop }),
      "schedule.list": () =>
        scheduleListColumns({
          multipleProjects: true,
          projectById: new Map(),
          conflicts: new Map(),
          palette: DEFAULT_DISPLAY_COLOR_PALETTE,
          assigneeOptions: [],
          onEdit: noop,
          onDelete: noop,
        }),
      "schedule.workday-exceptions": () => workdayExceptionColumns({ onOpen: noop, onDelete: noop }),
      "recurring-duties.workspace": () =>
        recurringDutyColumns({ canEdit: true, canManage: true, pending: false, onDone: noop, onEdit: noop, onUndo: noop }),
      "financials.invoices": () => financialInvoiceColumns({ customerMap: {}, projectMap: {}, onEdit: noop, onDelete: noop }),
      "financials.vendor-bills": () => vendorBillColumns({ vendorMap: {}, projectMap: {}, onEdit: noop, onDelete: noop }),
      "financials.payments": () => paymentColumns({ customerMap: {}, vendorMap: {}, projectMap: {}, onEdit: noop, onDelete: noop }),
      "financials.credit-memos": () => creditMemoColumns({ customerMap: {}, onEdit: noop, onDelete: noop }),
      "financials.square-receipts": () => squareReceiptColumns(),
      "nutech.catalog": () => catalogProductColumns({ workspace: catalogWorkspace, isPending: false, onMapSageCostCode: noop, onSetBundlesPerTruckload: noop, onSetTaxable: noop }),
      "equipment.machines": () => machineColumns({ canManage: true, onSetUp: noop }),
      "equipment.log-entries": () => machineLogEntryColumns({ pending: false, onChange: noop, onRemove: noop }),
      "client-follow-up.jobs": () => followUpJobColumns(noop),
      "estimates.job": () => estimateColumns("p", () => createElement("span")),
      "shop-tickets.job": () => shopTicketColumns({ projectId: "p", canEdit: true, onEdit: noop, onVoid: noop }),
      "trade-letters.estimate": () => tradeLetterColumns({ projectId: "p", canEdit: true, ownerSigned: false, poSetup: null, onOpenDocs: noop, onCompose: noop, onDelete: noop, onReload: noop }),
      "warranty.source-review": () => warrantySourceColumns(noop),
      "archives.audience": () => archiveEditionColumns("p"),
    }
    const serverSortIds: Readonly<Record<string, readonly string[]>> = {
      vendors: VENDOR_SORT_IDS,
      customers: CUSTOMER_SORT_IDS,
      "contacts.review": REVIEW_SORT_IDS,
    }
    // Columns a sheet may define without registering them: they always show.
    const unmanaged = new Set(["select", "actions", "source"])
    const problems: string[] = []
    for (const sheet of LIST_SHEETS) {
      const build = builders[sheet.id]
      if (!build) {
        problems.push(`${sheet.id}: add its column builder to this test`)
        continue
      }
      const columns = build().map((column) => ({
        id: column.id ?? ("accessorKey" in column && typeof column.accessorKey === "string" ? column.accessorKey : ""),
        sortable: column.enableSorting !== false && ("accessorFn" in column || "accessorKey" in column),
      }))
      const registered = new Map(sheet.columns.map((column) => [column.id, column]))
      for (const column of columns) {
        const entry = registered.get(column.id)
        if (!entry) {
          if (!unmanaged.has(column.id)) problems.push(`${sheet.id}: column "${column.id}" is not registered`)
          continue
        }
        if ((entry.sortable !== false) !== column.sortable) problems.push(`${sheet.id}: "${column.id}" sortability differs from the registry`)
      }
      for (const id of registered.keys()) {
        if (!columns.some((column) => column.id === id)) problems.push(`${sheet.id}: registered column "${id}" is not in the table`)
      }
      const serverIds = serverSortIds[sheet.id]
      if (serverIds) {
        const sortable = sheet.columns.filter((column) => column.sortable !== false).map((column) => column.id).sort()
        if (JSON.stringify(sortable) !== JSON.stringify([...serverIds].sort())) problems.push(`${sheet.id}: sortable columns differ from the server's sort ids`)
      }
    }
    expect(problems).toEqual([])
  })
})
