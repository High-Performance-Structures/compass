import { and, eq, exists, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { projectOperations, projectProfileAuditEvents, projects } from "@/db/schema"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"

/*
 * recordProjectAudit writes the same SQL the callers wrote before the move:
 * each statement is compared with the drizzle chain it replaced. Building SQL
 * needs no database connection.
 */
// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

/** The SQL a built statement would run. */
function sqlOf(statement: object): unknown {
  return Reflect.apply(Reflect.get(statement, "getSQL"), statement, [])
}

/** The query text and bound parameters a built statement would run. */
function queryOf(statement: object): { readonly sql: string; readonly params: readonly unknown[] } {
  return Reflect.apply(Reflect.get(statement, "toSQL"), statement, [])
}

const now = "2026-10-30T12:00:00.000Z"

describe("project audit store", () => {
  it("inserts an event with the caller's serialized JSON", () => {
    const values = {
      id: "a1",
      organizationId: "o1",
      projectId: "p1",
      actorUserId: "u1",
      eventType: "job_email_sent",
      entityType: "project",
      entityId: "p1",
      beforeJson: null,
      afterJson: JSON.stringify({ subject: "Hi" }),
      createdAt: now,
    }
    expect(sqlOf(recordProjectAudit(db, values))).toEqual(
      db.insert(projectProfileAuditEvents).values(values).getSQL(),
    )
  })

  it("defaults the id to a new UUID", () => {
    const statement = recordProjectAudit(db, {
      organizationId: "o1",
      projectId: "p1",
      actorUserId: null,
      eventType: "workflow_carried_over",
      entityType: "project_workflow_check",
      entityId: null,
      beforeJson: JSON.stringify(null),
      afterJson: JSON.stringify({ items: [] }),
      createdAt: now,
    })
    const params = queryOf(statement).params
    expect(params[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(params).toContain("null")
  })

  it("guards an insert-select on the project row like the Sage handoff review", () => {
    const guard = db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(eq(projectOperations.id, "op1"))
    const event = {
      id: "a2",
      organizationId: "o1",
      projectId: "p1",
      actorUserId: "u1",
      eventType: "project.sage_handoff_client_reviewed",
      entityType: "project_operation",
      entityId: "op1",
      beforeJson: "{}",
      afterJson: "{}",
      createdAt: now,
    }
    const expected = db.insert(projectProfileAuditEvents).select(
      db
        .select({
          id: sql<string>`${"a2"}`.as("id"),
          organizationId: projects.organizationId,
          projectId: projects.id,
          actorUserId: sql<string>`${"u1"}`.as("actorUserId"),
          eventType: sql<string>`${"project.sage_handoff_client_reviewed"}`.as("eventType"),
          entityType: sql<string>`${"project_operation"}`.as("entityType"),
          entityId: sql<string>`${"op1"}`.as("entityId"),
          beforeJson: sql<string>`${"{}"}`.as("beforeJson"),
          afterJson: sql<string>`${"{}"}`.as("afterJson"),
          createdAt: sql<string>`${now}`.as("createdAt"),
        })
        .from(projects)
        .where(and(eq(projects.id, "p1"), eq(projects.organizationId, "o1"), exists(guard))),
    )
    const actual = recordProjectAudit(db, event, { onlyIf: exists(guard) })
    expect(queryOf(actual)).toEqual(expected.toSQL())
  })
})
