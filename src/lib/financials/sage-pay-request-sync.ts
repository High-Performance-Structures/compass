import { and, desc, eq, notInArray } from "drizzle-orm"

import { projectBudgetApplications, projectBudgetLines, projectOperations, projects, users } from "@/db/schema"
import { projectContractBudgetLines, projectContractBudgetRevisions } from "@/db/schema-estimates"
import { payApplicationSageSyncs, sagePayApplicationSnapshots } from "@/db/schema-sage"
import { payApplicationShopTicketImports } from "@/db/schema-shop-tickets"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import { chunkD1InsertRows } from "@/lib/d1-query"
import {
  mapSageLinesToCompass,
  sameApplicationNumber,
  type CompassCostCode,
  type SyncedPayRequestLine,
} from "@/lib/domain/budget/sage-pay-request-rules"
import {
  deleteBudgetLinesStatement,
  deleteShopTicketImportsStatement,
  insertBudgetApplicationStatement,
  insertBudgetLinesStatement,
  insertPayApplicationSageSyncStatement,
  updateBudgetApplicationsStatement,
  type Statement,
} from "@/lib/domain/budget/store"
import type { PayApplicationSageSyncEvent } from "@/lib/domain/budget/statuses"
import { COMPASS_DRAW_SOURCE, IMPORTED_DRAW_UNBILLED_STATUSES, NON_IMPORTED_BILL_SOURCES } from "@/lib/domain/financials/rules"
import { operationInsertQuery, operationUpdateQuery } from "@/lib/domain/operations/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { PayRequestOrigin } from "@/lib/feature-settings/contract-settings"
import { indexSageCatalog } from "@/lib/financials/sage-export-codes"
import { markShopTicketsCoveredBySage } from "@/lib/financials/sage-pay-request-tickets"
import type { Db } from "@/lib/server/action-context"
import { sagePayApplicationHeaderSchema, sagePayApplicationLineSchema } from "@/lib/sage/pay-application-snapshot"
import { z } from "zod/v4"

/*
 * Pay requests built in Sage 100 Contractor, synced into Compass from the
 * read-only snapshots the Sage bridge stores. For a company whose pay
 * requests are created in Sage, each synced progress billing becomes (or
 * refreshes) the Compass owner pay application with the same number; its
 * billed amounts stay as Sage has them. A pay application staff built in
 * Compass with the same number is never overwritten: it is linked, and staff
 * compare and choose "Use Sage amounts". Nothing here writes to Sage.
 */

/** Pay application statuses whose amounts may still follow Sage. */
export const SAGE_REFRESHABLE_STATUSES = ["draft", "internal_review"] as const

const UNUSABLE_STATUSES = ["building", "void", "superseded"] as const

/** Where the company builds pay requests (Settings › Workflows › Sage export). */
export async function payRequestOrigin(db: Db, organizationId: string): Promise<PayRequestOrigin> {
  return (await readFeatureSettings(db, organizationId, "sage-export")).payRequestsCreatedIn
}

export type SageSnapshotRecord = {
  readonly id: string
  readonly sourceApplicationId: string
  readonly capturedAt: string
  readonly header: z.infer<typeof sagePayApplicationHeaderSchema>
  readonly lines: readonly z.infer<typeof sagePayApplicationLineSchema>[]
}

const storedLinesSchema = z.array(sagePayApplicationLineSchema)

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function reconciliationPassed(text: string): boolean {
  const parsed = parseJson(text)
  return typeof parsed === "object" && parsed !== null && Reflect.get(parsed, "passed") === true && Reflect.get(parsed, "revisionConflict") === null
}

function snapshotRecord(row: typeof sagePayApplicationSnapshots.$inferSelect): SageSnapshotRecord | null {
  const header = sagePayApplicationHeaderSchema.safeParse(parseJson(row.headerJson))
  const lines = storedLinesSchema.safeParse(parseJson(row.linesJson))
  if (!header.success || !lines.success || !reconciliationPassed(row.reconciliationJson)) return null
  return { id: row.id, sourceApplicationId: row.sourceApplicationId, capturedAt: row.capturedAt, header: header.data, lines: lines.data }
}

/** One stored snapshot of the project, when its totals reconciled. */
export async function loadSageSnapshot(db: Db, projectId: string, snapshotId: string): Promise<SageSnapshotRecord | null> {
  const row = await db
    .select()
    .from(sagePayApplicationSnapshots)
    .where(and(eq(sagePayApplicationSnapshots.id, snapshotId), eq(sagePayApplicationSnapshots.projectId, projectId)))
    .get()
  return row ? snapshotRecord(row) : null
}

/** The project's most recent snapshot whose totals reconciled, if any. */
export async function latestSageSnapshot(db: Db, projectId: string): Promise<SageSnapshotRecord | null> {
  const rows = await db
    .select()
    .from(sagePayApplicationSnapshots)
    .where(eq(sagePayApplicationSnapshots.projectId, projectId))
    .orderBy(desc(sagePayApplicationSnapshots.capturedAt))
    .limit(5)
  for (const row of rows) {
    const record = snapshotRecord(row)
    if (record) return record
  }
  return null
}

/**
 * The newest reconciled snapshot of the Sage application a pay application
 * follows. A billed pay application keeps its amounts, so later snapshots
 * (posting, the AR invoice) aren't recorded as syncs; this finds them.
 */
export async function latestSnapshotForPayApplication(db: Db, projectId: string, applicationId: string): Promise<SageSnapshotRecord | null> {
  const latest = await latestSageSync(db, applicationId)
  if (!latest) return null
  const rows = await db
    .select()
    .from(sagePayApplicationSnapshots)
    .where(and(eq(sagePayApplicationSnapshots.projectId, projectId), eq(sagePayApplicationSnapshots.sourceApplicationId, latest.sourceApplicationId)))
    .orderBy(desc(sagePayApplicationSnapshots.capturedAt))
    .limit(5)
  for (const row of rows) {
    const record = snapshotRecord(row)
    if (record) return record
  }
  return null
}

/** The current contract budget revision and its cost codes, which synced lines map onto. */
async function currentRevision(db: Db, projectId: string): Promise<{ readonly id: string | null; readonly codes: readonly CompassCostCode[] }> {
  const revision = await db
    .select({ id: projectContractBudgetRevisions.id })
    .from(projectContractBudgetRevisions)
    .where(and(eq(projectContractBudgetRevisions.projectId, projectId), eq(projectContractBudgetRevisions.status, "current")))
    .orderBy(desc(projectContractBudgetRevisions.revisionNumber))
    .get()
  if (!revision) return { id: null, codes: [] }
  const codes = await db
    .select({
      costCode: projectContractBudgetLines.costCode,
      divisionCode: projectContractBudgetLines.divisionCode,
      divisionName: projectContractBudgetLines.divisionName,
      description: projectContractBudgetLines.description,
    })
    .from(projectContractBudgetLines)
    .where(eq(projectContractBudgetLines.revisionId, revision.id))
  return { id: revision.id, codes }
}

/** Sage's lines on the project's Compass cost codes, plus the revision they were mapped against. */
export async function mappedSnapshotLines(
  db: Db,
  projectId: string,
  snapshot: SageSnapshotRecord
): Promise<{ readonly revisionId: string | null; readonly lines: readonly SyncedPayRequestLine[] }> {
  const [catalog, revision] = await Promise.all([loadProjectCostCodeCatalog(db), currentRevision(db, projectId)])
  const lines = mapSageLinesToCompass(snapshot.lines, { index: indexSageCatalog(catalog), compassCodes: revision.codes })
  return { revisionId: revision.id, lines }
}

/** The latest Sage sync recorded on a pay application: its event and snapshot. */
export async function latestSageSync(db: Db, applicationId: string) {
  return db
    .select({
      eventKind: payApplicationSageSyncs.eventKind,
      snapshotId: payApplicationSageSyncs.snapshotId,
      createdAt: payApplicationSageSyncs.createdAt,
      sourceApplicationId: sagePayApplicationSnapshots.sourceApplicationId,
    })
    .from(payApplicationSageSyncs)
    .innerJoin(sagePayApplicationSnapshots, eq(sagePayApplicationSnapshots.id, payApplicationSageSyncs.snapshotId))
    .where(eq(payApplicationSageSyncs.applicationId, applicationId))
    .orderBy(desc(payApplicationSageSyncs.createdAt))
    .get()
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

function lineRows(
  lines: readonly SyncedPayRequestLine[],
  context: { readonly projectId: string; readonly applicationId: string; readonly now: string }
): (typeof projectBudgetLines.$inferInsert)[] {
  return lines.map((line, index) => {
    const total = line.totalCompletedStoredToDate
    return {
      id: crypto.randomUUID(),
      projectId: context.projectId,
      applicationId: context.applicationId,
      budgetRevisionLineId: null,
      sourceSystem: "sage_pay_request",
      sourceRecordId: line.sourceLineId,
      // Sage's own cost code record, kept so the line can be traced back.
      sourceRecordNumber: line.costCode,
      costCode: line.compassCostCode,
      csiDivision: line.divisionCode,
      csiDivisionName: line.divisionName,
      description: line.compassDescription,
      notes: null,
      originalEstimate: line.originalEstimate,
      priorChanges: line.totalChanges,
      currentChanges: 0,
      totalChanges: line.totalChanges,
      adjustedEstimate: line.adjustedEstimate,
      previousWorkCompleted: line.previousWorkCompleted,
      currentWorkCompleted: line.currentWorkCompleted,
      storedMaterials: line.storedMaterials,
      priorCosts: line.previousWorkCompleted,
      currentCosts: roundCents(line.currentWorkCompleted + line.storedMaterials),
      totalCosts: total,
      percentComplete: line.adjustedEstimate > 0 ? Math.round((total / line.adjustedEstimate) * 1_000) / 10 : 0,
      balanceToFinish: line.balanceToFinish,
      retainageHeld: line.retainageHeld,
      vendorName: null,
      ownerLabel: line.compassDescription,
      ownerVisible: true,
      internalNotes: line.mapped ? null : "No Compass cost code matched this Sage line.",
      sortOrder: index,
      assemblyKey: null,
      assemblyName: null,
      assemblySort: 0,
      syncStatus: "synced",
      lastSyncedAt: context.now,
      createdAt: context.now,
      updatedAt: context.now,
    }
  })
}

/** The G702 amounts of a synced pay application, exactly as Sage has them. */
function headerValues(snapshot: SageSnapshotRecord) {
  const header = snapshot.header
  return {
    periodTo: header.periodTo,
    originalContractSum: header.originalContractSum,
    netChanges: header.netChanges,
    contractSumToDate: header.contractSumToDate,
    totalCompletedStoredToDate: header.totalCompletedStoredToDate,
    retainageHeld: header.retainageHeld,
    totalEarnedLessRetainage: header.totalEarnedLessRetainage,
    previousCertificates: header.previousCertificates,
    currentPaymentDue: header.currentPaymentDue,
    balanceToFinish: header.balanceToFinish,
    // Sage's billing already reflects any deposit, so Compass applies none on top.
    depositApplied: 0,
    depositAppliedMode: "manual",
  } as const
}

type ExistingApplication = {
  readonly id: string
  readonly applicationNumber: string
  readonly status: string
  readonly billingSource: string
  readonly sageInvoiceNumber: string | null
}

/** The statements that replace a pay application's lines and G702 amounts with Sage's. */
async function replaceWithSageStatements(
  db: Db,
  input: {
    readonly projectId: string
    readonly application: ExistingApplication
    readonly snapshot: SageSnapshotRecord
    readonly lines: readonly SyncedPayRequestLine[]
    readonly event: PayApplicationSageSyncEvent
    readonly userId: string | null
    readonly now: string
  }
): Promise<Statement[]> {
  const { projectId, application, snapshot, now } = input
  const before = await db
    .select({
      costCode: projectBudgetLines.costCode,
      description: projectBudgetLines.description,
      previousWorkCompleted: projectBudgetLines.previousWorkCompleted,
      currentWorkCompleted: projectBudgetLines.currentWorkCompleted,
      storedMaterials: projectBudgetLines.storedMaterials,
      retainageHeld: projectBudgetLines.retainageHeld,
    })
    .from(projectBudgetLines)
    .where(and(eq(projectBudgetLines.projectId, projectId), eq(projectBudgetLines.applicationId, application.id)))
  const header = headerValues(snapshot)
  return [
    // Amounts shop tickets added in Compass go with the lines; Sage's billing replaces them.
    deleteShopTicketImportsStatement(
      db,
      and(eq(payApplicationShopTicketImports.applicationId, application.id), eq(payApplicationShopTicketImports.mode, "imported"))
    ),
    deleteBudgetLinesStatement(db, and(eq(projectBudgetLines.projectId, projectId), eq(projectBudgetLines.applicationId, application.id))),
    ...chunkD1InsertRows(projectBudgetLines, lineRows(input.lines, { projectId, applicationId: application.id, now })).map((rows) =>
      insertBudgetLinesStatement(db, rows)
    ),
    updateBudgetApplicationsStatement(db, eq(projectBudgetApplications.id, application.id), {
      ...header,
      billingSource: "sage",
      sageInvoiceNumber: application.sageInvoiceNumber ?? snapshot.header.invoiceNumber ?? null,
      lastSyncedAt: now,
      updatedAt: now,
    }),
    operationUpdateQuery(db, operationFor(projectId, application.id), { amount: header.currentPaymentDue, dueDate: header.periodTo, updatedAt: now }),
    insertPayApplicationSageSyncStatement(db, {
      id: crypto.randomUUID(),
      projectId,
      applicationId: application.id,
      snapshotId: snapshot.id,
      eventKind: input.event,
      linesBeforeSnapshot: JSON.stringify(before),
      createdBy: input.userId,
      createdAt: now,
    }),
  ]
}

function operationFor(projectId: string, applicationId: string) {
  return and(
    eq(projectOperations.projectId, projectId),
    eq(projectOperations.sourceRecordType, "owner_pay_application"),
    eq(projectOperations.sourceRecordId, applicationId)
  )
}

async function runBatch(db: Db, statements: readonly Statement[]): Promise<void> {
  const [first, ...rest] = statements
  if (first) await db.batch([first, ...rest])
}

export type SageSyncOutcome =
  | { readonly kind: "created" | "refreshed" | "linked" | "unchanged" | "locked"; readonly applicationId: string; readonly applicationNumber: string; readonly ticketsMarked: readonly string[] }
  | { readonly kind: "skipped"; readonly reason: string }

/** The pay application already following this Sage application, else the Compass one with the same number. */
async function findApplication(db: Db, projectId: string, snapshot: SageSnapshotRecord): Promise<ExistingApplication | null> {
  const candidates = await db
    .select({
      id: projectBudgetApplications.id,
      applicationNumber: projectBudgetApplications.applicationNumber,
      status: projectBudgetApplications.status,
      billingSource: projectBudgetApplications.billingSource,
      sageInvoiceNumber: projectBudgetApplications.sageInvoiceNumber,
      linkedTo: sagePayApplicationSnapshots.sourceApplicationId,
      linkedAt: payApplicationSageSyncs.createdAt,
    })
    .from(projectBudgetApplications)
    .leftJoin(payApplicationSageSyncs, eq(payApplicationSageSyncs.applicationId, projectBudgetApplications.id))
    .leftJoin(sagePayApplicationSnapshots, eq(sagePayApplicationSnapshots.id, payApplicationSageSyncs.snapshotId))
    .where(
      and(
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.sourceSystem, COMPASS_DRAW_SOURCE),
        notInArray(projectBudgetApplications.status, [...UNUSABLE_STATUSES])
      )
    )
    .orderBy(desc(payApplicationSageSyncs.createdAt))
  const linked = candidates.find((row) => row.linkedTo === snapshot.sourceApplicationId)
  const byNumber = candidates.find((row) => row.linkedTo === null && sameApplicationNumber(row.applicationNumber, snapshot.header.applicationNumber))
  const match = linked ?? byNumber
  return match
    ? { id: match.id, applicationNumber: match.applicationNumber, status: match.status, billingSource: match.billingSource, sageInvoiceNumber: match.sageInvoiceNumber }
    : null
}

/** Whether a draw imported from Sage or Drive history already records this application number. */
async function importedDrawWithNumber(db: Db, projectId: string, applicationNumber: string): Promise<boolean> {
  const rows = await db
    .select({ applicationNumber: projectBudgetApplications.applicationNumber })
    .from(projectBudgetApplications)
    .where(
      and(
        eq(projectBudgetApplications.projectId, projectId),
        notInArray(projectBudgetApplications.sourceSystem, [...NON_IMPORTED_BILL_SOURCES]),
        notInArray(projectBudgetApplications.status, [...IMPORTED_DRAW_UNBILLED_STATUSES])
      )
    )
  return rows.some((row) => sameApplicationNumber(row.applicationNumber, applicationNumber))
}

async function createFromSage(
  db: Db,
  input: {
    readonly projectId: string
    readonly snapshot: SageSnapshotRecord
    readonly lines: readonly SyncedPayRequestLine[]
    readonly revisionId: string | null
    readonly userId: string | null
    readonly now: string
  }
): Promise<ExistingApplication> {
  const { projectId, snapshot, now } = input
  const project = await db
    .select({ name: projects.name, sageJobId: projects.sageJobId, sageJobNumber: projects.sageJobNumber })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  const applicationId = crypto.randomUUID()
  const number = snapshot.header.applicationNumber
  const header = headerValues(snapshot)
  const invoiceNumber = snapshot.header.invoiceNumber ?? null
  await runBatch(db, [
    insertBudgetApplicationStatement(db, {
      id: applicationId,
      projectId,
      sourceSystem: COMPASS_DRAW_SOURCE,
      sourceRecordId: snapshot.sourceApplicationId,
      applicationNumber: number,
      status: "draft",
      ...header,
      ownerVisible: false,
      budgetRevisionId: input.revisionId,
      billingSource: "sage",
      sageInvoiceNumber: invoiceNumber,
      syncStatus: "synced",
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
    ...chunkD1InsertRows(projectBudgetLines, lineRows(input.lines, { projectId, applicationId, now })).map((rows) => insertBudgetLinesStatement(db, rows)),
    operationInsertQuery(db, {
      id: crypto.randomUUID(),
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "owner_pay_application",
      sourceRecordId: applicationId,
      sourceRecordNumber: number,
      title: `Owner pay application ${number}`,
      description: "Synced from Sage.",
      status: "draft",
      priority: "normal",
      assigneeType: "owner",
      dueDate: header.periodTo,
      amount: header.currentPaymentDue,
      sageJobId: project?.sageJobId ?? null,
      sageJobNumber: project?.sageJobNumber ?? null,
      sageWriteStatus: "not_required",
      syncDirection: "read",
      syncStatus: "synced",
      createdAt: now,
      updatedAt: now,
    }),
    insertPayApplicationSageSyncStatement(db, {
      id: crypto.randomUUID(),
      projectId,
      applicationId,
      snapshotId: snapshot.id,
      eventKind: "created",
      linesBeforeSnapshot: null,
      createdBy: input.userId,
      createdAt: now,
    }),
  ])
  return { id: applicationId, applicationNumber: number, status: "draft", billingSource: "sage", sageInvoiceNumber: invoiceNumber }
}

/**
 * Brings one Sage snapshot into the project's pay requests, for a company
 * whose pay requests are created in Sage: creates the pay application,
 * refreshes a synced draft or review, or links a Compass-built one with the
 * same number (amounts untouched). Records what it did in Activity.
 */
export async function syncPayRequestFromSageSnapshot(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly snapshotId: string
    readonly actor: ActivityActor | null
    readonly now: string
  }
): Promise<SageSyncOutcome> {
  const { organizationId, projectId, now } = input
  if ((await payRequestOrigin(db, organizationId)) !== "sage") return { kind: "skipped", reason: "Pay requests are created in Compass." }
  const snapshot = await loadSageSnapshot(db, projectId, input.snapshotId)
  if (!snapshot) return { kind: "skipped", reason: "Sage's pay application totals need review before it can be synced." }
  const userId = input.actor?.id ?? null
  const [{ revisionId, lines }, existing] = await Promise.all([mappedSnapshotLines(db, projectId, snapshot), findApplication(db, projectId, snapshot)])
  if (!existing && (await importedDrawWithNumber(db, projectId, snapshot.header.applicationNumber))) {
    return { kind: "skipped", reason: `Pay application ${snapshot.header.applicationNumber} is already recorded from an earlier import, so it wasn't created again.` }
  }
  let kind: Exclude<SageSyncOutcome["kind"], "skipped">
  let application: ExistingApplication
  if (!existing) {
    application = await createFromSage(db, { projectId, snapshot, lines, revisionId, userId, now })
    kind = "created"
  } else {
    application = existing
    const latest = await latestSageSync(db, existing.id)
    const sameSnapshot = latest?.snapshotId === snapshot.id
    const refreshable = SAGE_REFRESHABLE_STATUSES.some((status) => status === existing.status)
    if (existing.billingSource === "sage" && refreshable && !sameSnapshot) {
      await runBatch(db, await replaceWithSageStatements(db, { projectId, application: existing, snapshot, lines, event: "refreshed", userId, now }))
      kind = "refreshed"
    } else if (existing.billingSource !== "sage" && !sameSnapshot) {
      // A pay application built in Compass: link it and leave its amounts alone.
      await runBatch(db, [
        insertPayApplicationSageSyncStatement(db, {
          id: crypto.randomUUID(),
          projectId,
          applicationId: existing.id,
          snapshotId: snapshot.id,
          eventKind: "linked",
          linesBeforeSnapshot: null,
          createdBy: userId,
          createdAt: now,
        }),
      ])
      kind = "linked"
    } else {
      kind = existing.billingSource === "sage" && !refreshable ? "locked" : "unchanged"
    }
    // A synced pay application carries Sage's invoice number once Sage has one.
    if (existing.billingSource === "sage" && !existing.sageInvoiceNumber && snapshot.header.invoiceNumber) {
      await runBatch(db, [
        updateBudgetApplicationsStatement(db, eq(projectBudgetApplications.id, existing.id), {
          sageInvoiceNumber: snapshot.header.invoiceNumber,
          ...(existing.status === "billed" ? { syncStatus: "synced" } : {}),
          updatedAt: now,
        }),
      ])
    }
  }
  const followsSage = application.billingSource === "sage" && SAGE_REFRESHABLE_STATUSES.some((status) => status === application.status)
  const ticketsMarked = followsSage
    ? await markShopTicketsCoveredBySage(db, { projectId, applicationId: application.id, periodTo: snapshot.header.periodTo, lines, userId, now })
    : []
  await recordSyncActivity(db, { organizationId, projectId, actor: input.actor, kind, application, snapshot, ticketsMarked })
  return { kind, applicationId: application.id, applicationNumber: application.applicationNumber, ticketsMarked }
}

const SYNC_SUMMARIES: Readonly<Record<Exclude<SageSyncOutcome["kind"], "skipped">, (number: string, sageNumber: string) => string>> = {
  created: (number) => `Synced pay application ${number} from Sage.`,
  refreshed: (number) => `Synced pay application ${number} from Sage with Sage's latest amounts.`,
  linked: (number, sageNumber) => `Linked pay application ${number} to Sage's application ${sageNumber}; review the differences before billing.`,
  unchanged: (number) => `Synced pay application ${number} from Sage; nothing had changed.`,
  locked: (number) => `Synced pay application ${number} from Sage; it is already billed, so its amounts were kept.`,
}

async function recordSyncActivity(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly actor: ActivityActor | null
    readonly kind: Exclude<SageSyncOutcome["kind"], "skipped">
    readonly application: ExistingApplication
    readonly snapshot: SageSnapshotRecord
    readonly ticketsMarked: readonly string[]
  }
): Promise<void> {
  const tickets = input.ticketsMarked.length > 0 ? ` Shop tickets ${input.ticketsMarked.join(", ")} counted as already included.` : ""
  await recordActivityEvent({
    db,
    organizationId: input.organizationId,
    projectId: input.projectId,
    actor: input.actor ?? SAGE_SYNC_ACTOR,
    category: "financial",
    action: `pay_application_sage_${input.kind}`,
    entityType: "project_budget_application",
    entityId: input.application.id,
    summary: SYNC_SUMMARIES[input.kind](input.application.applicationNumber, input.snapshot.header.applicationNumber) + tickets,
    metadata: {
      sageApplication: input.snapshot.header.applicationNumber,
      currentPaymentDue: input.snapshot.header.currentPaymentDue,
      ticketsMarked: [...input.ticketsMarked],
    },
  })
}

/** Activity's actor when a sync has no requesting person (a bridge replay). */
const SAGE_SYNC_ACTOR: ActivityActor = { id: null, email: "sage-sync", displayName: "Sage sync", firstName: null, lastName: null, role: "system" }

/** The person who asked for a Sage read, as Activity names them. */
export async function sageSyncActor(db: Db, userId: string | null): Promise<ActivityActor | null> {
  if (!userId) return null
  const user = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName, firstName: users.firstName, lastName: users.lastName, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  return user ?? null
}

/**
 * "Use Sage amounts" on a Compass-built pay application linked to Sage: its
 * lines and G702 amounts become Sage's (recorded with the amounts it had
 * before), and from then on it follows Sage. Only while draft or in review.
 */
export async function applySageAmounts(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly applicationId: string; readonly actor: ActivityActor & { readonly id: string }; readonly now: string }
): Promise<{ readonly applicationNumber: string; readonly ticketsMarked: readonly string[] }> {
  const { projectId, applicationId, now } = input
  const application = await db
    .select({
      id: projectBudgetApplications.id,
      applicationNumber: projectBudgetApplications.applicationNumber,
      status: projectBudgetApplications.status,
      billingSource: projectBudgetApplications.billingSource,
      sageInvoiceNumber: projectBudgetApplications.sageInvoiceNumber,
    })
    .from(projectBudgetApplications)
    .where(and(eq(projectBudgetApplications.id, applicationId), eq(projectBudgetApplications.projectId, projectId), eq(projectBudgetApplications.sourceSystem, COMPASS_DRAW_SOURCE)))
    .get()
  if (!application) throw new Error("Pay application not found.")
  if (!SAGE_REFRESHABLE_STATUSES.some((status) => status === application.status)) {
    throw new Error("Only a draft or a pay application in review can take Sage's amounts.")
  }
  const latest = await latestSageSync(db, applicationId)
  if (!latest) throw new Error("This pay application isn't linked to a Sage pay application yet. Sync with Sage first.")
  const snapshot = await loadSageSnapshot(db, projectId, latest.snapshotId)
  if (!snapshot) throw new Error("Sage's pay application totals need review before its amounts can be used.")
  const { lines } = await mappedSnapshotLines(db, projectId, snapshot)
  await runBatch(
    db,
    await replaceWithSageStatements(db, { projectId, application, snapshot, lines, event: "sage_amounts_applied", userId: input.actor.id, now })
  )
  const ticketsMarked = await markShopTicketsCoveredBySage(db, { projectId, applicationId, periodTo: snapshot.header.periodTo, lines, userId: input.actor.id, now })
  await recordActivityEvent({
    db,
    organizationId: input.organizationId,
    projectId,
    actor: input.actor,
    category: "financial",
    action: "pay_application_sage_amounts_applied",
    entityType: "project_budget_application",
    entityId: applicationId,
    summary: `Replaced pay application ${application.applicationNumber}'s amounts with Sage's application ${snapshot.header.applicationNumber}; the earlier amounts are kept in its history.`,
    metadata: { sageApplication: snapshot.header.applicationNumber, currentPaymentDue: snapshot.header.currentPaymentDue, ticketsMarked: [...ticketsMarked] },
  })
  return { applicationNumber: application.applicationNumber, ticketsMarked }
}
