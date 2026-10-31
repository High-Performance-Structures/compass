"use server"

import { and, asc, eq, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectContacts, projectJobStatuses, projects } from "@/db/schema"
import { projectLinks } from "@/db/schema-project-links"
import { createProjectIntake, type CreateProjectIntakeInput, type CreateProjectIntakeResult } from "@/app/actions/projects"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { LinkedJobShortcut } from "@/lib/feature-settings/registry"
import { requireOrg } from "@/lib/org-scope"
import { can } from "@/lib/permissions"
import { assertProjectAccess, getProjectAccessRecord } from "@/lib/project-access"
import { splitAddress } from "@/lib/projects/address-parts"
import { projectDepartment } from "@/lib/project-branding"
import { projectJobStatusLabel } from "@/lib/project-profile"
import { carryOverBetweenLinkedJobs } from "@/lib/job-workflows/carryover"

type LinkedJob = {
  readonly linkId: string
  readonly projectId: string
  readonly projectNumber: string | null
  readonly name: string
  readonly statusLabel: string
  /** What the link is for, e.g. "Pour help or stacking". */
  readonly label: string | null
  /**
   * "created": this job created the other one; "from": this job was created
   * from it; "linked": two jobs that already existed were linked.
   */
  readonly direction: "created" | "from" | "linked"
}

/** What the New Project form starts with for a linked job: this job's customer and site. */
type LinkedJobPrefill = {
  readonly sourceProjectId: string
  readonly sourceProjectNumber: string | null
  readonly projectName: string
  readonly existingCustomerId: string | null
  readonly clientName: string | null
  readonly contactPhone: string | null
  readonly contactEmail: string | null
  readonly streetNumber: string | null
  readonly streetName: string | null
  readonly cityStateZip: string | null
  readonly billingAddress: string | null
}

export type ProjectLinksView = {
  readonly links: readonly LinkedJob[]
  /** Shortcuts offered on this job's department. */
  readonly shortcuts: readonly LinkedJobShortcut[]
  readonly prefill: LinkedJobPrefill
  readonly canCreate: boolean
  readonly canUnlink: boolean
}

type SimpleResult = { readonly success: true } | { readonly success: false; readonly error: string }

async function context() {
  const user = await requireAuth()
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return { user, organizationId, db: getDb(env.DB) }
}

// A job created as a linked job gets its link moments after it is created;
// a link made well after both jobs existed joined two existing jobs.
const CREATED_LINK_WINDOW_MS = 10 * 60 * 1000

function linkDirection(
  row: { readonly sourceId: string; readonly linkedId: string; readonly createdAt: string },
  projectId: string,
  jobs: readonly ({ readonly id: string; readonly createdAt: string } | undefined)[],
): LinkedJob["direction"] {
  const created = jobs.find((job) => job?.id === row.linkedId)
  const linkedAt = Date.parse(row.createdAt)
  const createdAt = created ? Date.parse(created.createdAt) : Number.NaN
  if (Number.isFinite(linkedAt) && Number.isFinite(createdAt) && linkedAt - createdAt > CREATED_LINK_WINDOW_MS) return "linked"
  return row.sourceId === projectId ? "created" : "from"
}

/** A job's linked jobs (both directions), its shortcuts, and the New Project prefill. */
export async function getProjectLinks(projectId: string): Promise<ProjectLinksView | null> {
  try {
    const { user, organizationId, db } = await context()
    await assertProjectAccess(db, user, projectId)
    const project = await db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        name: projects.name,
        clientName: projects.clientName,
        address: projects.address,
        mailingAddress: projects.mailingAddress,
      })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .get()
    if (!project) return null
    const [rows, owner, settings] = await Promise.all([
      db
        .select({
          linkId: projectLinks.id,
          sourceId: projectLinks.projectId,
          linkedId: projectLinks.linkedProjectId,
          label: projectLinks.label,
          createdAt: projectLinks.createdAt,
        })
        .from(projectLinks)
        .where(and(eq(projectLinks.organizationId, organizationId), or(eq(projectLinks.projectId, projectId), eq(projectLinks.linkedProjectId, projectId))))
        .orderBy(asc(projectLinks.createdAt)),
      db
        .select({
          customerId: projectContacts.sourceEntityId,
          entityType: projectContacts.sourceEntityType,
          name: projectContacts.displayName,
          phone: projectContacts.phone,
          email: projectContacts.email,
        })
        .from(projectContacts)
        .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
        .orderBy(asc(projectContacts.sortOrder))
        .limit(1)
        .get(),
      readFeatureSettings(db, organizationId, "linked-jobs"),
    ])
    const otherIds = rows.map((row) => (row.sourceId === projectId ? row.linkedId : row.sourceId))
    const others = await Promise.all(
      otherIds.map((id) =>
        db
          .select({
            id: projects.id,
            projectNumber: projects.projectNumber,
            name: projects.name,
            createdAt: projects.createdAt,
            jobStatusId: projects.jobStatusId,
            customLabel: projectJobStatuses.label,
          })
          .from(projects)
          .leftJoin(projectJobStatuses, eq(projectJobStatuses.id, projects.jobStatusId))
          .where(eq(projects.id, id))
          .get(),
      ),
    )
    // Only jobs this person can open are listed.
    const visible = await Promise.all(otherIds.map((id) => getProjectAccessRecord(db, user, id)))
    const links = rows.flatMap((row, index): LinkedJob[] => {
      const other = others[index]
      if (!other || !visible[index]) return []
      return [
        {
          linkId: row.linkId,
          projectId: other.id,
          projectNumber: other.projectNumber,
          name: other.name,
          statusLabel: projectJobStatusLabel({ jobStatusId: other.jobStatusId ?? "", customLabel: other.customLabel ?? null }),
          label: row.label,
          direction: linkDirection(row, projectId, others),
        },
      ]
    })
    const department = projectDepartment({ projectId: project.id, projectNumber: project.projectNumber })
    const site = splitAddress(project.address)
    return {
      links,
      shortcuts: settings.shortcuts.filter((shortcut) => shortcut.fromDepartment === "*" || shortcut.fromDepartment === department),
      prefill: {
        sourceProjectId: project.id,
        sourceProjectNumber: project.projectNumber,
        projectName: project.name,
        existingCustomerId: owner?.entityType === "customer" ? owner.customerId : null,
        clientName: owner?.name ?? project.clientName,
        contactPhone: owner?.phone ?? null,
        contactEmail: owner?.email ?? null,
        ...site,
        billingAddress: project.mailingAddress,
      },
      canCreate: can(user, "project", "create") && !isDemoUser(user.id),
      canUnlink: can(user, "project", "update") && !isDemoUser(user.id),
    }
  } catch {
    return null
  }
}

/**
 * Creates a job through the normal New Project intake (number, tracker, Drive
 * folder, Sage) and links it to the job it was created from.
 */
export async function createLinkedProject(
  sourceProjectId: string,
  label: string | null,
  input: CreateProjectIntakeInput,
): Promise<CreateProjectIntakeResult> {
  const { user, organizationId, db } = await context()
  const source = await getProjectAccessRecord(db, user, sourceProjectId)
  if (!source || source.organizationId !== organizationId) return { success: false, error: "The job to link from was not found." }
  const result = await createProjectIntake(input)
  if (!result.success) return result
  await db
    .insert(projectLinks)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      projectId: sourceProjectId,
      linkedProjectId: result.id,
      label: label?.trim().slice(0, 80) || null,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
  await carryOverAfterLink(db, { organizationId, projectId: sourceProjectId, otherProjectId: result.id, actorUserId: user.id })
  revalidatePath(`/dashboard/projects/${sourceProjectId}`)
  return result
}

/**
 * A Design job's completed steps tick its linked Construction job (and the
 * other way round where a carryover applies). The link stands even if this
 * fails; the job's workflow then offers to carry them over.
 */
async function carryOverAfterLink(
  db: Parameters<typeof carryOverBetweenLinkedJobs>[0],
  input: { readonly organizationId: string; readonly projectId: string; readonly otherProjectId: string; readonly actorUserId: string }
): Promise<void> {
  try {
    await carryOverBetweenLinkedJobs(db, input)
  } catch (error) {
    console.error("Linked-job workflow carryover failed", error)
  }
}

function jobLabel(job: { readonly projectNumber: string | null; readonly name: string }): string {
  return job.projectNumber ? `${job.projectNumber} — ${job.name}` : job.name
}

/**
 * Links this job to a job that already exists (for example a Design job and
 * the Construction job it led to). Neither job is renumbered or copied.
 */
export async function linkExistingProject(
  projectId: string,
  otherProjectId: string,
  label: string | null,
): Promise<SimpleResult> {
  try {
    const { user, organizationId, db } = await context()
    if (isDemoUser(user.id) || !can(user, "project", "update")) return { success: false, error: "You can't change linked jobs." }
    if (projectId === otherProjectId) return { success: false, error: "Choose a different job to link." }
    await assertProjectAccess(db, user, projectId)
    const access = await getProjectAccessRecord(db, user, otherProjectId)
    if (!access || access.organizationId !== organizationId) return { success: false, error: "The job to link was not found." }
    const jobs = await db
      .select({ id: projects.id, projectNumber: projects.projectNumber, name: projects.name })
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), or(eq(projects.id, projectId), eq(projects.id, otherProjectId))))
    const job = jobs.find((row) => row.id === projectId)
    const other = jobs.find((row) => row.id === otherProjectId)
    if (!job || !other) return { success: false, error: "The job to link was not found." }
    const existing = await db
      .select({ id: projectLinks.id })
      .from(projectLinks)
      .where(
        or(
          and(eq(projectLinks.projectId, projectId), eq(projectLinks.linkedProjectId, otherProjectId)),
          and(eq(projectLinks.projectId, otherProjectId), eq(projectLinks.linkedProjectId, projectId)),
        ),
      )
      .get()
    if (existing) return { success: false, error: `${jobLabel(other)} is already linked to this job.` }
    const linkId = crypto.randomUUID()
    await db.insert(projectLinks).values({
      id: linkId,
      organizationId,
      projectId,
      linkedProjectId: otherProjectId,
      label: label?.trim().slice(0, 80) || null,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    })
    for (const [here, there] of [[job, other], [other, job]] as const) {
      await recordActivityEvent({
        db,
        organizationId,
        projectId: here.id,
        actor: user,
        category: "account",
        action: "project.linked",
        entityType: "project_link",
        entityId: linkId,
        summary: `Linked ${jobLabel(there)}.`,
      })
    }
    await carryOverAfterLink(db, { organizationId, projectId, otherProjectId, actorUserId: user.id })
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${otherProjectId}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Couldn't link the job." }
  }
}

/** Removes a link between two jobs; both jobs stay as they are. */
export async function removeProjectLink(projectId: string, linkId: string): Promise<SimpleResult> {
  try {
    const { user, organizationId, db } = await context()
    if (isDemoUser(user.id) || !can(user, "project", "update")) return { success: false, error: "You can't change linked jobs." }
    await assertProjectAccess(db, user, projectId)
    const link = await db
      .select({ id: projectLinks.id, projectId: projectLinks.projectId, linkedProjectId: projectLinks.linkedProjectId })
      .from(projectLinks)
      .where(and(eq(projectLinks.id, linkId), eq(projectLinks.organizationId, organizationId)))
      .get()
    if (!link || (link.projectId !== projectId && link.linkedProjectId !== projectId)) {
      return { success: false, error: "That link is no longer on this job." }
    }
    await db.delete(projectLinks).where(eq(projectLinks.id, link.id))
    const jobs = await db
      .select({ id: projects.id, projectNumber: projects.projectNumber, name: projects.name })
      .from(projects)
      .where(or(eq(projects.id, link.projectId), eq(projects.id, link.linkedProjectId)))
    for (const here of jobs) {
      const there = jobs.find((row) => row.id !== here.id)
      await recordActivityEvent({
        db,
        organizationId,
        projectId: here.id,
        actor: user,
        category: "account",
        action: "project.unlinked",
        entityType: "project_link",
        entityId: link.id,
        summary: there ? `Removed the link to ${jobLabel(there)}.` : "Removed a linked job.",
      })
    }
    revalidatePath(`/dashboard/projects/${link.projectId}`)
    revalidatePath(`/dashboard/projects/${link.linkedProjectId}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Couldn't remove the link." }
  }
}
