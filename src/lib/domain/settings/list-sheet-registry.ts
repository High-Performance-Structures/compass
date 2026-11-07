/**
 * Every list sheet that uses the shared record table, with its columns and
 * code defaults (Settings > Lists, ui-standards.md "Record lists").
 *
 * Registering a sheet: add an entry here, then pass its id as `sheetId` to
 * `useRecordTable` or `useServerRecordTable`. Column ids must match the
 * sheet's TanStack column ids. Columns a sheet defines but does not list
 * here (selection checkboxes, row actions, developer-only columns) are not
 * managed: they always show, in place. Keep each sheet's code defaults equal
 * to what the list showed before it was registered.
 *
 * Pure: no imports, no database or network access, safe in the browser.
 */

/** How a column sorts, which names the default sort's direction in Settings. */
export type ListSheetColumnKind = "text" | "date" | "number" | "status"

export type ListSheetColumn = {
  readonly id: string
  readonly label: string
  readonly kind: ListSheetColumnKind
  /** Always shown: the column that names and opens the record. */
  readonly required?: boolean
  /** Hidden until a company or person shows it. */
  readonly hiddenByDefault?: boolean
  /** False when the sheet cannot sort by this column. */
  readonly sortable?: boolean
}

export type ListSheetSort = { readonly columnId: string; readonly desc: boolean }

type ListSheetFilterOption = { readonly value: string; readonly label: string }

export type ListSheetDefinition = {
  readonly id: string
  readonly label: string
  /** Where the sheet appears, shown under its name in Settings > Lists. */
  readonly where: string
  readonly columns: readonly ListSheetColumn[]
  /** The sort the sheet opens with; null keeps the list's own order. */
  readonly defaultSort: ListSheetSort | null
  /**
   * Shown outside the company workspace (such as the trade partner portal):
   * people can still use Columns, but Settings > Lists does not list it.
   */
  readonly personalOnly?: boolean
  /** Status filters the sheet can open on, when its page picks one. */
  readonly startFilter: { readonly options: readonly ListSheetFilterOption[]; readonly defaultValue: string } | null
}

const OPEN_OR_ALL: readonly ListSheetFilterOption[] = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
]

const PURCHASE_ORDER_COLUMNS_BEFORE_PROJECT: readonly ListSheetColumn[] = [
  { id: "number", label: "P.O. number", kind: "text", required: true },
  { id: "title", label: "Title", kind: "text" },
]

const PURCHASE_ORDER_COLUMNS_AFTER_PROJECT: readonly ListSheetColumn[] = [
  { id: "vendor", label: "Vendor", kind: "text" },
  { id: "status", label: "Status", kind: "status" },
  { id: "siteContact", label: "Site contact", kind: "text" },
  { id: "orderDate", label: "Order date", kind: "date" },
  { id: "dueDate", label: "Required", kind: "date" },
  { id: "amount", label: "Amount", kind: "number" },
]

export const LIST_SHEETS: readonly ListSheetDefinition[] = [
  {
    id: "purchase-orders.job",
    label: "Purchase orders",
    where: "A job's purchase orders",
    columns: [...PURCHASE_ORDER_COLUMNS_BEFORE_PROJECT, ...PURCHASE_ORDER_COLUMNS_AFTER_PROJECT],
    defaultSort: { columnId: "dueDate", desc: false },
    startFilter: { options: OPEN_OR_ALL, defaultValue: "open" },
  },
  {
    id: "purchase-orders.all-jobs",
    label: "Purchase orders, all jobs",
    where: "Purchase Orders in the sidebar",
    columns: [
      ...PURCHASE_ORDER_COLUMNS_BEFORE_PROJECT,
      { id: "project", label: "Project", kind: "text" },
      ...PURCHASE_ORDER_COLUMNS_AFTER_PROJECT,
    ],
    defaultSort: { columnId: "dueDate", desc: false },
    startFilter: { options: OPEN_OR_ALL, defaultValue: "open" },
  },
  {
    id: "rfis.job",
    label: "RFIs",
    where: "A job's RFI queue",
    columns: [
      { id: "number", label: "RFI", kind: "text", required: true },
      { id: "subject", label: "Subject", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
      { id: "assignedTo", label: "Assigned to", kind: "text" },
      { id: "requester", label: "Asked by", kind: "text" },
      { id: "sent", label: "Sent", kind: "date" },
      { id: "dueDate", label: "Needed by", kind: "date" },
      { id: "answered", label: "Answered", kind: "date" },
    ],
    defaultSort: null,
    startFilter: { options: OPEN_OR_ALL, defaultValue: "open" },
  },
  {
    id: "rfqs.job",
    label: "RFQs",
    where: "A job's Requests for Quote",
    columns: [
      { id: "number", label: "RFQ", kind: "text", required: true },
      { id: "title", label: "Title", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
      { id: "requestedFrom", label: "Requested from", kind: "text" },
      { id: "trade", label: "Trade", kind: "text" },
      { id: "dueDate", label: "Needed by", kind: "date" },
      { id: "quote", label: "Quote", kind: "number" },
      { id: "responded", label: "Responded", kind: "date" },
    ],
    defaultSort: null,
    startFilter: { options: OPEN_OR_ALL, defaultValue: "open" },
  },
  {
    id: "messages.job",
    label: "Messages",
    where: "Project › Messages",
    columns: [
      { id: "subject", label: "Subject", kind: "text", required: true },
      { id: "with", label: "With", kind: "text" },
      { id: "type", label: "Type", kind: "text" },
      { id: "lastActivity", label: "Last activity", kind: "date" },
      { id: "status", label: "Status", kind: "status" },
    ],
    defaultSort: { columnId: "lastActivity", desc: true },
    startFilter: null,
  },
  {
    id: "daily-logs.job",
    label: "Daily logs",
    where: "A job's Daily Logs",
    columns: [
      { id: "date", label: "Date", kind: "date", required: true },
      { id: "author", label: "Author", kind: "text" },
      { id: "work", label: "Work completed", kind: "text" },
      { id: "hours", label: "Crew hours", kind: "number" },
      { id: "weather", label: "Weather", kind: "text" },
      { id: "photos", label: "Photos", kind: "number" },
      { id: "issues", label: "Issues", kind: "number" },
      { id: "status", label: "Status", kind: "status" },
      { id: "owner", label: "Owner", kind: "text" },
    ],
    defaultSort: { columnId: "date", desc: true },
    startFilter: null,
  },
  {
    id: "rfis.trade-partner",
    label: "RFIs, trade partner view",
    where: "A trade partner's RFIs",
    personalOnly: true,
    columns: [
      { id: "number", label: "RFI", kind: "text", required: true },
      { id: "subject", label: "Subject", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
      { id: "assignedTo", label: "Assigned to", kind: "text" },
      { id: "dueDate", label: "Needed by", kind: "date" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "todos.job",
    label: "To-dos",
    where: "A job's to-dos",
    columns: [
      { id: "title", label: "Name", kind: "text", required: true },
      { id: "description", label: "Description", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
      { id: "assignedTo", label: "Assigned to", kind: "text" },
      { id: "dueDate", label: "Due date", kind: "date" },
      { id: "author", label: "Author", kind: "text" },
      { id: "priority", label: "Priority", kind: "text" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "payments.billed",
    label: "Billed items",
    where: "A job's Financials, received payments",
    columns: [
      { id: "item", label: "Item", kind: "text", required: true },
      { id: "date", label: "Billed", kind: "date" },
      { id: "billed", label: "Amount", kind: "number" },
      { id: "paid", label: "Paid", kind: "number" },
      { id: "open", label: "Outstanding", kind: "number" },
      { id: "status", label: "Status", kind: "status" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "payments.received",
    label: "Received payments",
    where: "A job's Financials, received payments",
    columns: [
      { id: "reference", label: "Reference", kind: "text", required: true },
      { id: "received", label: "Received", kind: "date" },
      { id: "method", label: "Method", kind: "text" },
      { id: "amount", label: "Amount", kind: "number" },
      { id: "appliedTo", label: "Applied to", kind: "text" },
      { id: "unapplied", label: "Unapplied", kind: "number" },
      { id: "status", label: "Status", kind: "status" },
      { id: "sage", label: "Sage", kind: "text" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "nutech.orders",
    label: "Nu-Tech orders",
    where: "Nu-Tech Orders, order board",
    columns: [
      { id: "order", label: "Order", kind: "text", required: true },
      { id: "customer", label: "Customer", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
      { id: "paid", label: "Customer paid", kind: "date" },
      { id: "released", label: "PO sent", kind: "date" },
      { id: "confirmation", label: "Confirmation", kind: "text" },
      { id: "requested", label: "Requested date", kind: "date" },
      { id: "confirmed", label: "Confirmed date", kind: "date" },
      { id: "method", label: "Pickup / delivery", kind: "text" },
      { id: "invoice", label: "Vendor invoice", kind: "text" },
      { id: "next", label: "Next step", kind: "text" },
    ],
    defaultSort: { columnId: "requested", desc: false },
    startFilter: null,
  },
  {
    id: "vendors",
    label: "Vendors",
    where: "Contacts, vendors",
    columns: [
      { id: "name", label: "Name", kind: "text", required: true },
      { id: "category", label: "Category", kind: "text" },
      { id: "people", label: "People", kind: "number" },
      { id: "tradeDocs", label: "Trade docs", kind: "status", sortable: false },
      { id: "email", label: "Contact email", kind: "text" },
      { id: "phone", label: "Company phone", kind: "text" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "customers",
    label: "Clients",
    where: "Contacts, clients and leads",
    columns: [
      { id: "name", label: "Name", kind: "text", required: true },
      { id: "email", label: "Email", kind: "text" },
      { id: "phone", label: "Phone", kind: "text" },
      { id: "people", label: "People", kind: "number" },
      { id: "relationshipType", label: "Status", kind: "status" },
      { id: "createdAt", label: "Added", kind: "date" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "contacts.review",
    label: "Contacts to review",
    where: "Contacts, imported names to review",
    columns: [
      { id: "literal", label: "As written", kind: "text", required: true },
      { id: "reason", label: "Reason", kind: "text", sortable: false },
      { id: "project", label: "Project", kind: "text" },
      { id: "conversation", label: "Conversation", kind: "text", sortable: false },
      { id: "messages", label: "Messages", kind: "number" },
      { id: "date", label: "Date", kind: "date" },
    ],
    defaultSort: null,
    startFilter: null,
  },
]

/** The sheets a company sets up in Settings > Lists. */
export function companyListSheets(): readonly ListSheetDefinition[] {
  return LIST_SHEETS.filter((sheet) => sheet.personalOnly !== true)
}

export function listSheetDefinition(sheetId: string): ListSheetDefinition | null {
  return LIST_SHEETS.find((sheet) => sheet.id === sheetId) ?? null
}

/** Settings labels for a default sort's two directions, by column kind. */
export function listSheetSortDirectionLabels(kind: ListSheetColumnKind): { readonly asc: string; readonly desc: string } {
  if (kind === "date") return { asc: "Soonest first", desc: "Latest first" }
  if (kind === "number") return { asc: "Smallest first", desc: "Largest first" }
  if (kind === "status") return { asc: "Workflow order", desc: "Reverse workflow order" }
  return { asc: "A to Z", desc: "Z to A" }
}
