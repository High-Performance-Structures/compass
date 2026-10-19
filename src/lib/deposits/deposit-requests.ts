import { and, asc, eq, isNotNull } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectContractDeposits, projects } from "@/db/schema"

/*
 * Deposit requests as the client sees them: requested deposits made in
 * Compass, numbered <project number>-DEP-1 and up in the order requested.
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

function summaries(rows: Awaited<ReturnType<typeof requestRows>>, projectNumber: string | null): readonly (DepositRequestSummary & { readonly message: string | null })[] {
  const prefix = projectNumber?.trim() || "DEPOSIT"
  // Voided requests keep their number so later ones don't renumber.
  return rows.flatMap((row, index) => {
    if (row.status === "void" || row.requestedAmountCents === null) return []
    return [{
      id: row.id,
      number: `${prefix}-DEP-${index + 1}`,
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
  const project = await db.select({ projectNumber: projects.projectNumber }).from(projects).where(eq(projects.id, projectId)).get()
  if (!project) return []
  return summaries(await requestRows(db, projectId), project.projectNumber).map((request) => ({
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
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project) return null
  const request = summaries(await requestRows(db, projectId), project.projectNumber).find((item) => item.id === depositId)
  return request ? { ...request, project } : null
}
