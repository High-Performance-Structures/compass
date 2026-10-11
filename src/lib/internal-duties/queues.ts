import type { WorkspaceKind } from "@/lib/internal-duties/model"

/**
 * Work queues on an internal workspace's Role Dashboard, in place of a client
 * job's queues. Each is tied to the Sage cost code its time is logged under
 * and links to where that work happens in Compass.
 */
export type InternalQueueId =
  | "recurring-duties"
  | "duty-log"
  | "accounts-payable"
  | "billing"
  | "payroll"
  | "compliance"
  | "message-desk"
  | "office-alerts"
  | "office-housekeeping"
  | "business-development"
  | "new-leads"
  | "managerial-accounting"
  | "legal"
  | "human-resources"
  | "marketing"
  | "planning"
  | "crew-log"

export type InternalQueue = {
  readonly id: InternalQueueId
  readonly title: string
  /** The Sage cost code its hours go under, when there is one. */
  readonly sageCode: string | null
  readonly description: string
  /** Where the work happens; `{project}` is the workspace's own id. */
  readonly href: string
}

export const INTERNAL_QUEUES: { readonly [K in InternalQueueId]: InternalQueue } = {
  "recurring-duties": {
    id: "recurring-duties",
    title: "Recurring duties",
    sageCode: null,
    description: "Bank and card reconciliations, sales tax and statements: what's behind and what's due.",
    href: "/dashboard/projects/{project}/duty-log#recurring-duties",
  },
  "duty-log": {
    id: "duty-log",
    title: "Duty log",
    sageCode: null,
    description: "Log today's duties with hours, and give older daily logs a duty.",
    href: "/dashboard/projects/{project}/duty-log",
  },
  "accounts-payable": {
    id: "accounts-payable",
    title: "Accounts payable",
    sageCode: "512",
    description: "New vendor invoices, coding them to projects, and vendor statements.",
    href: "/dashboard/financials",
  },
  billing: {
    id: "billing",
    title: "Billing and receivables",
    sageCode: "507",
    description: "Pay applications, invoices sent and payments received.",
    href: "/dashboard/financials",
  },
  payroll: {
    id: "payroll",
    title: "Payroll",
    sageCode: "505",
    description: "Approved hours, payroll runs and payroll filings.",
    href: "/dashboard/projects/{project}/duty-log",
  },
  compliance: {
    id: "compliance",
    title: "Audits and compliance",
    sageCode: "504",
    description: "Certificates of insurance, W-9s, licenses and audits.",
    href: "/dashboard/vendors",
  },
  "message-desk": {
    id: "message-desk",
    title: "Staff messages",
    sageCode: null,
    description: "Voicemails and messages waiting for staff.",
    href: "/dashboard/office-maintenance/message-desk",
  },
  "office-alerts": {
    id: "office-alerts",
    title: "Office alerts",
    sageCode: null,
    description: "Items Compass flagged for the office.",
    href: "/dashboard/office-alerts",
  },
  "office-housekeeping": {
    id: "office-housekeeping",
    title: "Office housekeeping",
    sageCode: "513",
    description: "Keeping the office and supplies in order.",
    href: "/dashboard/projects/{project}/duty-log",
  },
  "business-development": {
    id: "business-development",
    title: "Business development",
    sageCode: "508",
    description: "Client follow-up and the sales pipeline.",
    href: "/dashboard/client-follow-up",
  },
  "new-leads": {
    id: "new-leads",
    title: "New leads",
    sageCode: "41",
    description: "New inquiries on the dashboard pipeline, from intake to estimating.",
    href: "/dashboard",
  },
  "managerial-accounting": {
    id: "managerial-accounting",
    title: "Managerial accounting",
    sageCode: "511",
    description: "Job costs against budgets, cash and receivables across projects.",
    href: "/dashboard/financials",
  },
  legal: {
    id: "legal",
    title: "Legal",
    sageCode: "510",
    description: "Contracts, disputes and legal matters.",
    href: "/dashboard/projects/{project}/duty-log",
  },
  "human-resources": {
    id: "human-resources",
    title: "Human resources",
    sageCode: "514",
    description: "Hiring, training plans and staff development.",
    href: "/dashboard/people",
  },
  marketing: {
    id: "marketing",
    title: "Marketing and social media",
    sageCode: "506",
    description: "Social posts, project photos and marketing.",
    href: "/dashboard/settings?section=integrations",
  },
  planning: {
    id: "planning",
    title: "Planning and administration",
    sageCode: "42",
    description: "Company planning, settings and automations.",
    href: "/dashboard/automations",
  },
  "crew-log": {
    id: "crew-log",
    title: "Crew log",
    sageCode: null,
    description: "Crew hours here this week.",
    href: "/dashboard/projects/{project}/duty-log",
  },
}

/** Default order for each kind of internal workspace; people can reorder their own. */
export const INTERNAL_QUEUE_ORDER: { readonly [K in WorkspaceKind]: readonly InternalQueueId[] } = {
  office: [
    "recurring-duties",
    "accounts-payable",
    "billing",
    "message-desk",
    "office-alerts",
    "payroll",
    "compliance",
    "duty-log",
    "office-housekeeping",
  ],
  executive: [
    "business-development",
    "new-leads",
    "managerial-accounting",
    "recurring-duties",
    "legal",
    "human-resources",
    "marketing",
    "planning",
    "duty-log",
  ],
  field: ["crew-log", "duty-log"],
}

/** The saved-order key on the Role Dashboard for an internal workspace kind. */
export function internalQueueRoleId(kind: WorkspaceKind): string {
  return `internal-${kind}`
}

export function isInternalQueueRoleId(value: string): boolean {
  return value === "internal-office" || value === "internal-executive" || value === "internal-field"
}

export function queueHref(queue: InternalQueue, projectId: string): string {
  return queue.href.replace("{project}", encodeURIComponent(projectId))
}

/** A saved order applied to a kind's queues: saved ids first, then any new queues. */
export function orderedQueues(kind: WorkspaceKind, saved: readonly string[] | undefined): readonly InternalQueue[] {
  const defaults = INTERNAL_QUEUE_ORDER[kind]
  const known = new Set<string>(defaults)
  const ids = [...(saved ?? []).filter((id): id is InternalQueueId => known.has(id)), ...defaults]
  return [...new Set(ids)].map((id) => INTERNAL_QUEUES[id])
}
