import { describe, expect, it } from "vitest"

import {
  isReviewSampleProject,
  REVIEW_SAMPLE_PROJECT_ID,
  reviewSampleDocuments,
  reviewSampleFile,
} from "@/lib/field/review-sample"

describe("review sample field documents", () => {
  it("returns neutral downloadable files only for the isolated review project", () => {
    expect(isReviewSampleProject(REVIEW_SAMPLE_PROJECT_ID)).toBe(true)
    expect(isReviewSampleProject("another-project")).toBe(false)
    const documents = reviewSampleDocuments(REVIEW_SAMPLE_PROJECT_ID)

    expect(documents.map((document) => document.name)).toEqual([
      "Site Safety Checklist.txt",
      "First Week Field Plan.txt",
    ])
    expect(reviewSampleDocuments("another-project")).toEqual([])
  })

  it("resolves content within the exact review-project boundary", () => {
    expect(
      reviewSampleFile(
        REVIEW_SAMPLE_PROJECT_ID,
        "review-sample-safety-checklist"
      )?.content
    ).toContain("SITE SAFETY CHECKLIST")
    expect(
      reviewSampleFile("another-project", "review-sample-safety-checklist")
    ).toBeNull()
  })
})
