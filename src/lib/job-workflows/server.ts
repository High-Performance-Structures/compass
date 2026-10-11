import { and, count, desc, eq, inArray, isNotNull, ne } from "drizzle-orm"
import type { getDb } from "@/db"
import { dailyLogs, projectContacts, projectOperations, projects, scheduleTasks, users } from "@/db/schema"
import { contractPackets } from "@/db/schema-contracts"
import { projectEstimates } from "@/db/schema-estimates"
import { projectWorkflowChecks } from "@/db/schema-job-workflows"
import { projectFamilyPhases } from "@/db/schema-project-families"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { WorkflowCheck, WorkflowFacts, WorkflowOverrides } from "@/lib/job-workflows/engine"
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

/** The company's changes to a department's workflow. */
export async function readWorkflowOverrides(db: Db, organizationId: string, department: ProjectDepartment): Promise<WorkflowOverrides> {
  const settings = await readFeatureSettings(db, organizationId, "job-workflows")
  return settings.departments[department] ?? {}
}

const ESTIMATE_SENT = new Set(["signature_pending", "accepted"])
const CLOSED_STATUSES = new Set(["complete", "closed"])

/** What Compass records on a scope-of-work job, as workflow facts. */
export async function scopeOfWorkFacts(
  db: Db,
  project: {
    readonly id: string
    readonly department: ProjectDepartment
    readonly address: string | null
    readonly jobStatusId: string
  },
): Promise<WorkflowFacts> {
  const projectId = project.id
  const [contacts, estimate, signedPacket, schedule, purchaseOrders, logs, phase] = await Promise.all([
    db
      .select({ total: count() })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
      .get(),
    db
      .select({ status: projectEstimates.status })
      .from(projectEstimates)
      .where(and(eq(projectEstimates.projectId, projectId), ne(projectEstimates.status, "void"), ne(projectEstimates.status, "superseded")))
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
  ])
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
