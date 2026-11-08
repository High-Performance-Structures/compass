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
  /**
   * Status filters the sheet can open on, when its page picks one. With
   * `renamable`, the options are the sheet's filter buttons and a company can
   * rename them in Settings > Lists (the page reads the names back).
   */
  readonly startFilter: {
    readonly options: readonly ListSheetFilterOption[]
    readonly defaultValue: string
    readonly renamable?: boolean
  } | null
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
    id: "duty-log.workspace",
    label: "Duty log",
    where: "An internal workspace's Duty Log",
    columns: [
      { id: "date", label: "Date", kind: "date", required: true },
      { id: "who", label: "Who", kind: "text" },
      { id: "duty", label: "Duty", kind: "text" },
      { id: "hours", label: "Hours", kind: "number" },
      { id: "notes", label: "Notes", kind: "text" },
    ],
    defaultSort: { columnId: "date", desc: true },
    startFilter: null,
  },
  {
    id: "change-orders.job",
    label: "Change orders",
    where: "A job's Change Orders and variances",
    columns: [
      { id: "number", label: "Number", kind: "text", required: true },
      { id: "title", label: "Title", kind: "text" },
      { id: "type", label: "Type", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
      { id: "requestedBy", label: "Requested by", kind: "text" },
      { id: "amount", label: "Amount", kind: "number" },
      { id: "scheduleDays", label: "Schedule days", kind: "number" },
      { id: "submitted", label: "Submitted", kind: "date" },
      { id: "executed", label: "Executed", kind: "date" },
    ],
    defaultSort: { columnId: "number", desc: true },
    startFilter: {
      options: [
        { value: "open", label: "Open" },
        { value: "in_progress", label: "In progress" },
        { value: "with_owner", label: "With owner" },
        { value: "executed", label: "Executed" },
        { value: "closed", label: "Closed" },
        { value: "all", label: "All" },
      ],
      defaultValue: "open",
      renamable: true,
    },
  },
  {
    id: "financials.queue",
    label: "Project financial queue",
    where: "A job's Financials page",
    columns: [
      { id: "record", label: "Record", kind: "text", required: true },
      { id: "title", label: "Title", kind: "text" },
      { id: "company", label: "Company", kind: "text" },
      { id: "amount", label: "Amount", kind: "number" },
      { id: "date", label: "Date", kind: "date" },
      { id: "status", label: "Status", kind: "status" },
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
    id: "invoices.job",
    label: "Invoices",
    where: "A job's Financials, invoices built in Compass",
    columns: [
      { id: "number", label: "Invoice", kind: "text", required: true },
      { id: "title", label: "Description", kind: "text" },
      { id: "billTo", label: "Bill to", kind: "text" },
      { id: "date", label: "Date", kind: "date" },
      { id: "total", label: "Total", kind: "number" },
      { id: "paid", label: "Paid", kind: "number" },
      { id: "status", label: "Status", kind: "status" },
      { id: "sent", label: "Sent", kind: "text" },
    ],
    defaultSort: { columnId: "date", desc: true },
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
    id: "schedule.list",
    label: "Schedule list",
    where: "Schedule, list view",
    columns: [
      { id: "idNum", label: "#", kind: "number" },
      { id: "title", label: "Title", kind: "text", required: true },
      { id: "project", label: "Project", kind: "text" },
      { id: "complete", label: "Complete", kind: "number" },
      { id: "phase", label: "Phase", kind: "text" },
      { id: "duration", label: "Duration", kind: "number" },
      { id: "startDate", label: "Start", kind: "date" },
      { id: "endDateCalculated", label: "End", kind: "date" },
      { id: "assignedTo", label: "Responsible", kind: "text" },
    ],
    // The schedule's own order (chronological or manual) until a header is clicked.
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "schedule.workday-exceptions",
    label: "Workday exceptions",
    where: "A job's Schedule, workday exceptions",
    columns: [
      { id: "title", label: "Title", kind: "text", required: true },
      { id: "startDate", label: "Start", kind: "date" },
      { id: "endDate", label: "End", kind: "date" },
      { id: "duration", label: "Duration", kind: "number" },
      { id: "effect", label: "Effect", kind: "text" },
      { id: "category", label: "Category", kind: "text" },
      { id: "recurrence", label: "Recurrence", kind: "text" },
      { id: "notes", label: "Notes", kind: "text" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "recurring-duties.workspace",
    label: "Recurring duties",
    where: "An internal workspace's recurring duties",
    columns: [
      { id: "duty", label: "Duty", kind: "text", required: true },
      { id: "cadence", label: "How often", kind: "text" },
      { id: "lastDone", label: "Last done", kind: "date" },
      { id: "owner", label: "Owner", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
    ],
    defaultSort: null,
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
  {
    id: "contacts.internal",
    label: "Internal contacts",
    where: "Contacts, internal staff directory",
    columns: [
      { id: "name", label: "Name", kind: "text", required: true },
      { id: "company", label: "Company", kind: "text" },
      { id: "role", label: "Role", kind: "text" },
      { id: "email", label: "Email", kind: "text" },
      { id: "phone", label: "Phone", kind: "text" },
      { id: "access", label: "Compass access", kind: "status" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "contacts.unassigned",
    label: "Unassigned people",
    where: "Contacts, people not connected to a company",
    columns: [
      { id: "name", label: "Name", kind: "text", required: true },
      { id: "email", label: "Email", kind: "text" },
      { id: "company", label: "Imported company", kind: "text" },
      { id: "projects", label: "Projects", kind: "text" },
    id: "financials.invoices",
    label: "Invoices, all jobs",
    where: "Financials in the sidebar, invoices",
    columns: [
      { id: "invoiceNumber", label: "Invoice #", kind: "text", required: true },
      { id: "customer", label: "Customer", kind: "text" },
      { id: "project", label: "Project", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
      { id: "issueDate", label: "Issue date", kind: "date" },
      { id: "dueDate", label: "Due date", kind: "date" },
      { id: "total", label: "Total", kind: "number" },
      { id: "amountPaid", label: "Paid", kind: "number" },
      { id: "amountDue", label: "Amount due", kind: "number" },
      { id: "recordPayment", label: "Record payment", kind: "text", sortable: false },
    ],
    defaultSort: null,
    startFilter: {
      options: [
        { value: "draft", label: "Draft" },
        { value: "sent", label: "Sent" },
        { value: "partially_paid", label: "Partially paid" },
        { value: "overdue", label: "Overdue" },
        { value: "paid", label: "Paid" },
        { value: "void", label: "Void" },
        { value: "all", label: "All" },
      ],
      defaultValue: "all",
    },
  },
  {
    id: "financials.vendor-bills",
    label: "Vendor bills",
    where: "Financials in the sidebar, bills",
    columns: [
      { id: "billNumber", label: "Bill #", kind: "text", required: true },
      { id: "vendor", label: "Vendor", kind: "text" },
      { id: "project", label: "Project", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
      { id: "billDate", label: "Bill date", kind: "date" },
      { id: "dueDate", label: "Due date", kind: "date" },
      { id: "total", label: "Total", kind: "number" },
      { id: "amountDue", label: "Amount due", kind: "number" },
    ],
    defaultSort: null,
    startFilter: {
      options: [
        { value: "pending", label: "Pending" },
        { value: "approved", label: "Approved" },
        { value: "partially_paid", label: "Partially paid" },
        { value: "paid", label: "Paid" },
        { value: "void", label: "Void" },
        { value: "all", label: "All" },
      ],
      defaultValue: "all",
    },
  },
  {
    id: "financials.payments",
    label: "Payments, all jobs",
    where: "Financials in the sidebar, payments",
    columns: [
      { id: "referenceNumber", label: "Reference #", kind: "text", required: true },
      { id: "paymentType", label: "Type", kind: "text" },
      { id: "counterparty", label: "Customer/Vendor", kind: "text" },
      { id: "project", label: "Project", kind: "text" },
      { id: "amount", label: "Amount", kind: "number" },
      { id: "paymentDate", label: "Date", kind: "date" },
      { id: "paymentMethod", label: "Method", kind: "text" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "settings.people",
    label: "Team members",
    where: "Settings › Team",
    columns: [
      { id: "name", label: "Name", kind: "text", required: true },
      { id: "role", label: "Role", kind: "text" },
      { id: "teams", label: "Teams", kind: "text" },
      { id: "groups", label: "Groups", kind: "text" },
      { id: "projects", label: "Projects", kind: "number" },
    id: "financials.credit-memos",
    label: "Credit memos",
    where: "Financials in the sidebar, credit memos",
    columns: [
      { id: "memoNumber", label: "Memo #", kind: "text", required: true },
      { id: "customer", label: "Customer", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
      { id: "issueDate", label: "Issue date", kind: "date" },
      { id: "total", label: "Total", kind: "number" },
      { id: "amountApplied", label: "Applied", kind: "number" },
      { id: "amountRemaining", label: "Remaining", kind: "number" },
    ],
    defaultSort: null,
    startFilter: {
      options: [
        { value: "all", label: "All" },
        { value: "active", label: "Active" },
        { value: "invited", label: "Invitation pending" },
        { value: "draft", label: "Draft" },
        { value: "applied", label: "Applied" },
        { value: "void", label: "Void" },
        { value: "all", label: "All" },
      ],
      defaultValue: "all",
    },
  },
  {
    id: "settings.invite-links",
    label: "Invite links",
    where: "Settings › Team, invite links",
    columns: [
      { id: "code", label: "Code", kind: "text", required: true },
      { id: "role", label: "Role", kind: "text" },
      { id: "uses", label: "Uses", kind: "number" },
      { id: "expires", label: "Expires", kind: "date" },
      { id: "createdBy", label: "Created by", kind: "text" },
    id: "financials.square-receipts",
    label: "Square receipts",
    where: "Financials payments and a job's Financials, Square receipts",
    columns: [
      { id: "project", label: "Project / client", kind: "text", required: true },
      { id: "invoice", label: "Sage invoice", kind: "text" },
      { id: "payment", label: "Square payment", kind: "date" },
      { id: "received", label: "Received", kind: "number" },
      { id: "fee", label: "Square fee", kind: "number" },
      { id: "status", label: "Status", kind: "status" },
    ],
    defaultSort: null,
    startFilter: {
      options: [
        { value: "open", label: "Open" },
        { value: "expired", label: "Expired" },
        { value: "used_up", label: "Used up" },
        { value: "revoked", label: "Revoked" },
        { value: "all", label: "All" },
      ],
      defaultValue: "open",
    },
  },
  {
    id: "settings.account-deletion-requests",
    label: "Account deletion requests",
    where: "Settings › Permissions, account deletion requests",
    columns: [
      { id: "person", label: "Person", kind: "text", required: true },
      { id: "requested", label: "Requested", kind: "date" },
        { value: "review", label: "Needs review" },
        { value: "awaiting", label: "Awaiting Sage receipt" },
        { value: "in_progress", label: "Queued or processing" },
        { value: "posted", label: "Posted in Sage" },
        { value: "all", label: "All" },
      ],
      defaultValue: "all",
    },
  },
  {
    id: "nutech.catalog",
    label: "Nu-Tech product catalog",
    where: "Nu-Tech catalog, active product catalog",
    columns: [
      { id: "sku", label: "SKU / product", kind: "text", required: true },
      { id: "package", label: "Package", kind: "text" },
      { id: "cost", label: "Airlite cost", kind: "number" },
      { id: "newStandard", label: "New standard", kind: "number" },
      { id: "newCash", label: "New cash", kind: "number" },
      { id: "returning", label: "Returning", kind: "number" },
      { id: "returningCash", label: "Returning cash", kind: "number" },
      { id: "form", label: "Airlite form", kind: "number" },
      { id: "costCode", label: "Sage cost code", kind: "text" },
      { id: "truck", label: "Bundles / truck", kind: "number" },
      { id: "taxable", label: "Taxable", kind: "number" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "equipment.machines",
    label: "Machines",
    where: "Equipment, machines",
    columns: [
      { id: "machine", label: "Machine", kind: "text", required: true },
      { id: "sageNumber", label: "Sage #", kind: "text" },
      { id: "rateBook", label: "Rate book", kind: "text" },
      { id: "hourMeter", label: "Hour meter", kind: "number" },
      { id: "lastJob", label: "Last job", kind: "text" },
      { id: "nextService", label: "Next service", kind: "number" },
    ],
    defaultSort: null,
    startFilter: null,
  },
  {
    id: "equipment.log-entries",
    label: "Machine log entries",
    where: "Equipment, last 60 days",
    columns: [
      { id: "date", label: "Date", kind: "date", required: true },
      { id: "machine", label: "Machine", kind: "text" },
      { id: "entry", label: "Entry", kind: "text" },
      { id: "by", label: "By", kind: "text" },
      { id: "status", label: "Status", kind: "status" },
    ],
    defaultSort: null,
    startFilter: {
      options: [
        { value: "open", label: "Open" },
        { value: "pending", label: "Pending" },
        { value: "processing", label: "Processing" },
        { value: "completed", label: "Deleted" },
        { value: "cancelled", label: "Cancelled" },
        { value: "all", label: "All" },
      ],
      defaultValue: "open",
        { value: "pending", label: "Waiting" },
        { value: "approved", label: "Approved" },
        { value: "rejected", label: "Rejected" },
        { value: "all", label: "All" },
      ],
      defaultValue: "all",
    },
  },
  {
    id: "client-follow-up.jobs",
    label: "Client follow-up jobs",
    where: "Client follow-up, followed jobs",
    columns: [
      { id: "job", label: "Job", kind: "text", required: true },
      { id: "level", label: "Follow-up", kind: "status" },
      { id: "lastContact", label: "Last contact", kind: "date" },
      { id: "owner", label: "Owner", kind: "text" },
      { id: "period", label: "Logged", kind: "number" },
    ],
    defaultSort: { columnId: "level", desc: false },
    startFilter: {
      options: [
        { value: "attention", label: "Needs follow-up" },
        { value: "all", label: "All followed jobs" },
      ],
      defaultValue: "attention",
    },
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
