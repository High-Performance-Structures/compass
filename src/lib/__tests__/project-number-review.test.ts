import { describe, expect, it } from "vitest"

import {
  projectNumberReviewDecisionKey,
  isExactProjectNumberReviewMerge,
  isApprovedProjectNumber,
  projectNumberDepartmentSequence,
  projectNumberReviewIssue,
} from "@/lib/project-number-review"

describe("project number review", () => {
  it("keys durable approvals to the exact normalized number and project", () => {
    expect(projectNumberReviewDecisionKey("p1", " bt-lead-1 ")).toBe("p1:BT-LEAD-1")
  })
  it("flags extra-segment cutover numbers and offers a non-automatic suggestion", () => {
    expect(projectNumberReviewIssue("n-956-25811-00")).toEqual({
      currentProjectNumber: "n-956-25811-00",
      department: "N",
      sequence: "956",
      suggestedProjectNumber: "N-956-25811",
      reason: "extra_segments",
    })
  })

  it("flags Buildertrend placeholders and extracts only explicit leading governed numbers", () => {
    expect(
      projectNumberReviewIssue(
        "BT-LEAD-21843125",
        "N-841-55-Justin Blank Fox Blocks Portion",
      ),
    ).toEqual({
      currentProjectNumber: "BT-LEAD-21843125",
      department: "N",
      sequence: "841",
      suggestedProjectNumber: "N-841-55",
      reason: "buildertrend_placeholder",
    })
    expect(projectNumberReviewIssue("BT-100", "Mingo Residence Slabs")).toEqual({
      currentProjectNumber: "BT-100",
      department: null,
      sequence: null,
      suggestedProjectNumber: null,
      reason: "buildertrend_placeholder",
    })
    expect(
      projectNumberReviewIssue("BT-EXAMPLE-001", "D-100-SOUTH Example Design"),
    ).toMatchObject({
      department: "D",
      sequence: "100",
      suggestedProjectNumber: "D-100-SOUTH",
      reason: "buildertrend_placeholder",
    })
  })

  it("uses reviewed Buildertrend identity for collisions without trusting free text", () => {
    expect(
      projectNumberDepartmentSequence(
        "BT-LEAD-22504838",
        "N-821-11828 Fox Block Order Part 1",
      ),
    ).toBe("N-821")
    expect(
      projectNumberDepartmentSequence("BT-LEAD-1", "Smith project N-821-11828"),
    ).toBeNull()
  })

  it.each(["H-401-5025", "N-1000-00", "O-202-WEST", "D-2-DESIGN"])(
    "accepts the governed three-part form %s",
    (projectNumber) => {
      expect(isApprovedProjectNumber(projectNumber)).toBe(true)
      expect(projectNumberReviewIssue(projectNumber)).toBeNull()
    },
  )

  it.each(["H-167", "X-10-20-00", null])(
    "does not mislabel unrelated legacy values %s as extra-segment cutover numbers",
    (projectNumber) => {
      expect(projectNumberReviewIssue(projectNumber)).toBeNull()
    },
  )

  it("only permits the special review merge into the exact suggested base number", () => {
    expect(
      isExactProjectNumberReviewMerge({
        reviewedProjectNumber: "N-956-25811-00",
        keptProjectNumber: "N-956-25811",
      }),
    ).toBe(true)
    expect(
      isExactProjectNumberReviewMerge({
        reviewedProjectNumber: "N-841-6385-00",
        keptProjectNumber: "N-814-6385",
      }),
    ).toBe(false)
    expect(
      isExactProjectNumberReviewMerge({
        reviewedProjectNumber: "N-841-6385-00",
        keptProjectNumber: "N-841-55",
      }),
    ).toBe(false)
    expect(
      isExactProjectNumberReviewMerge({
        reviewedProjectNumber: "BT-LEAD-21843125",
        reviewedProjectName: "N-841-55-Justin Blank Fox Blocks Portion",
        keptProjectNumber: "N-841-55",
      }),
    ).toBe(true)
  })
})
