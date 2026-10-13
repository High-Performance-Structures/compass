"use server"

import { and, asc, eq, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectContacts, projectJobStatuses, projects } from "@/db/schema"
import { projectLinks } from "@/db/schema-project-links"
import { createProjectIntake, type CreateProjectIntakeInput, type CreateProjectIntakeResult } from "@/app/actions/projects"
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

export type LinkedJob = {
  readonly linkId: string
  readonly projectId: string
  readonly projectNumber: string | null
  readonly name: string
  readonly statusLabel: string
  /** What the link is for, e.g. "Pour help or stacking". */
  readonly label: string | null
  /** "created": this job created the other one; "from": this job was created from it. */
  readonly direction: "created" | "from"
}

/** What the New Project form starts with for a linked job: this job's customer and site. */
export type LinkedJobPrefill = {
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
          direction: row.sourceId === projectId ? "created" : "from",
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
  revalidatePath(`/dashboard/projects/${sourceProjectId}`)
  return result
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
    revalidatePath(`/dashboard/projects/${link.projectId}`)
    revalidatePath(`/dashboard/projects/${link.linkedProjectId}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Couldn't remove the link." }
  }
}
