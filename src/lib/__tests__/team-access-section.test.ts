import { describe, expect, it } from "vitest"
import { parseTeamAccessSection, teamAccessSectionForRole } from "@/lib/team-access-section"

describe("team access sections", () => {
  it("keeps staff, vendors, and clients in separate views", () => {
    expect(teamAccessSectionForRole("office")).toBe("internal")
    expect(teamAccessSectionForRole("field_crew")).toBe("internal")
    expect(teamAccessSectionForRole("subcontractor")).toBe("vendors")
    expect(teamAccessSectionForRole("supplier")).toBe("vendors")
    expect(teamAccessSectionForRole("client")).toBe("clients")
    expect(teamAccessSectionForRole("owner")).toBe("clients")
  })

  it("does not guess a guest or developer's relationship", () => {
    expect(teamAccessSectionForRole("guest")).toBe("other")
    expect(teamAccessSectionForRole("developer")).toBe("other")
    expect(parseTeamAccessSection("unknown")).toBe("internal")
  })
})
