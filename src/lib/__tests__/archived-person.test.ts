import { describe, expect, it } from "vitest"

import { archivedPersonJobsNotice, archivedUserLabel } from "@/lib/archived-person"
import { personDisplayName } from "@/lib/domain/field/rules"

describe("archivedUserLabel", () => {
  it("prefixes an archived person's name", () => {
    expect(archivedUserLabel("Jordan Example")).toBe("Archived user – Jordan Example")
    expect(archivedUserLabel("  Jordan Example ")).toBe("Archived user – Jordan Example")
  })

  it("falls back when there is no name", () => {
    expect(archivedUserLabel(null)).toBe("Archived user")
    expect(archivedUserLabel(" ")).toBe("Archived user")
  })

  it("names an inactive daily-log author the same way", () => {
    const author = { displayName: null, firstName: "Jordan", lastName: "Example", email: null }
    expect(personDisplayName({ ...author, isActive: false })).toBe("Archived user – Jordan Example")
    expect(personDisplayName({ ...author, isActive: true })).toBe("Jordan Example")
    expect(personDisplayName(author)).toBe("Jordan Example")
  })
})

describe("archivedPersonJobsNotice", () => {
  it("says how many jobs the person comes off", () => {
    expect(archivedPersonJobsNotice(110)).toBe("Removes them from 110 jobs (kept in history).")
    expect(archivedPersonJobsNotice(1)).toBe("Removes them from 1 job (kept in history).")
    expect(archivedPersonJobsNotice(0)).toBe("They are not on any jobs.")
    expect(archivedPersonJobsNotice(null)).toBe("Removes them from every job they are on (kept in history).")
  })
})
