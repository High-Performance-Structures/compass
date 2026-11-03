/**
 * Reads the family context for a project without widening project access.
 * Planned phases are visible only to users who can see the family internally;
 * external/project-scoped users see only sibling phases they can access.
 * The caller has already checked the user can reach `projectId`.
 */
import { and, asc, eq } from "drizzle-orm"

import { projectChangeOrders, projectJobStatuses, projects } from "@/db/schema"
import { projectFamilies, projectFamilyPhases } from "@/db/schema-project-families"
import type { AuthUser } from "@/lib/auth"
import {
  phaseSummary,
  type ProjectFamilyPhaseRow,
  type ProjectFamilySummary,
} from "@/lib/domain/families/rules"
import { getProjectAccessRecord, usesOrganizationProjectScope } from "@/lib/project-access"
import type { Db } from "@/lib/server/action-context"

export async function loadProjectFamilySummary(
  db: Db,
  user: AuthUser,
  projectId: string,
): Promise<ProjectFamilySummary | null> {
  const phase = await db
    .select({ familyId: projectFamilyPhases.familyId })
    .from(projectFamilyPhases)
    .where(eq(projectFamilyPhases.projectId, projectId))
    .limit(1)
    .get()
  if (!phase) return null

  const family = await db
    .select()
    .from(projectFamilies)
    .where(eq(projectFamilies.id, phase.familyId))
    .limit(1)
    .get()
  if (!family) return null

  const canSeeAllPhases =
    family.organizationId !== null &&
    usesOrganizationProjectScope(user, family.organizationId)

  const rows: readonly ProjectFamilyPhaseRow[] = await db
    .select({
      phase: projectFamilyPhases,
      customJobStatusLabel: projectJobStatuses.label,
      projectNumber: projects.projectNumber,
      phaseProjectNumber: projectFamilyPhases.projectNumber,
      projectName: projects.name,
      projectStatus: projects.status,
      googleDriveFolderId: projects.googleDriveFolderId,
      phaseGoogleDriveFolderId: projectFamilyPhases.googleDriveFolderId,
      changeOrderId: projectChangeOrders.id,
      changeOrderNumber: projectChangeOrders.changeOrderNumber,
      changeOrderTitle: projectChangeOrders.title,
      changeOrderStatus: projectChangeOrders.status,
      changeOrderAmountCents: projectChangeOrders.amountCents,
    })
    .from(projectFamilyPhases)
    .leftJoin(projects, eq(projects.id, projectFamilyPhases.projectId))
    .leftJoin(
      projectJobStatuses,
      and(
        eq(projectJobStatuses.id, projectFamilyPhases.jobStatusId),
        eq(projectJobStatuses.organizationId, family.organizationId),
      ),
    )
    .leftJoin(
      projectChangeOrders,
      eq(projectChangeOrders.id, projectFamilyPhases.originatingChangeOrderId),
    )
    .where(eq(projectFamilyPhases.familyId, family.id))
    .orderBy(asc(projectFamilyPhases.sequence))

  // Sibling access checks run together rather than one query per phase.
  const visible = await Promise.all(
    rows.map(async (row) => {
      if (canSeeAllPhases || row.phase.projectId === projectId) return true
      if (!row.phase.projectId) return false
      return (await getProjectAccessRecord(db, user, row.phase.projectId)) !== null
    }),
  )
  const visibleRows = rows.filter((_, index) => visible[index])

  return {
    family: {
      id: family.id,
      name: family.name,
      description: family.description,
      clientName: family.clientName,
      address: family.address,
      status: family.status,
      // Do not expose a shared Drive root to a user who cannot see every
      // phase; the root could reveal sibling folders outside Compass.
      googleDriveFolderId: canSeeAllPhases ? family.googleDriveFolderId : null,
    },
    currentPhaseId:
      rows.find((row) => row.phase.projectId === projectId)?.phase.id ?? "",
    phases: visibleRows.map((row) => phaseSummary(row, canSeeAllPhases)),
  }
}
