import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { upsertSquareOwnerReceivable } from "@/lib/sage/square-receivable";

type SqliteStatement = Readonly<{
  readonly run: (...values: readonly unknown[]) => { readonly changes: number };
  readonly all: (...values: readonly unknown[]) => readonly unknown[];
  readonly get: (...values: readonly unknown[]) => unknown;
}>;

type Sqlite = Readonly<{
  readonly exec: (sql: string) => void;
  readonly close: () => void;
  readonly prepare: (sql: string) => SqliteStatement;
}>;

type SqliteConstructor = new (file: string) => Sqlite;

function isSqliteConstructor(value: unknown): value is SqliteConstructor {
  return typeof value === "function";
}

const nodeRequire = createRequire(import.meta.url);

function newSqlite(): Sqlite {
  try {
    const imported: unknown = nodeRequire("better-sqlite3");
    if (isSqliteConstructor(imported)) return new imported(":memory:");
    const defaultImport =
      imported !== null && typeof imported === "object"
        ? Reflect.get(imported, "default")
        : undefined;
    if (isSqliteConstructor(defaultImport)) {
      return new defaultImport(":memory:");
    }
  } catch {
    // Continue to the built-in runtimes when the native addon is absent.
  }
  try {
    const imported: unknown = nodeRequire("node:sqlite");
    const database =
      imported !== null && typeof imported === "object"
        ? Reflect.get(imported, "DatabaseSync")
        : undefined;
    if (isSqliteConstructor(database)) return new database(":memory:");
  } catch {
    // Bun does not expose Node's built-in SQLite module.
  }
  const imported: unknown = nodeRequire("bun:sqlite");
  const database =
    imported !== null && typeof imported === "object"
      ? Reflect.get(imported, "Database")
      : undefined;
  if (isSqliteConstructor(database)) return new database(":memory:");
  throw new Error("No SQLite test adapter is available");
}

function createD1(sqlite: Sqlite): unknown {
  function prepared(
    query: string,
    values: readonly unknown[] = [],
  ): Record<string, unknown> {
    const statement = sqlite.prepare(query);
    return {
      bind: (...nextValues: readonly unknown[]): unknown =>
        prepared(query, nextValues),
      run: async (): Promise<unknown> => {
        const info = statement.run(...values);
        return { success: true, meta: { changes: Number(info.changes) } };
      },
      all: async (): Promise<unknown> => ({
        success: true,
        results: statement.all(...values),
      }),
      first: async (): Promise<unknown> => statement.get(...values) ?? null,
    };
  }
  return {
    prepare(query: string): unknown {
      return prepared(query);
    },
    async batch(
      statements: readonly { readonly run: () => Promise<unknown> }[],
    ): Promise<readonly unknown[]> {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

function createSchema(sqlite: Sqlite): void {
  sqlite.exec(`
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY, organization_id TEXT, customer_id TEXT NOT NULL,
      project_id TEXT, source_system TEXT NOT NULL, source_external_id TEXT,
      invoice_number TEXT, status TEXT NOT NULL, issue_date TEXT NOT NULL,
      due_date TEXT, subtotal REAL NOT NULL, tax REAL NOT NULL,
      total REAL NOT NULL, amount_paid REAL NOT NULL, amount_due REAL NOT NULL,
      memo TEXT, line_items TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX invoices_source_identity_unique
      ON invoices (organization_id, source_system, source_external_id);
    CREATE TABLE payments (
      id TEXT PRIMARY KEY, organization_id TEXT, customer_id TEXT,
      vendor_id TEXT, project_id TEXT, source_system TEXT NOT NULL,
      source_external_id TEXT, payment_type TEXT NOT NULL, amount REAL NOT NULL,
      gross_amount_cents INTEGER, processing_fee_cents INTEGER,
      net_amount_cents INTEGER, cash_receipt INTEGER NOT NULL,
      payment_date TEXT NOT NULL, payment_method TEXT, reference_number TEXT,
      memo TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX payments_source_identity_unique
      ON payments (organization_id, source_system, source_external_id);
    CREATE TABLE invoice_payment_allocations (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL, payment_id TEXT NOT NULL,
      allocation_cents INTEGER NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (invoice_id, payment_id)
    );
    CREATE TABLE project_operations (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_system TEXT NOT NULL,
      source_record_type TEXT NOT NULL, source_record_id TEXT,
      source_record_number TEXT, title TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL, priority TEXT NOT NULL, assignee_type TEXT,
      company_name TEXT, start_date TEXT, due_date TEXT, amount REAL,
      sage_job_number TEXT, sage_write_status TEXT NOT NULL,
      sync_direction TEXT NOT NULL, sync_status TEXT NOT NULL,
      last_synced_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
}

describe("Square owner receivable projection", () => {
  let sqlite: Sqlite;

  beforeEach(() => {
    sqlite = newSqlite();
    createSchema(sqlite);
  });

  afterEach(() => sqlite.close());

  it("upserts and allocates the exact Sage invoice without duplicates", async () => {
    sqlite
      .prepare(
        `INSERT INTO invoices (
         id, organization_id, customer_id, project_id, source_system,
         source_external_id, invoice_number, status, issue_date, due_date,
         subtotal, tax, total, amount_paid, amount_due, memo, line_items,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'sage', ?, NULL, 'open', ?, NULL,
         0, 0, 0, 0, 0, NULL, NULL, ?, ?)`,
      )
      .run(
        "existing-compass-invoice",
        "org-1",
        "customer-1",
        "project-1",
        "sage-ar-invoice:401",
        "2026-09-01",
        "2026-09-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
      );
    const env = { DB: createD1(sqlite) };
    const input = {
      organizationId: "org-1",
      projectId: "project-1",
      customerId: "customer-1",
      customerName: "Stockbridge, James",
      sageJobShortName: "H-403-4378",
      sageInvoiceId: "401",
      sageInvoiceNumber: "H-403-4378-0005",
      squareInvoiceId: "inv:stockbridge",
      squarePaymentId: "payment-stockbridge",
      invoiceIssueDate: "2026-09-01",
      invoiceDueDate: "2026-09-08",
      invoiceTotalCents: 690200,
      invoiceTaxCents: 0,
      paymentCompletedAt: "2026-09-08T22:00:00.000Z",
      paymentAmountCents: 690200,
      processingFeeCents: 20326,
    };
    const invoke = (): Promise<unknown> =>
      Reflect.apply(upsertSquareOwnerReceivable, undefined, [
        env,
        input,
        "2026-09-08T22:01:00.000Z",
      ]);

    await invoke();
    await invoke();

    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM invoices").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM payments").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM invoice_payment_allocations")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM project_operations").get(),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .prepare(
          `SELECT id, invoice_number, status, total, amount_paid, amount_due
         FROM invoices`,
        )
        .get(),
    ).toEqual({
      id: "existing-compass-invoice",
      invoice_number: "H-403-4378-0005",
      status: "paid",
      total: 6902,
      amount_paid: 6902,
      amount_due: 0,
    });
    expect(
      sqlite
        .prepare(
          `SELECT gross_amount_cents, processing_fee_cents, net_amount_cents
         FROM payments`,
        )
        .get(),
    ).toEqual({
      gross_amount_cents: 690200,
      processing_fee_cents: 20326,
      net_amount_cents: 669874,
    });
  });
});
