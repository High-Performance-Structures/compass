import "server-only"

import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm"

import { customers, projectContacts, projects, sageCostCodes } from "@/db/schema"
import { projectEstimateLines, projectEstimates, sageTaxEntities } from "@/db/schema-estimates"
import { invoiceLines, invoices } from "@/db/schema-netsuite"
import { nuTechCatalogPrices, nuTechCatalogVersions, nuTechOrderItems, nuTechOrderWorkflows, nuTechProducts } from "@/db/schema-nutech"
import { sageInvoiceArExports } from "@/db/schema-sage"
import { chunkD1Values } from "@/lib/d1-query"
import {
  effectivePriceMode,
  estimateLineRemaining,
  estimateUnitPriceCents,
  type EstimateLineBilling,
  type InvoiceLineInput,
} from "@/lib/domain/financials/simple-invoice-rules"
import type { InvoiceCustomerType, InvoicePriceMode, SimpleInvoiceKind } from "@/lib/domain/financials/statuses"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { SimpleInvoiceSettings } from "@/lib/feature-settings/simple-invoice-settings"
import { nuTechCustomerPriceCents } from "@/lib/nutech/catalog-pricing"
import { nuTechEstimateLineDescription } from "@/lib/nutech/estimate-wording"
import { NUTECH_FREIGHT_CATEGORY } from "@/lib/nutech/freight"
import { resolvedProjectDepartment } from "@/lib/project-branding"
import type { Db } from "@/lib/server/action-context"

/*
 * Reads for simple invoices (Compass-built material sales and one-off work):
 * the job, an estimate's lines with what earlier invoices billed, the price
 * list for catalog items, and the invoice itself. Writes go through the
 * financials store; Sage goes through simple-invoice-sage.ts.
 */

/** Estimates staff may invoice from: sent for signature, accepted, or legacy "sent". */
const INVOICEABLE_ESTIMATE_STATUSES = ["signature_pending", "accepted", "sent"] as const

export type SimpleInvoiceProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly department: string | null
  readonly sageJobNumber: string | null
  readonly sageJobId: string | null
}

export async function loadSimpleInvoiceProject(db: Db, organizationId: string, projectId: string): Promise<SimpleInvoiceProject | null> {
  const row = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      department: projects.department,
      sageJobNumber: projects.sageJobNumber,
      sageJobId: projects.sageJobId,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()
  if (!row) return null
  return {
    ...row,
    department: resolvedProjectDepartment({ department: row.department, projectId: row.id, projectNumber: row.projectNumber }),
    sageJobNumber: row.sageJobNumber?.trim() || null,
    sageJobId: row.sageJobId?.trim() || null,
  }
}

export function readSimpleInvoiceSettings(db: Db, organizationId: string): Promise<SimpleInvoiceSettings> {
  return readFeatureSettings(db, organizationId, "simple-invoices")
}

/** The bill-to customer to suggest: the job's owner company, else its linked client. */
export async function defaultBillToCustomerId(db: Db, organizationId: string, projectId: string): Promise<string | null> {
  const owner = await db
    .selectDistinct({ id: customers.id })
    .from(projectContacts)
    .innerJoin(customers, eq(customers.id, projectContacts.sourceEntityId))
    .where(
      and(
        eq(projectContacts.projectId, projectId),
        eq(projectContacts.contactType, "owner"),
        eq(projectContacts.sourceEntityType, "customer"),
        eq(projectContacts.active, true),
        eq(customers.organizationId, organizationId)
      )
    )
    .limit(2)
  if (owner.length === 1 && owner[0]) return owner[0].id
  const project = await db
    .select({ id: projects.clientCustomerId })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()
  return project?.id ?? null
}

export type CustomerOption = { readonly id: string; readonly name: string; readonly email: string | null }

/** The company's customers for the Bill to picker. */
export async function loadCustomerOptions(db: Db, organizationId: string): Promise<readonly CustomerOption[]> {
  const rows = await db
    .select({ id: customers.id, name: customers.name, email: customers.primaryEmail, fallbackEmail: customers.email })
    .from(customers)
    .where(eq(customers.organizationId, organizationId))
    .orderBy(asc(customers.name))
    .limit(5000)
  return rows.map((row) => ({ id: row.id, name: row.name, email: row.email ?? row.fallbackEmail }))
}

export type TaxDistrictOption = { readonly id: string; readonly name: string; readonly code: string; readonly rateBasisPoints: number }

export async function loadTaxDistrictOptions(db: Db): Promise<readonly TaxDistrictOption[]> {
  return db
    .select({ id: sageTaxEntities.id, name: sageTaxEntities.name, code: sageTaxEntities.code, rateBasisPoints: sageTaxEntities.rateBasisPoints })
    .from(sageTaxEntities)
    .where(eq(sageTaxEntities.active, true))
    .orderBy(asc(sageTaxEntities.name))
}

export type InvoiceableEstimate = {
  readonly id: string
  readonly estimateNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly status: string
}

/** The job's estimates that can be invoiced (contract estimates sent or accepted, newest first). */
export async function loadInvoiceableEstimates(db: Db, projectId: string): Promise<readonly InvoiceableEstimate[]> {
  return db
    .select({
      id: projectEstimates.id,
      estimateNumber: projectEstimates.estimateNumber,
      versionNumber: projectEstimates.versionNumber,
      title: projectEstimates.title,
      status: projectEstimates.status,
    })
    .from(projectEstimates)
    .where(and(eq(projectEstimates.projectId, projectId), inArray(projectEstimates.status, [...INVOICEABLE_ESTIMATE_STATUSES])))
    .orderBy(desc(projectEstimates.updatedAt))
}

export type EstimateLineForInvoice = EstimateLineBilling & {
  readonly costCode: string
  readonly description: string
  readonly unit: string
  readonly taxable: boolean
  readonly unitPriceCents: number
  readonly remainingQuantity: number
  readonly remainingCents: number
  readonly nutechProductId: string | null
}

export type EstimateForInvoice = {
  readonly estimate: InvoiceableEstimate & { readonly defaultTaxEntityId: string | null }
  readonly lines: readonly EstimateLineForInvoice[]
  /** The Nu-Tech order that fills this estimate, for its price list. */
  readonly order: { readonly customerType: InvoiceCustomerType; readonly pricingMode: InvoicePriceMode; readonly taxEntityId: string | null } | null
}

function customerType(value: string | null | undefined): InvoiceCustomerType {
  return value === "new" ? "new" : "returning"
}

function priceMode(value: string | null | undefined): InvoicePriceMode {
  return value === "cash_discount" ? "cash_discount" : "standard"
}

/**
 * What every non-void simple invoice (other than `excludeInvoiceId`) has
 * billed against these estimate lines.
 */
async function invoicedByEstimateLine(
  db: Db,
  estimateLineIds: readonly string[],
  excludeInvoiceId: string | null
): Promise<ReadonlyMap<string, { readonly quantity: number; readonly cents: number }>> {
  const totals = new Map<string, { quantity: number; cents: number }>()
  for (const ids of chunkD1Values([...estimateLineIds])) {
    const rows = await db
      .select({
        estimateLineId: invoiceLines.estimateLineId,
        quantity: sql<number>`sum(${invoiceLines.quantity})`,
        cents: sql<number>`sum(${invoiceLines.amountCents})`,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(
        and(
          inArray(invoiceLines.estimateLineId, ids),
          eq(invoiceLines.source, "estimate"),
          ne(invoices.status, "void"),
          excludeInvoiceId ? ne(invoices.id, excludeInvoiceId) : undefined
        )
      )
      .groupBy(invoiceLines.estimateLineId)
    for (const row of rows) {
      if (row.estimateLineId) totals.set(row.estimateLineId, { quantity: Number(row.quantity) || 0, cents: Number(row.cents) || 0 })
    }
  }
  return totals
}

/**
 * Matches estimate lines a Nu-Tech order filled to their price list
 * products: the order fills each line with the description it generates
 * (`nuTechEstimateLineDescription`), so an exact description match is the
 * product. Unmatched lines (shipping, typed lines) keep their own price.
 */
async function matchOrderProducts(
  db: Db,
  orderId: string,
  lines: readonly { readonly id: string; readonly description: string }[]
): Promise<ReadonlyMap<string, string>> {
  const items = await db
    .select({
      productId: nuTechOrderItems.productId,
      quantity: nuTechOrderItems.quantity,
      sku: nuTechOrderItems.manufacturerSkuSnapshot,
      name: nuTechOrderItems.productNameSnapshot,
      unit: nuTechOrderItems.priceUnitSnapshot,
      packageLabel: nuTechProducts.packageLabel,
    })
    .from(nuTechOrderItems)
    .innerJoin(nuTechProducts, eq(nuTechProducts.id, nuTechOrderItems.productId))
    .where(eq(nuTechOrderItems.workflowId, orderId))
  const byDescription = new Map(items.map((item) => [nuTechEstimateLineDescription(item), item.productId]))
  const matches = new Map<string, string>()
  for (const line of lines) {
    const productId = byDescription.get(line.description.trim())
    if (productId) matches.set(line.id, productId)
  }
  return matches
}

/** An estimate's lines with what is left to invoice, for "Invoice from estimate" and the line editor. */
export async function loadEstimateForInvoice(
  db: Db,
  projectId: string,
  estimateId: string,
  excludeInvoiceId: string | null
): Promise<EstimateForInvoice | null> {
  const estimate = await db
    .select({
      id: projectEstimates.id,
      estimateNumber: projectEstimates.estimateNumber,
      versionNumber: projectEstimates.versionNumber,
      title: projectEstimates.title,
      status: projectEstimates.status,
      defaultTaxEntityId: projectEstimates.defaultTaxEntityId,
    })
    .from(projectEstimates)
    .where(and(eq(projectEstimates.id, estimateId), eq(projectEstimates.projectId, projectId)))
    .get()
  if (!estimate) return null
  const [rows, order] = await Promise.all([
    db
      .select({
        id: projectEstimateLines.id,
        costCode: projectEstimateLines.costCode,
        description: projectEstimateLines.description,
        quantity: projectEstimateLines.quantity,
        unit: projectEstimateLines.unit,
        directCostCents: projectEstimateLines.directCostCents,
        markupCents: projectEstimateLines.markupCents,
        taxable: projectEstimateLines.taxable,
      })
      .from(projectEstimateLines)
      .where(and(eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.projectId, projectId)))
      .orderBy(asc(projectEstimateLines.divisionCode), asc(projectEstimateLines.sortOrder)),
    db
      .select({
        id: nuTechOrderWorkflows.id,
        customerType: nuTechOrderWorkflows.customerType,
        pricingMode: nuTechOrderWorkflows.pricingMode,
        taxEntityId: nuTechOrderWorkflows.taxEntityId,
      })
      .from(nuTechOrderWorkflows)
      .where(and(eq(nuTechOrderWorkflows.projectId, projectId), eq(nuTechOrderWorkflows.estimateId, estimateId)))
      .orderBy(asc(nuTechOrderWorkflows.orderNumber))
      .get(),
  ])
  const [invoiced, products] = await Promise.all([
    invoicedByEstimateLine(db, rows.map((row) => row.id), excludeInvoiceId),
    order ? matchOrderProducts(db, order.id, rows) : Promise.resolve(new Map<string, string>()),
  ])
  const lines = rows.map((row): EstimateLineForInvoice => {
    const billed = invoiced.get(row.id)
    const billing: EstimateLineBilling = {
      estimateLineId: row.id,
      quantity: row.quantity,
      sellCents: row.directCostCents + row.markupCents,
      invoicedQuantity: billed?.quantity ?? 0,
      invoicedCents: billed?.cents ?? 0,
    }
    const remaining = estimateLineRemaining(billing)
    return {
      ...billing,
      costCode: row.costCode,
      description: row.description,
      unit: row.unit,
      taxable: row.taxable,
      unitPriceCents: estimateUnitPriceCents(billing),
      remainingQuantity: remaining.quantity,
      remainingCents: remaining.cents,
      nutechProductId: products.get(row.id) ?? null,
    }
  })
  return {
    estimate,
    lines,
    order: order ? { customerType: customerType(order.customerType), pricingMode: priceMode(order.pricingMode), taxEntityId: order.taxEntityId } : null,
  }
}

export type CatalogProductOption = {
  readonly id: string
  readonly sku: string
  readonly name: string
  readonly unit: string
  readonly packageLabel: string
  readonly costCode: string | null
  readonly taxable: boolean
  readonly prices: {
    readonly newStandardPriceCents: number
    readonly newCashPriceCents: number
    readonly returningStandardPriceCents: number
    readonly returningCashPriceCents: number
  }
}

/** The active Nu-Tech price list for picking catalog items onto an invoice; empty when the company has none. */
export async function loadCatalogProducts(db: Db, organizationId: string): Promise<readonly CatalogProductOption[]> {
  const version = await db
    .select({ id: nuTechCatalogVersions.id })
    .from(nuTechCatalogVersions)
    .where(and(eq(nuTechCatalogVersions.organizationId, organizationId), eq(nuTechCatalogVersions.status, "active")))
    .orderBy(desc(nuTechCatalogVersions.effectiveDate))
    .get()
  if (!version) return []
  const rows = await db
    .select({
      id: nuTechProducts.id,
      sku: nuTechProducts.manufacturerSku,
      name: nuTechProducts.name,
      unit: nuTechProducts.priceUnit,
      packageLabel: nuTechProducts.packageLabel,
      category: nuTechProducts.category,
      costCodeName: nuTechProducts.sageCostCodeName,
      taxable: nuTechProducts.taxable,
      newStandardPriceCents: nuTechCatalogPrices.newStandardPriceCents,
      newCashPriceCents: nuTechCatalogPrices.newCashPriceCents,
      returningStandardPriceCents: nuTechCatalogPrices.returningStandardPriceCents,
      returningCashPriceCents: nuTechCatalogPrices.returningCashPriceCents,
    })
    .from(nuTechCatalogPrices)
    .innerJoin(nuTechProducts, eq(nuTechProducts.id, nuTechCatalogPrices.productId))
    .where(and(eq(nuTechCatalogPrices.catalogVersionId, version.id), eq(nuTechProducts.organizationId, organizationId), eq(nuTechProducts.active, true)))
    .orderBy(asc(nuTechProducts.category), asc(nuTechProducts.name))
  const codes = await loadProductCostCodes(db, rows.map((row) => row.id))
  return rows
    .filter((row) => row.category !== NUTECH_FREIGHT_CATEGORY)
    .map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      unit: row.unit,
      packageLabel: row.packageLabel,
      costCode: codes.get(row.id) ?? row.costCodeName,
      taxable: row.taxable,
      prices: {
        newStandardPriceCents: row.newStandardPriceCents,
        newCashPriceCents: row.newCashPriceCents,
        returningStandardPriceCents: row.returningStandardPriceCents,
        returningCashPriceCents: row.returningCashPriceCents,
      },
    }))
}

async function loadProductCostCodes(db: Db, productIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const codes = new Map<string, string>()
  for (const ids of chunkD1Values([...productIds])) {
    const rows = await db
      .select({ id: nuTechProducts.id, code: sageCostCodes.code })
      .from(nuTechProducts)
      .innerJoin(sageCostCodes, eq(sageCostCodes.id, nuTechProducts.sageCostCodeId))
      .where(and(inArray(nuTechProducts.id, ids), isNotNull(nuTechProducts.sageCostCodeId)))
    for (const row of rows) if (row.code) codes.set(row.id, row.code)
  }
  return codes
}

/**
 * Applies the price list to catalog-priced lines, on the server, before a
 * draft is saved. Added catalog items take the price list's price for the
 * invoice's customer type and mode. Estimate lines keep the estimate's
 * price, except that Square on a cash-discount sale switches matched
 * products to the regular price (cash/check discount only applies off
 * Square). Typed lines keep what staff entered.
 */
export function priceInvoiceLines(
  lines: readonly InvoiceLineInput[],
  input: {
    readonly squareRequested: boolean
    readonly priceMode: InvoicePriceMode
    readonly customerType: InvoiceCustomerType
    readonly catalog: ReadonlyMap<string, CatalogProductOption>
  }
): readonly InvoiceLineInput[] {
  const mode = effectivePriceMode(input)
  return lines.map((line) => {
    const product = line.nutechProductId ? input.catalog.get(line.nutechProductId) : undefined
    if (!product) return line
    const described = { ...line, description: productDescription(line, product) }
    if (line.source === "estimate" && !(input.squareRequested && input.priceMode === "cash_discount")) return described
    return { ...described, unitPriceCents: nuTechCustomerPriceCents(product.prices, input.customerType, mode) }
  })
}

/**
 * A price list line's wording follows its quantity ("30 Core Straight
 * (SKU), 2 bundles of 15"), but only while it still reads exactly as the
 * wording Compass generated; anything staff retyped is kept.
 */
function productDescription(line: InvoiceLineInput, product: CatalogProductOption): string {
  const wording = (quantity: number): string =>
    nuTechEstimateLineDescription({ quantity, unit: product.unit, name: product.name, sku: product.sku, packageLabel: product.packageLabel })
  const leading = /^(\d+)\s/.exec(line.description)
  const generated = leading ? wording(Number(leading[1])) === line.description.trim() : false
  return generated && Number.isInteger(line.quantity) && line.quantity > 0 ? wording(line.quantity) : line.description
}

export type SimpleInvoiceRecord = {
  readonly id: string
  readonly projectId: string
  readonly status: string
  readonly invoiceKind: SimpleInvoiceKind
  readonly invoiceNumber: string | null
  readonly sequenceNumber: number | null
  readonly customerId: string
  readonly customerName: string | null
  readonly estimateId: string | null
  readonly taxEntityId: string | null
  readonly title: string | null
  readonly memo: string | null
  readonly issueDate: string
  readonly dueDate: string | null
  readonly isDeposit: boolean
  readonly priceMode: InvoicePriceMode
  readonly priceCustomerType: InvoiceCustomerType
  readonly squareRequested: boolean
  readonly squareState: string
  readonly squareInvoiceId: string | null
  readonly squareOrderId: string | null
  readonly squareCustomerId: string | null
  readonly squarePublicUrl: string | null
  readonly squareError: string | null
  readonly subtotalCents: number
  readonly taxCents: number
  readonly totalCents: number
  readonly amountPaidCents: number
  readonly emailedAt: string | null
  /** A send in flight (lease) and a send whose outcome is unknown (migration 0322). */
  readonly emailClaimedAt: string | null
  readonly emailUnconfirmedAt: string | null
  readonly finalizedAt: string | null
  readonly voidedAt: string | null
  readonly voidReason: string | null
  readonly createdByUserId: string | null
  readonly updatedAt: string
  readonly lines: readonly (InvoiceLineInput & { readonly id: string; readonly amountCents: number })[]
}

const cents = (dollars: number): number => Math.round(dollars * 100)

/** A simple invoice with its lines, scoped to the project and company; null for legacy invoices. */
export async function loadSimpleInvoice(db: Db, organizationId: string, projectId: string, invoiceId: string): Promise<SimpleInvoiceRecord | null> {
  const row = await db
    .select({ invoice: invoices, customerName: customers.name })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId), eq(invoices.projectId, projectId), isNotNull(invoices.invoiceKind)))
    .get()
  const kind = row?.invoice.invoiceKind
  if (!row || !kind) return null
  const invoice = row.invoice
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)).orderBy(asc(invoiceLines.sortOrder))
  return {
    id: invoice.id,
    projectId,
    status: invoice.status,
    invoiceKind: kind,
    invoiceNumber: invoice.invoiceNumber,
    sequenceNumber: invoice.sequenceNumber,
    customerId: invoice.customerId,
    customerName: row.customerName,
    estimateId: invoice.estimateId,
    taxEntityId: invoice.taxEntityId,
    title: invoice.title,
    memo: invoice.memo,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    isDeposit: invoice.isDeposit,
    priceMode: invoice.priceMode,
    priceCustomerType: invoice.priceCustomerType,
    squareRequested: invoice.squareRequested,
    squareState: invoice.squareState,
    squareInvoiceId: invoice.squareInvoiceId,
    squareOrderId: invoice.squareOrderId,
    squareCustomerId: invoice.squareCustomerId,
    squarePublicUrl: invoice.squarePublicUrl,
    squareError: invoice.squareError,
    subtotalCents: cents(invoice.subtotal),
    taxCents: cents(invoice.tax),
    totalCents: cents(invoice.total),
    amountPaidCents: cents(invoice.amountPaid),
    emailedAt: invoice.emailedAt,
    emailClaimedAt: invoice.emailClaimedAt,
    emailUnconfirmedAt: invoice.emailUnconfirmedAt,
    finalizedAt: invoice.finalizedAt,
    voidedAt: invoice.voidedAt,
    voidReason: invoice.voidReason,
    createdByUserId: invoice.createdByUserId,
    updatedAt: invoice.updatedAt,
    lines: lines.map((line) => ({
      id: line.id,
      source: line.source,
      estimateLineId: line.estimateLineId,
      nutechProductId: line.nutechProductId,
      costCode: line.costCode,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      amountCents: line.amountCents,
      taxable: line.taxable,
    })),
  }
}

export type SimpleInvoiceListItem = {
  readonly id: string
  readonly invoiceKind: SimpleInvoiceKind | null
  readonly invoiceNumber: string | null
  readonly title: string | null
  readonly status: string
  readonly issueDate: string
  readonly totalCents: number
  readonly amountPaidCents: number
  readonly customerName: string | null
  readonly sageStatus: string | null
  readonly squareState: string
  readonly emailedAt: string | null
}

/** The project's simple invoices, newest first. */
export async function listSimpleInvoices(db: Db, organizationId: string, projectId: string): Promise<readonly SimpleInvoiceListItem[]> {
  const rows = await db
    .select({
      id: invoices.id,
      invoiceKind: invoices.invoiceKind,
      invoiceNumber: invoices.invoiceNumber,
      title: invoices.title,
      status: invoices.status,
      issueDate: invoices.issueDate,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      customerName: customers.name,
      sageStatus: sageInvoiceArExports.status,
      squareState: invoices.squareState,
      emailedAt: invoices.emailedAt,
    })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(sageInvoiceArExports, eq(sageInvoiceArExports.invoiceId, invoices.id))
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.projectId, projectId), isNotNull(invoices.invoiceKind)))
    .orderBy(desc(invoices.createdAt))
    .limit(500)
  return rows.map((row) => ({
    id: row.id,
    invoiceKind: row.invoiceKind,
    invoiceNumber: row.invoiceNumber,
    title: row.title,
    status: row.status,
    issueDate: row.issueDate,
    totalCents: cents(row.total),
    amountPaidCents: cents(row.amountPaid),
    customerName: row.customerName,
    sageStatus: row.sageStatus,
    squareState: row.squareState,
    emailedAt: row.emailedAt,
  }))
}

/** The next free sequence number for the project's invoices of a kind. */
export async function nextInvoiceSequence(db: Db, projectId: string, kind: SimpleInvoiceKind): Promise<number> {
  const row = await db
    .select({ max: sql<number | null>`max(${invoices.sequenceNumber})` })
    .from(invoices)
    .where(and(eq(invoices.projectId, projectId), eq(invoices.invoiceKind, kind)))
    .get()
  return (row?.max ?? 0) + 1
}

/** Invoice numbers already on the job (any source), so a new number never repeats one from Sage or earlier. */
export async function projectInvoiceNumbers(db: Db, organizationId: string, projectId: string): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ number: invoices.invoiceNumber })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.projectId, projectId), isNotNull(invoices.invoiceNumber)))
  return new Set(rows.flatMap((row) => (row.number ? [row.number.trim().toUpperCase()] : [])))
}
