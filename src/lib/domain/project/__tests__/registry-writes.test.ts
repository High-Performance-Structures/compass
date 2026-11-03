import { and, eq, ne, or } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import {
  projectDuplicateDecisions,
  projectNumberRetirements,
  projectRouteAliases,
  projects,
} from "@/db/schema"
import { insertProjectNumberRetirementIfAbsentStatement, updateProjectRouteAliasesStatement } from "@/lib/domain/project/numbering-store"
import {
  deleteProjectDuplicateDecisionsStatement,
  upsertProjectDuplicateDecisionStatement,
} from "@/lib/domain/project/registry-store"
import {
  buildertrendCutoverNewProjectSql,
  buildertrendCutoverProjectReferenceGuardSql,
  sageJobResultStatement,
  updateProjectsStatement,
} from "@/lib/domain/project/store"

/*
 * Registry, duplicate-merge, Sage and cutover writes produce the same SQL the
 * callers wrote before they moved into the project stores. Building SQL needs
 * no database connection.
 */
// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

function toSqlOf(statement: object): unknown {
  return Reflect.apply(Reflect.get(statement, "toSQL"), statement, [])
}

const now = "2026-10-31T12:00:00.000Z"

describe("project registry writes", () => {
  it("archives a project with the same statement", () => {
    const patch = { projectNumber: null, status: "ARCHIVE", updatedAt: now }
    expect(toSqlOf(updateProjectsStatement(db, eq(projects.id, "p1"), patch))).toEqual(
      db.update(projects).set(patch).where(eq(projects.id, "p1")).toSQL(),
    )
  })

  it("retires a number only when it is not already retired", () => {
    const values = {
      id: "r1",
      organizationId: "o1",
      formerProjectId: "p1",
      projectNumber: "O-1",
      department: "O",
      sequence: 1,
      retiredByUserId: "u1",
      retiredAt: now,
    }
    expect(toSqlOf(insertProjectNumberRetirementIfAbsentStatement(db, values))).toEqual(
      db.insert(projectNumberRetirements).values(values).onConflictDoNothing().toSQL(),
    )
  })

  it("keeps the merged-pair guard on the duplicate decision upsert", () => {
    const values = {
      id: "d1",
      organizationId: "o1",
      projectAId: "a",
      projectBId: "b",
      status: "not_duplicate" as const,
      score: 0,
      reasonsJson: "[]",
      resolvedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    const conflict = {
      target: [
        projectDuplicateDecisions.organizationId,
        projectDuplicateDecisions.projectAId,
        projectDuplicateDecisions.projectBId,
      ],
      set: { status: "not_duplicate" as const, updatedAt: now },
      setWhere: ne(projectDuplicateDecisions.status, "merged"),
    }
    expect(toSqlOf(upsertProjectDuplicateDecisionStatement(db, values, conflict))).toEqual(
      db.insert(projectDuplicateDecisions).values(values).onConflictDoUpdate(conflict).toSQL(),
    )
  })

  it("keeps toSQL() on merge statements for the raw D1 batch", () => {
    expect(
      toSqlOf(updateProjectRouteAliasesStatement(db, eq(projectRouteAliases.sourceProjectId, "p1"), { reason: "x" })),
    ).toEqual(
      db.update(projectRouteAliases).set({ reason: "x" }).where(eq(projectRouteAliases.sourceProjectId, "p1")).toSQL(),
    )
    const pair = or(eq(projectDuplicateDecisions.projectAId, "p1"), eq(projectDuplicateDecisions.projectBId, "p1"))
    expect(toSqlOf(deleteProjectDuplicateDecisionsStatement(db, pair))).toEqual(
      db.delete(projectDuplicateDecisions).where(pair).toSQL(),
    )
    const scoped = and(eq(projects.id, "p1"), eq(projects.organizationId, "o1"))
    expect(toSqlOf(updateProjectsStatement(db, scoped, { updatedAt: now }))).toEqual(
      db.update(projects).set({ updatedAt: now }).where(scoped).toSQL(),
    )
  })
})

describe("raw project writes", () => {
  it("records a Sage job result with the same prepared statement", () => {
    const calls: unknown[] = []
    const prepared = {
      bind: (...values: unknown[]) => {
        calls.push(values)
        return prepared
      },
    }
    const d1 = {
      prepare: (query: string) => {
        calls.push(query)
        return prepared
      },
    }
    // @ts-expect-error A minimal D1 stand-in records the prepared statement.
    sageJobResultStatement(d1, {
      projectId: "p1",
      sageJobId: "j1",
      sageJobNumber: "100",
      sageJobStatusNumber: 2,
      sageJobTypeNumber: 3,
      now,
    })
    expect(calls).toEqual([
      `UPDATE projects
         SET sage_job_id = ?, sage_job_number = ?,
             sage_job_status_number = ?, sage_job_type_number = ?, updated_at = ?
         WHERE id = ?`,
      ["j1", "100", 2, 3, now, "p1"],
    ])
  })

  it("quotes cutover values and leaves missing ones NULL", () => {
    const project = {
      projectId: "bt:1",
      projectName: "O'Neil Residence",
      projectNumber: undefined,
      googleDriveProjectFolderId: "drive-1",
      clientName: "",
    }
    const sql = buildertrendCutoverNewProjectSql("org-1", project, now)
    expect(sql).toContain("'bt:1', NULL,\n  'O''Neil Residence', 'OPEN', 'lead', 'current',\n  NULL, 'org-1',")
    expect(buildertrendCutoverProjectReferenceGuardSql("org-1", project, now)).toContain(
      "WHERE id = 'bt:1'\n    AND organization_id = 'org-1'",
    )
  })
})
