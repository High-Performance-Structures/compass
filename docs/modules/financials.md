Financials Module
===

The financials module tracks invoices, vendor bills, payments, and credit memos. These are the bread-and-butter financial documents in construction project management: invoices go out to clients, vendor bills come in from subcontractors and suppliers, payments record money moving, and credit memos adjust balances.

The module is designed to work both standalone (manual data entry in Compass) and as the local representation of NetSuite records (synced bidirectionally by the NetSuite module). Every financial table has a `netsuiteId` column that links to the NetSuite internal record when sync is active.


data model
---

All four financial tables are defined in `src/db/schema-netsuite.ts` alongside the sync infrastructure tables. They live in this schema file rather than the core schema because they were built specifically for the NetSuite integration, even though they're useful independently.

**`invoices`** -- customer-facing bills. Each invoice belongs to a customer and optionally a project. Tracks status (draft, open, paid, voided), issue date, due date, line-item subtotal/tax/total, amount paid, and amount remaining. Line items are stored as a JSON text column.

```typescript
export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  netsuiteId: text("netsuite_id"),
  customerId: text("customer_id").notNull().references(() => customers.id),
  projectId: text("project_id").references(() => projects.id),
  invoiceNumber: text("invoice_number"),
  status: text("status").notNull().default("draft"),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date"),
  subtotal: real("subtotal").notNull().default(0),
  tax: real("tax").notNull().default(0),
  total: real("total").notNull().default(0),
  amountPaid: real("amount_paid").notNull().default(0),
  amountDue: real("amount_due").notNull().default(0),
  memo: text("memo"),
  lineItems: text("line_items"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})
```

**`vendor_bills`** -- bills from vendors (subcontractors, material suppliers). Same structure as invoices but references vendors instead of customers. Status defaults to "pending" rather than "draft" since bills arrive from external parties.

**`payments`** -- money in or out. Payments can reference a customer (incoming) or vendor (outgoing) and optionally a project. Tracks payment type, amount, date, method, and reference number. The `paymentType` field distinguishes between customer payments and vendor payments.

**`credit_memos`** -- adjustments to customer balances. Track status, total amount, amount applied to invoices, and remaining balance. Like invoices, line items are stored as JSON.


line items
---

Invoices, vendor bills, and credit memos store their line items as a JSON string in the `lineItems` column. This is a deliberate choice over normalized line-item tables: it simplifies the CRUD operations (one insert/update instead of insert-parent-then-insert-children), works well with the single-request-per-record constraint of NetSuite's REST API, and avoids the impedance mismatch between Compass's flat line items and NetSuite's nested `item.items` array.

When syncing with NetSuite, the line items are mapped between the local JSON format and NetSuite's `NetSuiteLineItem` type:

```typescript
export interface NetSuiteLineItem {
  line: number
  item: { id: string; refName: string }
  quantity: number
  rate: number
  amount: number
  description?: string
}
```

The `line` field is critical when updating line items in NetSuite. Omitting it causes NetSuite to add new line items instead of updating existing ones. This is one of the documented gotchas in the NetSuite module.


server actions
---

Each financial entity has its own action file with the same five operations:

`src/app/actions/invoices.ts`:
- `getInvoices(projectId?)` -- list all invoices, optionally filtered by project
- `getInvoice(id)` -- get a single invoice
- `createInvoice(data)` -- create an invoice
- `updateInvoice(id, data)` -- update an invoice
- `deleteInvoice(id)` -- delete an invoice

`src/app/actions/vendor-bills.ts`:
- `getVendorBills(projectId?)` / `getVendorBill(id)` / `createVendorBill(data)` / `updateVendorBill(id, data)` / `deleteVendorBill(id)`

`src/app/actions/payments.ts`:
- `getPayments()` / `getPayment(id)` / `createPayment(data)` / `updatePayment(id, data)` / `deletePayment(id)`

`src/app/actions/credit-memos.ts`:
- `getCreditMemos()` / `getCreditMemo(id)` / `createCreditMemo(data)` / `updateCreditMemo(id, data)` / `deleteCreditMemo(id)`

All actions require `finance` permission scope. Read operations need `finance:read`, creates need `finance:create`, updates need `finance:update`, deletes need `finance:delete`. All mutations revalidate `/dashboard/financials`.

The action structure is intentionally uniform. Each file follows the same pattern:

```typescript
export async function createInvoice(
  data: Omit<NewInvoice, "id" | "createdAt" | "updatedAt">
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "create")
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await db.insert(invoices).values({ id, ...data, createdAt: now, updatedAt: now })
    revalidatePath("/dashboard/financials")
    return { success: true, id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "..." }
  }
}
```


NetSuite sync integration
---

When the NetSuite module is active, financial records flow bidirectionally:

**Pull (NetSuite -> Compass):** The `InvoiceMapper` and `VendorBillMapper` in `src/lib/netsuite/mappers/` translate NetSuite records into the local format. The delta sync pulls invoices and vendor bills modified since the last sync, upserts them locally, and tracks sync status per record.

**Push (Compass -> NetSuite):** Records created or modified in Compass get their sync metadata set to `pending_push`. The push operation sends them to NetSuite using idempotency keys to prevent duplicate creation.

**Linking:** The `netsuiteId` column on each financial table stores NetSuite's internal record ID. The `netsuite_sync_metadata` table tracks per-record sync state (synced, pending_push, conflict, error) with timestamps and retry counts.

Financial records can exist without a `netsuiteId` if they were created locally and haven't been synced yet, or if NetSuite integration isn't active. The UI works the same either way.


UI components
---

`src/components/financials/` provides 13 components:

**Tables:**
- `invoices-table.tsx` -- data table with sorting, filtering, status badges
- `vendor-bills-table.tsx` -- same for vendor bills
- `payments-table.tsx` -- payments list
- `credit-memos-table.tsx` -- credit memos list
- `customers-table.tsx` -- customer directory
- `vendors-table.tsx` -- vendor directory

**Dialogs:**
- `invoice-dialog.tsx` -- create/edit invoice form
- `vendor-bill-dialog.tsx` -- create/edit vendor bill form
- `payment-dialog.tsx` -- create/edit payment form
- `credit-memo-dialog.tsx` -- create/edit credit memo form
- `customer-dialog.tsx` -- create/edit customer form
- `vendor-dialog.tsx` -- create/edit vendor form

**Shared:**
- `line-items-editor.tsx` -- reusable line-item editor component used by invoices, vendor bills, and credit memos. Supports adding, removing, and editing line items with automatic total calculation.

The customer and vendor components live in the financials directory because they're primarily used in financial contexts (selecting a customer for an invoice, selecting a vendor for a bill), even though the underlying `customers` and `vendors` tables are core entities used elsewhere.
