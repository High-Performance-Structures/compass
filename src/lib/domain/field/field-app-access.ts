/**
 * Which jobs a person sees and may open in the field app (Field Mode).
 *
 * A job must first be in the field app (field-app-rules.ts: the job's own
 * choice, its phase and department, never when closed). Then the person
 * needs one of:
 * - an explicit project membership row (anyone, as before), or
 * - automatic employee access: an active internal staff member of the job's
 *   company, linked to an active internal contact with a Sage employee record,
 *   while the company's "Active Sage employees see every field app job"
 *   setting is on.
 * External roles (client, owner, subcontractor, supplier, guest) only ever
 * get their memberships. The list and every single-job check use the same
 * rules, so a job a person can open is always a job on their list.
 */
import { and, eq, isNull, ne, or, sql, type SQL } from "drizzle-orm"

import {
  internalContacts,
  organizationMembers,
  organizations,
  projectJobStatuses,
  projectMembers,
  projects,
} from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import type { FieldAppVisibility } from "@/lib/domain/project/statuses"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { FieldProject } from "@/lib/field/types"
import { readPortfolioMapRules } from "@/lib/portfolio-map/rules-server"
import { projectJobStatusLabel } from "@/lib/project-profile"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

import { fieldAppDecision, type FieldAppDecision, type FieldAppJob, type FieldAppRules } from "./field-app-rules"

export const FIELD_PROJECT_NOT_ASSIGNED = "This project is not assigned to your Field account."
export const FIELD_PROJECT_NOT_IN_APP = "This project is not in the field app."

/** Legacy project statuses that are always closed; also checked by the rules. */
const CLOSED_PROJECT_STATUSES = ["COMPLETE", "ARCHIVE", "INACTIVE"] as const

/** Columns every field app job read selects (the job status label joins the company's own statuses). */
const fieldAppJobColumns = {
  id: projects.id,
  name: projects.name,
  projectNumber: projects.projectNumber,
  address: projects.address,
  department: projects.department,
  status: projects.status,
  jobStatusId: projects.jobStatusId,
  customJobStatusLabel: projectJobStatuses.label,
  fieldAppVisibility: projects.fieldAppVisibility,
  organizationId: projects.organizationId,
}

type FieldAppJobRow = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly address: string | null
  readonly department: string | null
  readonly status: string
  readonly jobStatusId: string
  readonly customJobStatusLabel: string | null
  readonly fieldAppVisibility: FieldAppVisibility | null
  readonly organizationId: string | null
}

/** A job row ready for the rules. */
function fieldAppJob(row: FieldAppJobRow): FieldAppJob {
  return {
    id: row.id,
    projectNumber: row.projectNumber,
    department: row.department,
    status: row.status,
    jobStatusId: row.jobStatusId,
    jobStatusLabel: projectJobStatusLabel({ jobStatusId: row.jobStatusId, customLabel: row.customJobStatusLabel }),
    fieldAppVisibility: row.fieldAppVisibility,
  }
}

function notClosedByProjectStatus(): SQL {
  return sql`upper(${projects.status}) NOT IN (${sql.join(CLOSED_PROJECT_STATUSES.map((status) => sql`${status}`), sql`, `)})`
}

/** Jobs the field app could show: not hidden and not closed by project status (the rules decide the rest). */
function notHiddenOrClosed(): SQL | undefined {
  return and(
    or(isNull(projects.fieldAppVisibility), ne(projects.fieldAppVisibility, "hidden")),
    notClosedByProjectStatus(),
  )
}

function selectFieldAppJobs(db: Db, where: SQL | undefined) {
  return db
    .select(fieldAppJobColumns)
    .from(projects)
    .leftJoin(
      projectJobStatuses,
      and(eq(projectJobStatuses.id, projects.jobStatusId), eq(projectJobStatuses.organizationId, projects.organizationId)),
    )
    .where(where)
}

/** A company's field app rules: its Field app settings and its job status → phase mapping. */
async function readFieldAppRules(db: Db, organizationId: string): Promise<FieldAppRules> {
  const [settings, mapRules] = await Promise.all([
    readFeatureSettings(db, organizationId, "field-app"),
    readPortfolioMapRules(db, organizationId),
  ])
  return { settings, mapRules }
}

/** Whether the signed-in person could ever get automatic access: active internal staff in an internal company. */
function couldHaveEmployeeAccess(user: AuthUser): user is AuthUser & { readonly organizationId: string } {
  return (
    user.isActive &&
    user.organizationType === "internal" &&
    user.organizationId !== null &&
    isInternalStaffRole(user.role)
  )
}

/**
 * Automatic access: an active staff member of an active internal company
 * whose own internal contact is active and linked to a Sage employee, with
 * the company's setting on. Checked against the stored membership role too,
 * so a person whose session role differs never gains it.
 */
async function hasActiveEmployeeFieldAccess(db: Db, user: AuthUser, rules: FieldAppRules): Promise<boolean> {
  if (!couldHaveEmployeeAccess(user) || !rules.settings.autoAccessForSageEmployees) return false
  const rows = await db
    .select({ role: organizationMembers.role })
    .from(internalContacts)
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, internalContacts.organizationId),
        eq(organizationMembers.userId, user.id),
      ),
    )
    .innerJoin(organizations, eq(organizations.id, internalContacts.organizationId))
    .where(
      and(
        eq(internalContacts.organizationId, user.organizationId),
        eq(internalContacts.userId, user.id),
        eq(internalContacts.active, true),
        eq(organizations.type, "internal"),
        eq(organizations.isActive, true),
        or(
          sql`trim(coalesce(${internalContacts.sageEmployeeId}, '')) <> ''`,
          sql`trim(coalesce(${internalContacts.sageEmployeeNumber}, '')) <> ''`,
        ),
      ),
    )
    .limit(1)
  const row = rows[0]
  return row !== undefined && isInternalStaffRole(row.role)
}

/** Each company's rules once, for the jobs being checked. */
async function rulesByOrganization(db: Db, organizationIds: readonly string[]): Promise<ReadonlyMap<string, FieldAppRules>> {
  const unique = [...new Set(organizationIds)]
  const entries = await Promise.all(unique.map(async (id) => [id, await readFieldAppRules(db, id)] as const))
  return new Map(entries)
}

function compareFieldProjects(a: FieldProject, b: FieldProject): number {
  // Matches the old SQL order: jobs without a number first, then by number and name.
  if (a.projectNumber !== b.projectNumber) {
    if (a.projectNumber === null) return -1
    if (b.projectNumber === null) return 1
    return a.projectNumber.localeCompare(b.projectNumber)
  }
  return a.name.localeCompare(b.name)
}

/** The jobs on the person's field app list. */
export async function listFieldAppProjects(db: Db, user: AuthUser): Promise<readonly FieldProject[]> {
  const ownRulesPromise = couldHaveEmployeeAccess(user)
    ? readFieldAppRules(db, user.organizationId)
    : Promise.resolve(null)
  const [memberRows, ownRules] = await Promise.all([
    db
      .select(fieldAppJobColumns)
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .leftJoin(
        projectJobStatuses,
        and(eq(projectJobStatuses.id, projects.jobStatusId), eq(projectJobStatuses.organizationId, projects.organizationId)),
      )
      .where(and(eq(projectMembers.userId, user.id), notHiddenOrClosed())),
    ownRulesPromise,
  ])

  const automatic = ownRules !== null && couldHaveEmployeeAccess(user) && (await hasActiveEmployeeFieldAccess(db, user, ownRules))
  const companyRows = automatic && user.organizationId
    ? await selectFieldAppJobs(db, and(eq(projects.organizationId, user.organizationId), notHiddenOrClosed()))
    : []

  const candidates = new Map<string, FieldAppJobRow>()
  for (const row of [...memberRows, ...companyRows]) candidates.set(row.id, row)
  const otherOrganizationIds = [...candidates.values()].flatMap((row) =>
    row.organizationId && !(ownRules && row.organizationId === user.organizationId) ? [row.organizationId] : [],
  )
  const rules = new Map(await rulesByOrganization(db, otherOrganizationIds))
  if (ownRules && user.organizationId) rules.set(user.organizationId, ownRules)
  const rulesFor = (organizationId: string | null): FieldAppRules | null =>
    organizationId === null ? null : rules.get(organizationId) ?? null

  return [...candidates.values()]
    .filter((row) => {
      const jobRules = rulesFor(row.organizationId)
      return jobRules !== null && fieldAppDecision(fieldAppJob(row), jobRules).shown
    })
    .map((row) => ({ id: row.id, name: row.name, projectNumber: row.projectNumber, address: row.address }))
    .sort(compareFieldProjects)
}

export type FieldAppProjectAccess = {
  readonly project: FieldProject
  readonly decision: FieldAppDecision
  /** How the person reached it. */
  readonly via: "membership" | "employee"
}

/**
 * The single-job check for opening a job, its documents, and sending daily
 * logs and project messages from the field app. Throws the message the app
 * shows when the job isn't available to this person.
 */
export async function assertFieldAppProjectAccess(db: Db, user: AuthUser, projectId: string): Promise<FieldAppProjectAccess> {
  const [rows, membership] = await Promise.all([
    selectFieldAppJobs(db, eq(projects.id, projectId)).limit(1),
    db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, user.id), eq(projectMembers.projectId, projectId)))
      .limit(1),
  ])
  const row = rows[0]
  if (!row || row.organizationId === null) throw new Error(FIELD_PROJECT_NOT_ASSIGNED)

  const rules = await readFieldAppRules(db, row.organizationId)
  const isMember = membership.length > 0
  const viaEmployee =
    !isMember &&
    row.organizationId === user.organizationId &&
    (await hasActiveEmployeeFieldAccess(db, user, rules))
  if (!isMember && !viaEmployee) throw new Error(FIELD_PROJECT_NOT_ASSIGNED)

  const decision = fieldAppDecision(fieldAppJob(row), rules)
  if (!decision.shown) throw new Error(FIELD_PROJECT_NOT_IN_APP)
  return {
    project: { id: row.id, name: row.name, projectNumber: row.projectNumber, address: row.address },
    decision,
    via: isMember ? "membership" : "employee",
  }
}

export type FieldAppChecklistJob = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly department: string | null
  readonly jobStatusLabel: string
  readonly decision: FieldAppDecision
}

/**
 * Settings › Workflows › Field app: the company's jobs that aren't closed,
 * each with its choice and whether it is in the field app now.
 */
export async function loadCompanyFieldAppJobs(db: Db, organizationId: string): Promise<{
  readonly rules: FieldAppRules
  readonly jobs: readonly FieldAppChecklistJob[]
}> {
  const [rows, rules] = await Promise.all([
    selectFieldAppJobs(db, and(eq(projects.organizationId, organizationId), notClosedByProjectStatus())),
    readFieldAppRules(db, organizationId),
  ])
  const jobs = rows.flatMap((row) => {
    const job = fieldAppJob(row)
    const decision = fieldAppDecision(job, rules)
    if (decision.closed) return []
    return [{
      id: row.id,
      name: row.name,
      projectNumber: row.projectNumber,
      department: row.department,
      jobStatusLabel: job.jobStatusLabel,
      decision,
    }]
  })
  return { rules, jobs }
}

/** One job's choice and result, for its Information page. */
export async function loadProjectFieldAppDecision(db: Db, organizationId: string, projectId: string): Promise<FieldAppDecision | null> {
  const [rows, rules] = await Promise.all([
    selectFieldAppJobs(db, and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1),
    readFieldAppRules(db, organizationId),
  ])
  const row = rows[0]
  return row ? fieldAppDecision(fieldAppJob(row), rules) : null
}
