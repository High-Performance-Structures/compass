import "server-only"

import { and, eq, isNotNull } from "drizzle-orm"

import { customers, projects } from "@/db/schema"
import { sageTaxEntities } from "@/db/schema-estimates"
import { invoices } from "@/db/schema-netsuite"
import type { InvoiceDocumentData } from "@/lib/financials/simple-invoice-document-types"
import { loadSimpleInvoice } from "@/lib/financials/simple-invoices-server"
import type { Db } from "@/lib/server/action-context"

function billingAddress(customer: {
  readonly billingAddressLine1: string | null
  readonly billingAddressLine2: string | null
  readonly billingCity: string | null
  readonly billingState: string | null
  readonly billingPostalCode: string | null
  readonly address: string | null
}): string | null {
  const cityLine = [customer.billingCity, [customer.billingState, customer.billingPostalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")
  const lines = [customer.billingAddressLine1, customer.billingAddressLine2, cityLine].filter((line): line is string => Boolean(line?.trim()))
  return lines.length > 0 ? lines.join("\n") : customer.address
}

/** The invoice as its Print Preview (and emailed PDF) shows it; the print page checks project access first. */
export async function loadSimpleInvoiceDocument(db: Db, projectId: string, invoiceId: string): Promise<InvoiceDocumentData | null> {
  const head = await db
    .select({
      organizationId: projects.organizationId,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
      projectAddress: projects.address,
      customerId: invoices.customerId,
      taxEntityId: invoices.taxEntityId,
    })
    .from(invoices)
    .innerJoin(projects, eq(projects.id, invoices.projectId))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.projectId, projectId), isNotNull(invoices.invoiceKind)))
    .get()
  if (!head?.organizationId) return null
  const [invoice, customer, district] = await Promise.all([
    loadSimpleInvoice(db, head.organizationId, projectId, invoiceId),
    db
      .select({
        name: customers.name,
        address: customers.address,
        billingAddressLine1: customers.billingAddressLine1,
        billingAddressLine2: customers.billingAddressLine2,
        billingCity: customers.billingCity,
        billingState: customers.billingState,
        billingPostalCode: customers.billingPostalCode,
      })
      .from(customers)
      .where(eq(customers.id, head.customerId))
      .get(),
    head.taxEntityId ? db.select({ name: sageTaxEntities.name }).from(sageTaxEntities).where(eq(sageTaxEntities.id, head.taxEntityId)).get() : Promise.resolve(undefined),
  ])
  if (!invoice) return null
  return {
    invoiceNumber: invoice.invoiceNumber,
    creditMemo: invoice.invoiceKind === "credit_memo",
    status: invoice.status,
    title: invoice.title,
    memo: invoice.memo,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    billTo: { name: customer?.name ?? null, address: customer ? billingAddress(customer) : null },
    project: { name: head.projectName, projectNumber: head.projectNumber, address: head.projectAddress },
    lines: invoice.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      amountCents: line.amountCents,
      taxable: line.taxable,
    })),
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    taxDistrictName: district?.name ?? null,
    totalCents: invoice.totalCents,
    amountPaidCents: invoice.amountPaidCents,
    squarePublicUrl: invoice.squarePublicUrl,
  }
}
