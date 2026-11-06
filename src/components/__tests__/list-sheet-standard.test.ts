import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { ColumnDef } from "@tanstack/react-table"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { participantReviewColumns } from "@/components/contacts/participant-review-table"
import { customerColumns } from "@/components/financials/customers-table"
import { billedItemColumns, receivedPaymentColumns } from "@/components/financials/received-payments-panel"
import { vendorColumns } from "@/components/financials/vendors-table"
import { rfiColumns } from "@/components/projects/project-rfi-record-table"
import { projectTodoColumns } from "@/components/projects/project-todo-table-columns"
import { purchaseOrderColumns } from "@/components/purchase-orders/purchase-order-record-table"
import { CUSTOMER_SORT_IDS, VENDOR_SORT_IDS } from "@/lib/domain/contacts/directory-page"
import { REVIEW_SORT_IDS } from "@/lib/domain/conversations/imported-participant-review"
import { boardColumns as nuTechOrderColumns } from "@/components/nutech/nutech-order-board"
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
    const builders: Readonly<Record<string, () => readonly ColumnDef<never>[]>> = {
      "purchase-orders.job": () => purchaseOrderColumns(false, "open", defaultRecordStatusList("purchase_order")),
      "purchase-orders.all-jobs": () => purchaseOrderColumns(true, "open", defaultRecordStatusList("purchase_order")),
      "rfis.job": () => rfiColumns("staff", { kind: "link", href: () => "/" }, defaultRecordStatusList("rfi")),
      "rfis.trade-partner": () => rfiColumns("vendor", { kind: "select", onSelect: noop }, defaultRecordStatusList("rfi")),
      "todos.job": () => projectTodoColumns({ statuses: defaultRecordStatusList("todo"), projectId: "p", canManage: true, developerModeEnabled: true, onOpen: noop }),
      "payments.billed": () => billedItemColumns({ projectId: "p", canRecord: true, canSettle: true, onRecord: noop, onPrepaid: noop }),
      "payments.received": () => receivedPaymentColumns({ canRecord: true, canVoid: true, onApply: noop, onVoid: noop }),
      "nutech.orders": () => nuTechOrderColumns(),
      vendors: () => vendorColumns({ onView: noop }, {}, { selectable: true, developerMode: true }),
      customers: () => customerColumns({ onEdit: noop }, { selectable: true, developerMode: true }),
      "contacts.review": () => participantReviewColumns(noop),
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
