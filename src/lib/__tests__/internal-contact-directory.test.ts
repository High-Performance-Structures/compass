import { describe, expect, it } from "vitest"

import { uniqueInternalStaffMembers } from "@/lib/internal-contact-directory"

describe("internal contact directory", () => {
  it("uses Settings team user IDs to remove repeated staff records", () => {
    const result = uniqueInternalStaffMembers([
      { id: "user-1", role: "office", name: "Alex Smith" },
      { id: "user-1", role: "office", name: "Alex Smith (project copy)" },
      { id: "user-2", role: "project_manager", name: "Sam Lee" },
    ])

    expect(result).toEqual([
      { id: "user-1", role: "office", name: "Alex Smith" },
      { id: "user-2", role: "project_manager", name: "Sam Lee" },
    ])
  })

  it("excludes external project contacts from the internal roster", () => {
    const result = uniqueInternalStaffMembers([
      { id: "staff", role: "admin" },
      { id: "owner", role: "client" },
      { id: "sub", role: "subcontractor" },
      { id: "supplier", role: "supplier" },
    ])

    expect(result.map((member) => member.id)).toEqual(["staff"])
  })
})
