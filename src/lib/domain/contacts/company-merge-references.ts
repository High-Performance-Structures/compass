/**
 * Every row that points at a vendor or a client company, and what a company
 * merge does with it. A merge moves the references listed as "move" from the
 * archived company to the kept one in the same atomic batch; "keep" rows stay
 * on the archived record for the written reason (accounting identities and
 * history), and the merge preview blocks where keeping them would be unsafe.
 *
 * company-merge-references.test.ts reads every foreign key to vendors and
 * customers from the migrated schema, plus the id columns in
 * src/db/id-integrity.ts that name a vendor or customer, and fails when one is
 * missing here, so a new feature cannot quietly strand its rows on a merged
 * company again.
 */

export const COMPANY_MERGE_SIDES = ["vendor", "customer"] as const
export type CompanyMergeSide = (typeof COMPANY_MERGE_SIDES)[number]

/** "merge": the source is still live; "repair": the source was already merged into the destination. */
type CompanyMergeMode = "merge" | "repair"

/** What every company-merge statement builder receives. Both ids were checked to belong to the organization. */
export type CompanyReferenceMove = {
  readonly side: CompanyMergeSide
  readonly mode: CompanyMergeMode
  readonly organizationId: string
  readonly sourceId: string
  readonly destinationId: string
  readonly now: string
}

export const COMPANY_MERGE_CATEGORIES = [
  "people",
  "project_contacts",
  "trade_docs",
  "trade_doc_requests",
  "purchase_orders",
  "budget_lines",
  "warranty",
  "trade_letters",
  "bills_payments",
  "client_jobs",
  "invoices_payments",
  "email_threads",
  "activity",
  "merged_records",
] as const
export type CompanyMergeCategory = (typeof COMPANY_MERGE_CATEGORIES)[number]

export const COMPANY_MERGE_CATEGORY_LABELS: Readonly<Record<CompanyMergeCategory, string>> = {
  people: "People",
  project_contacts: "Project contacts",
  trade_docs: "Trade docs",
  trade_doc_requests: "Trade doc requests",
  purchase_orders: "POs, RFQs and bids",
  budget_lines: "Budget lines",
  warranty: "Warranty claims",
  trade_letters: "Trade letters",
  bills_payments: "Bills and payments",
  client_jobs: "Jobs (client)",
  invoices_payments: "Invoices, credit memos and payments",
  email_threads: "Email reply threads",
  activity: "Activity history",
  merged_records: "Earlier merged duplicates",
}

type Handling =
  | {
      readonly action: "move"
      readonly category: CompanyMergeCategory
      /** False when another entry already counts the same rows (project contacts match on two columns). */
      readonly counted: boolean
    }
  | { readonly action: "keep"; readonly reason: string }

export type CompanyReference = {
  readonly side: CompanyMergeSide
  readonly table: string
  readonly column: string
  /** SQL condition on the same row for polymorphic columns, e.g. `source_type = 'vendor'`. */
  readonly when?: string
  readonly handling: Handling
}

const move = (category: CompanyMergeCategory, counted = true): Handling => ({ action: "move", category, counted })
const keep = (reason: string): Handling => ({ action: "keep", reason })

const SAGE_REVIEW =
  "history of a Sage review of the archived record itself; an active review or a snapshot blocks the merge, so nothing live is left behind"
const MERGE_HISTORY = "the merge audit itself: it names the archived and kept records by design"
const IMPORT_STAGING =
  "Buildertrend import staging, written only by the offline import scripts; a match to a merged company resolves through its merged-into pointer"
const SAGE_CREATE =
  "a request to add a person to the archived company's Sage record; an active one blocks the merge and finished ones are that record's Sage history"

export const COMPANY_REFERENCES: readonly CompanyReference[] = [
  // Vendors
  { side: "vendor", table: "vendor_contacts", column: "vendor_id", handling: move("people") },
  { side: "vendor", table: "project_contacts", column: "vendor_id", handling: move("project_contacts") },
  { side: "vendor", table: "project_contacts", column: "source_entity_id", when: "source_entity_type = 'vendor'", handling: move("project_contacts", false) },
  { side: "vendor", table: "vendor_trade_documents", column: "vendor_id", handling: move("trade_docs") },
  { side: "vendor", table: "vendor_trade_doc_links", column: "vendor_id", handling: move("trade_doc_requests") },
  { side: "vendor", table: "project_operations", column: "vendor_id", handling: move("purchase_orders") },
  { side: "vendor", table: "project_budget_lines", column: "vendor_id", handling: move("budget_lines") },
  { side: "vendor", table: "project_warranty_claims", column: "assigned_vendor_id", handling: move("warranty") },
  { side: "vendor", table: "trade_letters", column: "vendor_id", handling: move("trade_letters") },
  { side: "vendor", table: "vendor_bills", column: "vendor_id", handling: move("bills_payments") },
  { side: "vendor", table: "payments", column: "vendor_id", handling: move("bills_payments") },
  { side: "vendor", table: "email_reply_threads", column: "source_id", when: "source_type = 'vendor'", handling: move("email_threads") },
  { side: "vendor", table: "activity_events", column: "entity_id", when: "entity_type = 'vendor'", handling: move("activity") },
  { side: "vendor", table: "vendors", column: "merged_into_vendor_id", handling: move("merged_records") },
  {
    side: "vendor", table: "sage_vendor_certificate_syncs", column: "vendor_id",
    handling: keep("Sage certificate sync state belongs to the vendor's own Sage identity (one row per vendor); a queued or running sync blocks the merge, and the kept vendor's sync is requested again after its trade docs change"),
  },
  { side: "vendor", table: "sage_contact_create_proposals", column: "vendor_id", handling: keep(SAGE_CREATE) },
  { side: "vendor", table: "buildertrend_staging_access_candidates", column: "matched_vendor_id", handling: keep(IMPORT_STAGING) },

  // Clients
  { side: "customer", table: "customer_contacts", column: "customer_id", handling: move("people") },
  { side: "customer", table: "project_contacts", column: "customer_id", handling: move("project_contacts") },
  { side: "customer", table: "project_contacts", column: "source_entity_id", when: "source_entity_type = 'customer'", handling: move("project_contacts", false) },
  { side: "customer", table: "projects", column: "client_customer_id", handling: move("client_jobs") },
  { side: "customer", table: "invoices", column: "customer_id", handling: move("invoices_payments") },
  { side: "customer", table: "credit_memos", column: "customer_id", handling: move("invoices_payments") },
  { side: "customer", table: "payments", column: "customer_id", handling: move("invoices_payments") },
  { side: "customer", table: "email_reply_threads", column: "source_id", when: "source_type = 'customer'", handling: move("email_threads") },
  { side: "customer", table: "activity_events", column: "entity_id", when: "entity_type = 'customer'", handling: move("activity") },
  { side: "customer", table: "customers", column: "merged_into_customer_id", handling: move("merged_records") },
  {
    side: "customer", table: "sage_client_project_write_operations", column: "customer_id",
    handling: keep("a Sage client/job write made for the archived record and stamped with its Sage client; an active write blocks the merge, and moving finished ones would put a second Sage client on the kept record"),
  },
  { side: "customer", table: "sage_contact_create_proposals", column: "customer_id", handling: keep(SAGE_CREATE) },
  { side: "customer", table: "buildertrend_staging_access_candidates", column: "matched_customer_id", handling: keep(IMPORT_STAGING) },
  { side: "customer", table: "buildertrend_staging_identity_decisions", column: "customer_provenance_id", handling: keep(IMPORT_STAGING) },

  // Polymorphic columns that can hold either company (see src/db/id-integrity.ts).
  ...COMPANY_MERGE_SIDES.flatMap((side): CompanyReference[] => [
    { side, table: "sage_contact_read_requests", column: "entity_id", handling: keep(SAGE_REVIEW) },
    { side, table: "sage_contact_change_proposals", column: "entity_id", handling: keep(SAGE_REVIEW) },
    { side, table: "sage_contact_snapshots", column: "entity_id", handling: keep(SAGE_REVIEW) },
    { side, table: "contact_merge_events", column: "source_id", handling: keep(MERGE_HISTORY) },
    { side, table: "contact_merge_events", column: "destination_id", handling: keep(MERGE_HISTORY) },
    {
      side, table: "notification_events", column: "source_id",
      handling: keep("a notification already delivered; it is history and its link was resolved when it was sent"),
    },
  ]),
]

/** The archived and kept company tables and merge pointer for one side. */
function companyTable(side: CompanyMergeSide): { readonly table: "vendors" | "customers"; readonly mergedInto: string } {
  return side === "vendor"
    ? { table: "vendors", mergedInto: "merged_into_vendor_id" }
    : { table: "customers", mergedInto: "merged_into_customer_id" }
}

/**
 * The condition every move statement carries, so a statement does nothing
 * unless the pair is still in the state the caller checked: for a merge the
 * source is live, for a repair it is merged into the destination; the
 * destination is always live. Binds follow the SQL.
 */
export function companyMoveGuard(move: CompanyReferenceMove): { readonly sql: string; readonly binds: readonly unknown[] } {
  const { table, mergedInto } = companyTable(move.side)
  return {
    sql: `EXISTS (SELECT 1 FROM ${table} merge_source WHERE merge_source.id = ? AND merge_source.organization_id = ? AND merge_source.${mergedInto} IS ?)
      AND EXISTS (SELECT 1 FROM ${table} merge_target WHERE merge_target.id = ? AND merge_target.organization_id = ? AND merge_target.${mergedInto} IS NULL)`,
    binds: [move.sourceId, move.organizationId, move.mode === "merge" ? null : move.destinationId, move.destinationId, move.organizationId],
  }
}

export function companyReferencesFor(side: CompanyMergeSide): readonly CompanyReference[] {
  return COMPANY_REFERENCES.filter((reference) => reference.side === side)
}
