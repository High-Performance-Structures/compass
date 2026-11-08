import { and, asc, eq, isNotNull } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectContractDeposits, projects } from "@/db/schema"
import { DEFAULT_SAGE_EXPORT_SETTINGS } from "@/lib/feature-settings/contract-settings"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { formatSageInvoiceNumber } from "@/lib/financials/sage-invoice-number"

/*
 * Deposit requests as the client sees them: requested deposits made in
 * Compass, numbered 1 and up in the order requested, in the company's deposit
 * invoice number format (Settings > Workflows > Sage export, "{project}-DEP{n}"
 * by default) so the request and its Sage AR invoice carry the same number.
 * Callers check the viewer can read the project first.
 */

type Db = ReturnType<typeof getDb>

export type DepositRequestSummary = {
  readonly id: string
  readonly number: string
  readonly status: "requested" | "received"
  readonly amountCents: number
  readonly requestedAt: string | null
  readonly dueDate: string | null
  readonly receivedAt: string | null
}

export type DepositRequestDocumentData = DepositRequestSummary & {
  readonly message: string | null
  readonly project: {
    readonly name: string
    readonly projectNumber: string | null
    readonly address: string | null
    readonly clientName: string | null
    readonly mailingAddress: string | null
  }
}

async function requestRows(db: Db, projectId: string) {
  return db
    .select()
    .from(projectContractDeposits)
    .where(and(
      eq(projectContractDeposits.projectId, projectId),
      eq(projectContractDeposits.sourceSystem, "compass"),
      isNotNull(projectContractDeposits.requestedAmountCents),
      isNotNull(projectContractDeposits.requestedAt),
    ))
    .orderBy(asc(projectContractDeposits.createdAt))
}

/** A deposit request's number: the company's format, or <project>-DEP-<n> when the format can't be filled. */
export function depositRequestNumber(format: string, projectNumber: string | null, sequence: number): string {
  const formatted = formatSageInvoiceNumber(format, { projectNumber: projectNumber?.trim() || null, sageJobNumber: null, number: String(sequence) })
  return formatted.error ? `${projectNumber?.trim() || "DEPOSIT"}-DEP-${sequence}` : formatted.value
}

/** The company's deposit number format; the default when settings can't be read. */
export async function depositNumberFormat(db: Db, organizationId: string | null): Promise<string> {
  if (!organizationId) return DEFAULT_SAGE_EXPORT_SETTINGS.depositInvoiceFormat
  try {
    return (await readFeatureSettings(db, organizationId, "sage-export")).depositInvoiceFormat
  } catch {
    return DEFAULT_SAGE_EXPORT_SETTINGS.depositInvoiceFormat
  }
}

/** Every Compass deposit request on the project (voids too) with its sequence number, in request order. */
export async function depositRequestSequences(db: Db, projectId: string): Promise<ReadonlyMap<string, number>> {
  return new Map((await requestRows(db, projectId)).map((row, index) => [row.id, index + 1]))
}

function summaries(rows: Awaited<ReturnType<typeof requestRows>>, projectNumber: string | null, format: string): readonly (DepositRequestSummary & { readonly message: string | null })[] {
  // Voided requests keep their number so later ones don't renumber.
  return rows.flatMap((row, index) => {
    if (row.status === "void" || row.requestedAmountCents === null) return []
    return [{
      id: row.id,
      number: depositRequestNumber(format, projectNumber, index + 1),
      status: row.status === "requested" ? "requested" : "received",
      amountCents: row.requestedAmountCents,
      requestedAt: row.requestedAt,
      dueDate: row.dueDate,
      receivedAt: row.receivedAt,
      message: row.requestMessage,
    }]
  })
}

export async function projectDepositRequests(db: Db, projectId: string): Promise<readonly DepositRequestSummary[]> {
  const project = await db.select({ projectNumber: projects.projectNumber, organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId)).get()
  if (!project) return []
  return summaries(await requestRows(db, projectId), project.projectNumber, await depositNumberFormat(db, project.organizationId)).map((request) => ({
    id: request.id,
    number: request.number,
    status: request.status,
    amountCents: request.amountCents,
    requestedAt: request.requestedAt,
    dueDate: request.dueDate,
    receivedAt: request.receivedAt,
  }))
}

export async function depositRequestDocument(db: Db, projectId: string, depositId: string): Promise<DepositRequestDocumentData | null> {
  const project = await db
    .select({
      name: projects.name,
      projectNumber: projects.projectNumber,
      address: projects.address,
      clientName: projects.clientName,
      mailingAddress: projects.mailingAddress,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project) return null
  const { organizationId, ...shown } = project
  const request = summaries(await requestRows(db, projectId), project.projectNumber, await depositNumberFormat(db, organizationId)).find((item) => item.id === depositId)
  return request ? { ...request, project: shown } : null
}
