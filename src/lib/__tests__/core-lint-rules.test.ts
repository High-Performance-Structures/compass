import { join } from "node:path"

import tsParser from "@typescript-eslint/parser"
import { ESLint, RuleTester } from "eslint"
import { describe, expect, it } from "vitest"

import { CORE_RULES } from "../../../eslint-rules/compass-core/index.mjs"

/*
 * Compass Core lint rules (issue #1329, architecture-standards.md section 1a).
 * The rule tests prove each rule fires on the loopholes it closes; the config
 * test lints known-bad code through the real eslint.config.mjs, so switching a
 * rule off, lowering it to a warning, or narrowing its files fails here.
 */

const ROOT = process.cwd()
const at = (path: string): string => join(ROOT, path)

const tester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module" },
})

const ACTION = at("src/app/actions/example.ts")
const COMPONENT = at("src/components/example.tsx")

describe("compass-core rules", () => {
  tester.run("owned-table-import", CORE_RULES["owned-table-import"], {
    valid: [
      { code: 'import { projectMembers } from "@/db/schema"', filename: at("src/lib/domain/project/queries.ts") },
      { code: 'import { users } from "@/db/schema-identity"', filename: at("src/lib/domain/identity/queries.ts") },
      { code: 'import { projects } from "@/db/schema"', filename: ACTION },
      { code: 'import type { users } from "@/db/schema"', filename: ACTION },
      { code: 'import { type users } from "@/db/schema"', filename: ACTION },
      { code: 'import { users } from "./schema-identity"', filename: at("src/db/index.ts") },
    ],
    invalid: [
      { code: 'import { projectMembers } from "@/db/schema"', filename: ACTION, errors: 1 },
      { code: 'import { users, projects } from "@/db/schema-identity"', filename: COMPONENT, errors: 1 },
      { code: 'import { vendors } from "../../db/schema-contacts"', filename: ACTION, errors: 1 },
      // Another domain module is not the owner either.
      { code: 'import { projectContacts } from "@/db/schema"', filename: at("src/lib/domain/project/store.ts"), errors: 1 },
      { code: 'export { users } from "@/db/schema"', filename: at("src/lib/people.ts"), errors: 1 },
      { code: 'export * from "@/db/schema"', filename: at("src/lib/people.ts"), errors: 1 },
    ],
  })

  tester.run("no-schema-namespace-import", CORE_RULES["no-schema-namespace-import"], {
    valid: [
      { code: 'import * as schema from "./schema"', filename: at("src/db/index.ts") },
      { code: 'import * as format from "@/lib/format"', filename: ACTION },
    ],
    invalid: [
      { code: 'import * as schema from "@/db/schema"', filename: ACTION, errors: 1 },
      { code: 'const schema = await import("@/db/schema-contacts")', filename: ACTION, errors: 1 },
    ],
  })

  tester.run("owned-table-relational-query", CORE_RULES["owned-table-relational-query"], {
    valid: [
      { code: "db.query.projects.findMany()", filename: ACTION },
      { code: "db.query.projectMembers.findMany()", filename: at("src/lib/domain/project/queries.ts") },
    ],
    invalid: [
      { code: "db.query.projectMembers.findMany()", filename: ACTION, errors: 1 },
      { code: "await ctx.db.query.users.findFirst({})", filename: COMPONENT, errors: 1 },
    ],
  })

  tester.run("owned-table-raw-sql", CORE_RULES["owned-table-raw-sql"], {
    valid: [
      { code: 'const label = "Remove from users list"', filename: COMPONENT },
      { code: 'const label = "Invite customers to the portal"', filename: COMPONENT },
      { code: "sql`select 1 from projects`", filename: ACTION },
      { code: 'db.prepare("SELECT * FROM project_members")', filename: at("src/lib/domain/project/queries.ts") },
    ],
    invalid: [
      { code: 'db.prepare("SELECT * FROM project_members WHERE user_id = ?")', filename: ACTION, errors: 1 },
      { code: "const q = `UPDATE users SET role = ?`", filename: ACTION, errors: 1 },
      { code: "sql`exists (select 1 from users u where u.id = ${id})`", filename: ACTION, errors: 1 },
      { code: 'sql`${a} in (select id from "vendors")`', filename: ACTION, errors: 1 },
      { code: "sql`project_contacts.display_name`", filename: ACTION, errors: 1 },
      { code: 'sql.raw("delete from organization_members")', filename: ACTION, errors: 1 },
    ],
  })

  tester.run("role-literal-compare", CORE_RULES["role-literal-compare"], {
    valid: [
      { code: 'if (user.role === "client") {}', filename: at("src/lib/user-roles.ts") },
      { code: 'if (role === "admin") {}', filename: at("src/lib/domain/identity/rules.ts") },
      { code: 'if (calendar.accessRole === "owner") {}', filename: COMPONENT },
      { code: 'if (status === "client") {}', filename: COMPONENT },
      { code: 'if (user.role === "not-a-role") {}', filename: COMPONENT },
    ],
    invalid: [
      { code: 'if (user.role === "client") {}', filename: COMPONENT, errors: 1 },
      { code: 'if ("admin" !== membership?.role) {}', filename: ACTION, errors: 1 },
      { code: 'const staff = ["admin", "office"].includes(user.role)', filename: ACTION, errors: 1 },
      { code: 'switch (projectRole) { case "subcontractor": break }', filename: ACTION, errors: 1 },
    ],
  })

  tester.run("no-disable-directive", CORE_RULES["no-disable-directive"], {
    // Directives naming compass-core rules are covered by the config test
    // below: RuleTester cannot resolve those rule names.
    valid: [{ code: "// eslint-disable-next-line no-console\nconsole.log(1)", filename: ACTION }],
    invalid: [],
  })
})

describe("compass-core is wired into eslint.config.mjs", () => {
  const BAD_CODE = [
    "// eslint-disable-next-line compass-core/owned-table-import",
    'import { users } from "@/db/schema"',
    'import { projectMembers } from "@/db/schema"',
    'import * as schema from "@/db/schema"',
    "export const rows = (db: any) => db.query.users.findMany()",
    'export const raw = (db: any) => db.prepare("SELECT * FROM project_contacts")',
    'export const isClient = (user: { role: string }) => user.role === "client"',
    "export const members = [projectMembers, schema, users]",
  ].join("\n")

  it("reports every rule as an error on non-test source files", { timeout: 120_000 }, async () => {
    const eslint = new ESLint({ cwd: ROOT })
    // A path with no suppressions entry, so the baseline cannot hide anything.
    const [result] = await eslint.lintText(BAD_CODE, { filePath: at("src/app/actions/__core-lint-probe__.ts") })
    const coreErrors = result.messages
      .filter((message) => message.ruleId?.startsWith("compass-core/") && message.severity === 2)
      .map((message) => message.ruleId)
    expect(new Set(coreErrors)).toEqual(
      new Set([
        "compass-core/owned-table-import",
        "compass-core/no-schema-namespace-import",
        "compass-core/owned-table-relational-query",
        "compass-core/owned-table-raw-sql",
        "compass-core/role-literal-compare",
        "compass-core/no-disable-directive",
      ]),
    )
  })
})
