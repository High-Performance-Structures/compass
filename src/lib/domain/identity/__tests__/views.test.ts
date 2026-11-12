import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import { describe, expect, it } from "vitest"

import { projects } from "@/db/schema"
import { membershipsView, peopleView } from "@/lib/domain/identity/views"
import { projectMembersView } from "@/lib/domain/project/views"

function isD1Database(value: object): value is D1Database {
  return "prepare" in value
}

// Only builds SQL; nothing runs against the database.
const fakeD1 = { prepare: () => ({}) }
if (!isD1Database(fakeD1)) throw new Error("fake D1 is incomplete")
const db = drizzle(fakeD1)

describe("identity and project read views", () => {
  it("join like the table itself when unnamed", () => {
    const people = peopleView()
    const memberships = membershipsView()
    const query = db
      .select({ name: people.displayName, role: memberships.role })
      .from(memberships)
      .innerJoin(people, eq(people.id, memberships.userId))
      .toSQL()
    expect(query.sql).toContain('from "organization_members" inner join "users" on "users"."id" = "organization_members"."user_id"')
  })

  it("can be joined twice under different names", () => {
    const author = peopleView("author")
    const member = peopleView("member")
    const members = projectMembersView()
    const query = db
      .select({ project: projects.id, author: author.email, member: member.email })
      .from(projects)
      .innerJoin(members, eq(members.projectId, projects.id))
      .innerJoin(member, eq(member.id, members.userId))
      .leftJoin(author, eq(author.id, members.userId))
      .toSQL()
    expect(query.sql).toContain('inner join "users" "member" on "member"."id" = "project_members"."user_id"')
    expect(query.sql).toContain('left join "users" "author" on "author"."id" = "project_members"."user_id"')
  })
})
