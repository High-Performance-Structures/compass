import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("internal directory data boundary", () => {
  it("reads canonical contact fields and excludes private employee addresses", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/actions/vendors.ts"),
      "utf8"
    )
    const action = source.split("export async function getInternalDirectoryContacts")[1]
      ?.split("export async function getVendor")[0]

    expect(action).toContain(".from(internalContacts)")
    expect(action).toContain("name: internalContacts.name")
    expect(action).toContain("email: internalContacts.email")
    expect(action).toContain("phone: internalContacts.phone")
    expect(action).not.toContain("internalContactPrivateAddresses")
    expect(action).not.toContain("users.displayName")
  })
})
