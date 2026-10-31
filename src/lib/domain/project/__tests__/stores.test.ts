import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import {
  projectExternalLinks,
  projectFinishSelections,
  projectInteractions,
  projectNumberReservations,
  projectRegistryRemovals,
  projects,
} from "@/db/schema"
import { projectFamilyPhases } from "@/db/schema-project-families"
import { insertProjectInteractionIfAbsentStatement } from "@/lib/domain/crm/store"
import { updateProjectFamilyPhasesStatement } from "@/lib/domain/families/store"
import { deleteProjectNumberReservationsStatement } from "@/lib/domain/project/numbering-store"
import { deleteProjectRegistryRemovalsStatement } from "@/lib/domain/project/registry-store"
import {
  insertProjectStatement,
  updateProjectsStatement,
  upsertProjectExternalLinkStatement,
} from "@/lib/domain/project/store"
import { updateFinishSelectionsStatement } from "@/lib/domain/selections/store"

/*
 * The generic store writers build the same SQL as the drizzle chains they
 * replaced. Building SQL needs no database connection.
 */
// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

function sqlOf(statement: object): unknown {
  return Reflect.apply(Reflect.get(statement, "getSQL"), statement, [])
}

const now = "2026-10-31T12:00:00.000Z"

describe("project core stores", () => {
  it("inserts and updates projects with the same statements", () => {
    const row = { id: "p1", name: "Job", organizationId: "o1", createdAt: now, updatedAt: now }
    expect(sqlOf(insertProjectStatement(db, row))).toEqual(db.insert(projects).values(row).getSQL())
    expect(sqlOf(insertProjectStatement(db, [row, { ...row, id: "p2" }]))).toEqual(
      db.insert(projects).values([row, { ...row, id: "p2" }]).getSQL(),
    )
    const patch = { status: "ARCHIVE", updatedAt: now }
    expect(sqlOf(updateProjectsStatement(db, eq(projects.id, "p1"), patch))).toEqual(
      db.update(projects).set(patch).where(eq(projects.id, "p1")).getSQL(),
    )
  })

  it("keeps upsert and do-nothing conflict handling", () => {
    const link = {
      id: "l1",
      projectId: "p1",
      label: "Drive folder",
      system: "google_drive",
      createdAt: now,
      updatedAt: now,
    }
    const conflict = { target: projectExternalLinks.id, set: { label: "Drive", updatedAt: now } }
    expect(sqlOf(upsertProjectExternalLinkStatement(db, link, conflict))).toEqual(
      db.insert(projectExternalLinks).values(link).onConflictDoUpdate(conflict).getSQL(),
    )
    const interaction = {
      id: "i1",
      organizationId: "o1",
      projectId: "p1",
      interactionType: "email",
      direction: "outbound",
      summary: "Sent",
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
    }
    expect(sqlOf(insertProjectInteractionIfAbsentStatement(db, interaction))).toEqual(
      db.insert(projectInteractions).values(interaction).onConflictDoNothing().getSQL(),
    )
    expect(sqlOf(insertProjectInteractionIfAbsentStatement(db, interaction, projectInteractions.id))).toEqual(
      db.insert(projectInteractions).values(interaction).onConflictDoNothing({ target: projectInteractions.id }).getSQL(),
    )
  })

  it("deletes and updates the other project core tables with the same statements", () => {
    expect(sqlOf(deleteProjectNumberReservationsStatement(db, eq(projectNumberReservations.projectId, "p1")))).toEqual(
      db.delete(projectNumberReservations).where(eq(projectNumberReservations.projectId, "p1")).getSQL(),
    )
    expect(sqlOf(deleteProjectRegistryRemovalsStatement(db, eq(projectRegistryRemovals.projectId, "p1")))).toEqual(
      db.delete(projectRegistryRemovals).where(eq(projectRegistryRemovals.projectId, "p1")).getSQL(),
    )
    expect(sqlOf(updateProjectFamilyPhasesStatement(db, eq(projectFamilyPhases.id, "ph1"), { updatedAt: now }))).toEqual(
      db.update(projectFamilyPhases).set({ updatedAt: now }).where(eq(projectFamilyPhases.id, "ph1")).getSQL(),
    )
    expect(sqlOf(updateFinishSelectionsStatement(db, eq(projectFinishSelections.id, "s1"), { updatedAt: now }))).toEqual(
      db.update(projectFinishSelections).set({ updatedAt: now }).where(eq(projectFinishSelections.id, "s1")).getSQL(),
    )
  })
})
