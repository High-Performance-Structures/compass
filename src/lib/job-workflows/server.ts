import { and, count, desc, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm"
import type { getDb } from "@/db"
import {
  dailyLogs,
  ownerProjectUpdates,
  projectChangeOrders,
  projectContacts,
  projectFinishSelections,
  projectOperations,
  projects,
  scheduleTasks,
  users,
} from "@/db/schema"
import { contractPackets } from "@/db/schema-contracts"
import { projectEstimates } from "@/db/schema-estimates"
import { projectWorkflowChecks } from "@/db/schema-job-workflows"
import { projectFamilyPhases } from "@/db/schema-project-families"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { WorkflowCheck, WorkflowFacts, WorkflowLayout, WorkflowOverrides } from "@/lib/job-workflows/engine"
import { resolvedProjectDepartment, type ProjectDepartment } from "@/lib/project-branding"

type Db = ReturnType<typeof getDb>

/** Ticked items on a job, keyed by `${stepId}.${itemId}`. */
export async function loadWorkflowChecks(db: Db, organizationId: string, projectId: string): Promise<ReadonlyMap<string, WorkflowCheck>> {
  const rows = await db
    .select({
      itemKey: projectWorkflowChecks.itemKey,
      checkedAt: projectWorkflowChecks.checkedAt,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(projectWorkflowChecks)
    .leftJoin(users, eq(users.id, projectWorkflowChecks.checkedBy))
    .where(and(eq(projectWorkflowChecks.projectId, projectId), eq(projectWorkflowChecks.organizationId, organizationId)))
  return new Map(
    rows.map((row) => {
      const name = row.displayName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || null
      return [row.itemKey, { checkedAt: row.checkedAt, checkedByName: name }]
    }),
  )
}

/** The company's changes to a department's workflow: step changes, order and added steps. */
export async function readWorkflowCustomization(
  db: Db,
  organizationId: string,
  department: ProjectDepartment,
): Promise<{ readonly overrides: WorkflowOverrides; readonly layout: WorkflowLayout }> {
  const settings = await readFeatureSettings(db, organizationId, "job-workflows")
  return {
    overrides: settings.departments[department] ?? {},
    layout: { order: settings.order[department] ?? [], customSteps: settings.customSteps[department] ?? [] },
  }
}

const ESTIMATE_SENT = new Set(["signature_pending", "accepted"])
const CLOSED_STATUSES = new Set(["complete", "closed"])

// Change orders still waiting on the company or the owner.
const OPEN_CHANGE_ORDER_STATUSES = [
  "submitted",
  "triage",
  "needs_information",
  "pricing",
  "internal_review",
  "approved_for_owner",
  "signature_pending",
]
const OWNER_UPDATE_WINDOW_DAYS = 7

/** What Compass records on a job, as workflow facts (all departments but Nu-Tech). */
export async function jobWorkflowFacts(
  db: Db,
  project: {
    readonly id: string
    readonly department: ProjectDepartment
    readonly address: string | null
    readonly jobStatusId: string
    readonly googleDriveFolderId: string | null
  },
  now: Date = new Date(),
): Promise<WorkflowFacts> {
  const projectId = project.id
  const updateSince = new Date(now.getTime() - OWNER_UPDATE_WINDOW_DAYS * 86_400_000).toISOString()
  const [contacts, estimate, signedPacket, schedule, purchaseOrders, logs, phase, selections, approvedSelections, recentUpdate, openChangeOrders] = await Promise.all([
    db
      .select({ total: count() })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
      .get(),
    db
      .select({ status: projectEstimates.status })
      .from(projectEstimates)
      .where(and(eq(projectEstimates.projectId, projectId), isNull(projectEstimates.changeOrderId), ne(projectEstimates.status, "void"), ne(projectEstimates.status, "superseded")))
      .orderBy(desc(projectEstimates.updatedAt))
      .limit(1)
      .get(),
    db
      .select({ id: contractPackets.id })
      .from(contractPackets)
      .where(and(eq(contractPackets.projectId, projectId), isNotNull(contractPackets.signedAt)))
      .limit(1)
      .get(),
    db.select({ total: count() }).from(scheduleTasks).where(eq(scheduleTasks.projectId, projectId)).get(),
    db
      .select({ total: count() })
      .from(projectOperations)
      .where(and(eq(projectOperations.projectId, projectId), eq(projectOperations.sourceRecordType, "purchase_order")))
      .get(),
    db.select({ total: count() }).from(dailyLogs).where(eq(dailyLogs.projectId, projectId)).get(),
    db
      .select({ familyId: projectFamilyPhases.familyId })
      .from(projectFamilyPhases)
      .where(eq(projectFamilyPhases.projectId, projectId))
      .limit(1)
      .get(),
    db.select({ total: count() }).from(projectFinishSelections).where(eq(projectFinishSelections.projectId, projectId)).get(),
    db
      .select({ total: count() })
      .from(projectFinishSelections)
      .where(and(eq(projectFinishSelections.projectId, projectId), eq(projectFinishSelections.status, "approved")))
      .get(),
    db
      .select({ id: ownerProjectUpdates.id })
      .from(ownerProjectUpdates)
      .where(and(eq(ownerProjectUpdates.projectId, projectId), gte(ownerProjectUpdates.publishedAt, updateSince)))
      .limit(1)
      .get(),
    db
      .select({ total: count() })
      .from(projectChangeOrders)
      .where(and(eq(projectChangeOrders.projectId, projectId), inArray(projectChangeOrders.status, OPEN_CHANGE_ORDER_STATUSES)))
      .get(),
  ])
  const selectionTotal = selections?.total ?? 0
  return {
    clientContact: (contacts?.total ?? 0) > 0,
    hasAddress: (project.address?.trim() ?? "") !== "",
    estimateBuilt: estimate !== undefined,
    estimateSent: estimate !== undefined && ESTIMATE_SENT.has(estimate.status),
    estimateAccepted: estimate?.status === "accepted",
    agreementSigned: signedPacket !== undefined,
    scheduled: (schedule?.total ?? 0) > 0,
    purchaseOrdered: (purchaseOrders?.total ?? 0) > 0,
    dailyLogged: (logs?.total ?? 0) > 0,
    linkedToOtherDepartment: phase ? await familyHasOtherDepartment(db, phase.familyId, projectId, project.department) : false,
    jobClosed: CLOSED_STATUSES.has(project.jobStatusId),
    driveFolder: (project.googleDriveFolderId ?? "") !== "",
    selectionsApproved: selectionTotal > 0 && (approvedSelections?.total ?? 0) === selectionTotal,
    ownerUpdateRecent: recentUpdate !== undefined,
    changeOrdersAnswered: (openChangeOrders?.total ?? 0) === 0,
  }
}

/** Whether the job's project family holds a job from another department (the Design or Nu-Tech job it came from). */
async function familyHasOtherDepartment(db: Db, familyId: string, projectId: string, ownDepartment: ProjectDepartment): Promise<boolean> {
  const siblings = await db
    .select({ projectId: projectFamilyPhases.projectId, projectNumber: projectFamilyPhases.projectNumber })
    .from(projectFamilyPhases)
    .where(and(eq(projectFamilyPhases.familyId, familyId), ne(projectFamilyPhases.projectId, projectId)))
  const linkedIds = siblings.flatMap((sibling) => (sibling.projectId ? [sibling.projectId] : []))
  const linkedNumbers =
    linkedIds.length > 0
      ? await db.select({ id: projects.id, projectNumber: projects.projectNumber }).from(projects).where(inArray(projects.id, linkedIds.slice(0, 90)))
      : []
  const numbers = [...siblings.map((sibling) => sibling.projectNumber), ...linkedNumbers.map((row) => row.projectNumber)]
  return numbers.some((projectNumber) => {
    const department = projectNumber ? resolvedProjectDepartment({ projectNumber }) : null
    return department !== null && department !== ownDepartment
  })
}
