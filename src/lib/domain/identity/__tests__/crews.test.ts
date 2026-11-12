import { describe, expect, it } from "vitest"

import { crewInputProblem, type CrewInput } from "../crews"

const staff = new Set(["u-mike", "u-jose", "u-dan"])
const icf: CrewInput = { name: "ICF Crew", department: "H", leadUserId: "u-mike", memberIds: ["u-mike", "u-jose"] }

describe("crewInputProblem", () => {
  it("accepts a named crew of staff with a lead on it", () => {
    expect(crewInputProblem(icf, staff)).toBeNull()
    expect(crewInputProblem({ ...icf, department: null, leadUserId: null, memberIds: [] }, staff)).toBeNull()
  })

  it("rejects a blank name, outside people and a lead who is not on the crew", () => {
    expect(crewInputProblem({ ...icf, name: "  " }, staff)).toBe("Give the crew a name.")
    expect(crewInputProblem({ ...icf, memberIds: ["u-mike", "u-vendor"] }, staff)).toBe("Crews are for your own staff only.")
    expect(crewInputProblem({ ...icf, leadUserId: "u-dan" }, staff)).toBe("The crew lead must be on the crew.")
  })
})
