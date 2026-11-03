import { describe, expect, it } from "vitest"

import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { projectCompanyOptions } from "@/components/projects/project-company-picker"

function option(
  id: string,
  companyName: string | null
): ProjectTaskAssigneeOption {
  return {
    id,
    label: id,
    name: id,
    companyName,
    email: null,
    phone: null,
    contactType: "subcontractor",
    source: "project",
    projectContactId: id,
    directoryContactId: null,
    projectAccess: true,
  }
}

describe("projectCompanyOptions", () => {
  it("returns trimmed, sorted, case-insensitively unique company names", () => {
    expect(
      projectCompanyOptions([
        option("one", " Zenith Electric "),
        option("two", "acme framing"),
        option("three", "ACME Framing"),
        option("four", null),
        option("five", " "),
      ])
    ).toEqual(["acme framing", "Zenith Electric"])
  })
})
