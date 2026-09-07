import { describe, expect, it } from "vitest"

import {
  isExactProjectNumberReviewMerge,
  isApprovedProjectNumber,
  projectNumberReviewIssue,
} from "@/lib/project-number-review"

describe("project number review", () => {
  it("flags extra-segment cutover numbers and offers a non-automatic suggestion", () => {
    expect(projectNumberReviewIssue("n-956-25811-00")).toEqual({
      currentProjectNumber: "n-956-25811-00",
      department: "N",
      sequence: "956",
      suggestedProjectNumber: "N-956-25811",
      reason: "extra_segments",
    })
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
  })
})
