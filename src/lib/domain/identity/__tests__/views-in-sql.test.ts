import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"

// Names callers give the identity/project views. In SQL text a view must be
// interpolated (`JOIN ${companies} o`); written bare (`JOIN companies o`) it
// names a table that doesn't exist and the statement fails at run time,
// which mocked tests never see.
const VIEW_NAMES = [
  "accounts", "people", "peopleRows", "companies", "companyRows", "memberships", "companyMemberships",
  "invitations", "accessInvitations", "projectMemberRows", "projectMemberships",
]
const BARE_VIEW_IN_SQL = new RegExp(`\\b(from|join)\\s+(${VIEW_NAMES.join("|")})\\b(\\s+[a-z_]+)?\\s+(on|where|as)\\b`, "i")

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "src/*.ts", "src/*.tsx"], { encoding: "utf8" })
    .split("\n")
    .filter((path) => path && !path.includes("__tests__"))
}

describe("identity views in SQL text", () => {
  it("are interpolated, never written as bare table names", () => {
    const offenders = sourceFiles().flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) => (BARE_VIEW_IN_SQL.test(line) ? [`${path}:${index + 1}`] : [])),
    )
    expect(offenders).toEqual([])
  })
})
