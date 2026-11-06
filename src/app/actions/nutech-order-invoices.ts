"use server"

import { and, asc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { vendors } from "@/db/schema"
import { nuTechOrderInvoices } from "@/db/schema-nutech"
import { isDemoUser } from "@/lib/demo"
import { isNuTechJob, nuTechOrgContext, readNuTechProject } from "@/lib/domain/nutech/access"
import { parseNuTechDate } from "@/lib/domain/nutech/rules"
import { NUTECH_ORDER_INVOICE_KINDS, type NuTechOrderInvoiceKind } from "@/lib/domain/nutech/statuses"
import { addNuTechOrderInvoice, deleteNuTechOrderInvoice } from "@/lib/domain/nutech/store"
import { findNuTechOrder } from "@/lib/nutech/order-select"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import type { Db } from "@/lib/server/action-context"

export type NuTechOrderInvoice = {
  readonly id: string
  /** Null: the manufacturer. */
  readonly vendorId: string | null
  readonly vendorName: string | null
  readonly kind: NuTechOrderInvoiceKind
  readonly invoiceNumber: string
  readonly amountCents: number | null
  readonly receivedOn: string | null
}

export type NuTechOrderInvoicesView = {
  readonly invoices: readonly NuTechOrderInvoice[]
  /** The company's vendors, for choosing who an invoice is from. */
  readonly vendors: readonly { readonly id: string; readonly name: string }[]
}

type ActionResult = { readonly success: true } | { readonly success: false; readonly error: string }

async function orderAccess(projectId: string, orderId: string, action: "read" | "update") {
  const { db, user, organizationId } = await nuTechOrgContext()
  if (action !== "read" && isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
  await requireFeaturePermission(user, "nutech-orders", action)
  const project = await readNuTechProject(db, organizationId, projectId)
  if (!project || !isNuTechJob(project)) throw new Error("Project not found.")
  const order = await findNuTechOrder(db, projectId, orderId)
  if (!order) throw new Error("That order is no longer on this job.")
  return { db, user, organizationId, order }
}

async function readInvoices(db: Db, organizationId: string, workflowId: string): Promise<NuTechOrderInvoicesView> {
  const [invoiceRows, vendorRows] = await Promise.all([
    db
      .select({
        id: nuTechOrderInvoices.id,
        vendorId: nuTechOrderInvoices.vendorId,
        vendorName: vendors.name,
        kind: nuTechOrderInvoices.kind,
        invoiceNumber: nuTechOrderInvoices.invoiceNumber,
        amountCents: nuTechOrderInvoices.amountCents,
        receivedOn: nuTechOrderInvoices.receivedOn,
      })
      .from(nuTechOrderInvoices)
      .leftJoin(vendors, eq(vendors.id, nuTechOrderInvoices.vendorId))
      .where(eq(nuTechOrderInvoices.workflowId, workflowId))
      .orderBy(asc(nuTechOrderInvoices.receivedOn), asc(nuTechOrderInvoices.createdAt)),
    db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(and(eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId)))
      .orderBy(asc(vendors.name)),
  ])
  return { invoices: invoiceRows, vendors: vendorRows }
}

/** An order's invoices and credit memos, with the vendors they can be from. */
export async function getNuTechOrderInvoices(projectId: string, orderId: string): Promise<NuTechOrderInvoicesView> {
  const { db, organizationId, order } = await orderAccess(projectId, orderId, "read")
  return readInvoices(db, organizationId, order.id)
}

function revalidateOrder(projectId: string): void {
  revalidatePath("/dashboard/nutech")
  revalidatePath(`/dashboard/projects/${projectId}/nutech`)
}

export async function addNuTechOrderInvoiceAction(
  projectId: string,
  orderId: string,
  input: {
    readonly vendorId: string | null
    readonly kind: string
    readonly invoiceNumber: string
    readonly amountCents: number | null
    readonly receivedOn: string | null
  },
): Promise<ActionResult> {
  try {
    const { db, user, organizationId, order } = await orderAccess(projectId, orderId, "update")
    const invoiceNumber = input.invoiceNumber.trim()
    if (!invoiceNumber) throw new Error("Enter the invoice or credit memo number.")
    const kind = NUTECH_ORDER_INVOICE_KINDS.find((value) => value === input.kind)
    if (!kind) throw new Error("Choose invoice, freight invoice, or credit memo.")
    if (input.amountCents !== null && (!Number.isInteger(input.amountCents) || input.amountCents < 0 || input.amountCents > 100_000_000)) {
      throw new Error("Enter the amount in dollars and cents.")
    }
    if (input.vendorId) {
      const vendor = await db
        .select({ id: vendors.id })
        .from(vendors)
        .where(and(eq(vendors.id, input.vendorId), eq(vendors.organizationId, organizationId)))
        .get()
      if (!vendor) throw new Error("Choose one of the company's vendors.")
    }
    const existing = await readInvoices(db, organizationId, order.id)
    if (existing.invoices.some((invoice) => invoice.invoiceNumber.toLowerCase() === invoiceNumber.toLowerCase())) {
      throw new Error(`${invoiceNumber} is already on this order.`)
    }
    const now = new Date().toISOString()
    await addNuTechOrderInvoice(db, {
      row: {
        id: crypto.randomUUID(),
        workflowId: order.id,
        vendorId: input.vendorId || null,
        kind,
        invoiceNumber,
        amountCents: input.amountCents,
        receivedOn: parseNuTechDate(input.receivedOn, "Received date") ?? now.slice(0, 10),
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      },
      userId: user.id,
      now,
    })
    revalidateOrder(projectId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to add the invoice." }
  }
}

export async function deleteNuTechOrderInvoiceAction(projectId: string, orderId: string, invoiceId: string): Promise<ActionResult> {
  try {
    const { db, user, order } = await orderAccess(projectId, orderId, "update")
    const deleted = await deleteNuTechOrderInvoice(db, { workflowId: order.id, invoiceId, userId: user.id, now: new Date().toISOString() })
    if (!deleted) throw new Error("That invoice is no longer on this order.")
    revalidateOrder(projectId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to remove the invoice." }
  }
}
