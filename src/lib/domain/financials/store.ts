import { eq } from "drizzle-orm"

import {
  creditMemos,
  invoices,
  payments,
  vendorBills,
  type NewCreditMemo,
  type NewInvoice,
  type NewPayment,
  type NewVendorBill,
} from "@/db/schema-netsuite"
import type { Db } from "@/lib/server/action-context"

/**
 * The only writer of the financial tables: invoices, vendor bills, payments
 * and credit memos (architecture standard, section 1). Callers resolve
 * access and compute totals (rules.ts) first; this module only writes.
 */

export async function insertInvoice(db: Db, values: NewInvoice): Promise<void> {
  await db.insert(invoices).values(values)
}

export async function updateInvoiceRow(db: Db, id: string, values: Partial<NewInvoice>): Promise<void> {
  await db.update(invoices).set(values).where(eq(invoices.id, id))
}

export async function deleteInvoiceRow(db: Db, id: string): Promise<void> {
  await db.delete(invoices).where(eq(invoices.id, id))
}

export async function insertVendorBill(db: Db, values: NewVendorBill): Promise<void> {
  await db.insert(vendorBills).values(values)
}

export async function updateVendorBillRow(db: Db, id: string, values: Partial<NewVendorBill>): Promise<void> {
  await db.update(vendorBills).set(values).where(eq(vendorBills.id, id))
}

export async function deleteVendorBillRow(db: Db, id: string): Promise<void> {
  await db.delete(vendorBills).where(eq(vendorBills.id, id))
}

export async function insertPayment(db: Db, values: NewPayment): Promise<void> {
  await db.insert(payments).values(values)
}

export async function updatePaymentRow(db: Db, id: string, values: Partial<NewPayment>): Promise<void> {
  await db.update(payments).set(values).where(eq(payments.id, id))
}

export async function deletePaymentRow(db: Db, id: string): Promise<void> {
  await db.delete(payments).where(eq(payments.id, id))
}

export async function insertCreditMemo(db: Db, values: NewCreditMemo): Promise<void> {
  await db.insert(creditMemos).values(values)
}

export async function updateCreditMemoRow(db: Db, id: string, values: Partial<NewCreditMemo>): Promise<void> {
  await db.update(creditMemos).set(values).where(eq(creditMemos.id, id))
}

export async function deleteCreditMemoRow(db: Db, id: string): Promise<void> {
  await db.delete(creditMemos).where(eq(creditMemos.id, id))
}
