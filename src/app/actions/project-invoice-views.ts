"use server"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import { loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import { simpleInvoiceContext } from "@/lib/domain/financials/access"
import { simpleInvoiceActions, squareEligibility, type SimpleInvoiceActions, type SquareEligibility } from "@/lib/domain/financials/simple-invoice-rules"
import type { ArInvoicePlannedLine } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { projectEmailRecipientOptions } from "@/lib/email/project-recipient-options"
import type { EmailRecipientOption } from "@/lib/email/recipient-options"
import { loadSimpleInvoiceExport, loadSimpleInvoiceSageSource, type SimpleInvoiceExportView } from "@/lib/financials/simple-invoice-sage"
import {
  defaultBillToCustomerId,
  listSimpleInvoices,
  loadCatalogProducts,
  loadCustomerOptions,
  loadEstimateForInvoice,
  loadInvoiceableEstimates,
  loadSimpleInvoice,
  loadSimpleInvoiceProject,
  loadTaxDistrictOptions,
  readSimpleInvoiceSettings,
  type CatalogProductOption,
  type CustomerOption,
  type EstimateLineForInvoice,
  type InvoiceableEstimate,
  type SimpleInvoiceListItem,
  type SimpleInvoiceRecord,
  type TaxDistrictOption,
} from "@/lib/financials/simple-invoices-server"
import { sageArInvoiceWritesEnabled } from "@/lib/sage/ar-invoice-write"
import { canSendToSage } from "@/lib/sage/sage-send-access"
import { squareInvoiceAccessToken } from "@/lib/sage/square-invoice-create"

/*
 * Reads for the job's simple invoices: the Financials panel (list, New
 * invoice, Invoice from estimate) and the invoice page (line editor, Sage,
 * email and Square). Which actions staff may take come from the server.
 */

export type ProjectInvoicesPanel = {
  readonly invoices: readonly SimpleInvoiceListItem[]
  /** The job's department invoices from its estimate (no contract budget). */
  readonly invoicesFromEstimate: boolean
  readonly estimates: readonly InvoiceableEstimate[]
  readonly customers: readonly CustomerOption[]
  readonly defaultCustomerId: string | null
  readonly canCreate: boolean
}

export async function getProjectInvoicesPanel(projectId: string): Promise<ActionResult<ProjectInvoicesPanel>> {
  const context = await simpleInvoiceContext(projectId, "read")
  if (!context.success) return context
  const { db, organizationId } = context.data
  const [project, settings, list, estimates, customerOptions, defaultCustomerId] = await Promise.all([
    loadSimpleInvoiceProject(db, organizationId, projectId),
    readSimpleInvoiceSettings(db, organizationId),
    listSimpleInvoices(db, organizationId, projectId),
    loadInvoiceableEstimates(db, projectId),
    loadCustomerOptions(db, organizationId),
    defaultBillToCustomerId(db, organizationId, projectId),
  ])
  if (!project) return actionFailure("Project not found.")
  const fromEstimate = Boolean(project.department && settings.estimateInvoiceDepartments.some((department) => department === project.department))
  return {
    success: true,
    data: {
      invoices: list,
      invoicesFromEstimate: fromEstimate,
      estimates: fromEstimate ? estimates : [],
      customers: customerOptions,
      defaultCustomerId,
      canCreate: context.data.user.role !== "viewer",
    },
  }
}

type InvoiceSageState = {
  readonly writesEnabled: boolean
  readonly canSend: boolean
  readonly sageJobNumber: string | null
  readonly export: SimpleInvoiceExportView | null
  readonly lines: readonly ArInvoicePlannedLine[]
  readonly linesTotalCents: number
  readonly expectedSalesTaxCents: number
  readonly taxDistrictName: string | null
  readonly netDueCents: number
  readonly dueDate: string | null
  readonly description: string
  readonly blockers: readonly string[]
}

export type ProjectInvoiceEditor = {
  readonly project: { readonly id: string; readonly name: string; readonly projectNumber: string | null; readonly department: string | null }
  readonly invoice: SimpleInvoiceRecord
  readonly actions: SimpleInvoiceActions
  readonly estimate: { readonly id: string; readonly label: string; readonly lines: readonly EstimateLineForInvoice[] } | null
  readonly catalog: readonly CatalogProductOption[]
  /** `unlisted`: an old Sage name with a numbered twin, shown for saved lines but never offered. */
  readonly costCodes: readonly { readonly value: string; readonly label: string; readonly unlisted: boolean }[]
  readonly taxDistricts: readonly TaxDistrictOption[]
  readonly customers: readonly CustomerOption[]
  readonly square: SquareEligibility & { readonly connected: boolean }
  readonly sage: InvoiceSageState
  readonly email: {
    readonly senderAddress: string | null
    readonly recipients: readonly EmailRecipientOption[]
    readonly suggestedTo: readonly string[]
  }
}

export async function getProjectInvoiceEditor(projectId: string, invoiceId: string): Promise<ActionResult<ProjectInvoiceEditor>> {
  const context = await simpleInvoiceContext(projectId, "read")
  if (!context.success) return context
  const { db, env, user, organizationId } = context.data
  const [project, invoice, settings] = await Promise.all([
    loadSimpleInvoiceProject(db, organizationId, projectId),
    loadSimpleInvoice(db, organizationId, projectId, invoiceId),
    readSimpleInvoiceSettings(db, organizationId),
  ])
  if (!project || !invoice) return actionFailure("Invoice not found.")
  const [estimate, catalog, costCodes, taxDistricts, customerOptions, sageSource, exported] = await Promise.all([
    invoice.estimateId ? loadEstimateForInvoice(db, projectId, invoice.estimateId, invoice.id) : Promise.resolve(null),
    loadCatalogProducts(db, organizationId),
    loadProjectCostCodeChoices(db, projectId),
    loadTaxDistrictOptions(db),
    loadCustomerOptions(db, organizationId),
    loadSimpleInvoiceSageSource(db, { organizationId, projectId, invoiceId }),
    loadSimpleInvoiceExport(db, organizationId, invoiceId),
  ])
  const customer = customerOptions.find((option) => option.id === invoice.customerId)
  const recipients = await projectEmailRecipientOptions(db, projectId, [customer?.name, customer?.email])
  const sageLive = Boolean(exported && ["running", "succeeded"].includes(exported.status))
  const writesEnabled = sageArInvoiceWritesEnabled(env)
  const plan = sageSource?.plan
  return {
    success: true,
    data: {
      project: { id: project.id, name: project.name, projectNumber: project.projectNumber, department: project.department },
      invoice,
      actions: simpleInvoiceActions({
        status: invoice.status,
        emailed: Boolean(invoice.emailedAt),
        sageExportLive: sageLive,
        squarePublished: invoice.squareState === "published",
        hasPayments: invoice.amountPaidCents > 0,
      }),
      estimate: estimate
        ? { id: estimate.estimate.id, label: `${estimate.estimate.estimateNumber} v${estimate.estimate.versionNumber} · ${estimate.estimate.title}`, lines: estimate.lines }
        : null,
      catalog,
      costCodes: costCodes.map((choice) => ({ value: choice.code, label: choice.displayLabel, unlisted: !choice.listed })),
      taxDistricts,
      customers: customerOptions,
      square: {
        ...squareEligibility({ isDeposit: invoice.isDeposit, department: project.department, blockedDepositDepartments: settings.squareBlockedDepositDepartments }),
        connected: Boolean(squareInvoiceAccessToken(env)),
      },
      sage: {
        writesEnabled,
        canSend: writesEnabled && canSendToSage(user) && invoice.status !== "draft" && invoice.status !== "void" && !sageLive && exported?.status !== "queued",
        sageJobNumber: project.sageJobNumber,
        export: exported,
        lines: plan?.lines ?? [],
        linesTotalCents: plan?.linesTotalCents ?? 0,
        expectedSalesTaxCents: plan?.expectedSalesTaxCents ?? 0,
        taxDistrictName: plan?.taxDistrict?.name ?? null,
        netDueCents: plan?.netDueCents ?? 0,
        dueDate: plan?.dueDate ?? null,
        description: plan?.description ?? "",
        blockers: plan?.blockers ?? [],
      },
      email: {
        senderAddress: settings.senderAddress || null,
        recipients,
        suggestedTo: customer?.email ? [customer.email] : [],
      },
    },
  }
}
