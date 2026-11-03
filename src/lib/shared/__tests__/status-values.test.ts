import { describe, expect, it } from "vitest"

import {
  classifyStatusValue,
  distinctValuesSql,
  normalisationScript,
  normalisationSql,
  reportColumn,
} from "@/lib/shared/status-values"

describe("classifyStatusValue", () => {
  it("accepts list values as they are", () => {
    expect(classifyStatusValue("draft", ["draft", "sent"])).toEqual({ kind: "listed" })
    expect(classifyStatusValue("OPEN", ["OPEN", "WARRANTY"])).toEqual({ kind: "listed" })
  })

  it("maps exact case, whitespace and separator variants to the one listed value", () => {
    expect(classifyStatusValue("Draft", ["draft", "sent"])).toEqual({ kind: "variant", canonical: "draft", reason: "case_or_spacing" })
    expect(classifyStatusValue(" sent ", ["draft", "sent"])).toEqual({ kind: "variant", canonical: "sent", reason: "case_or_spacing" })
    expect(classifyStatusValue("In Progress", ["in_progress"])).toEqual({ kind: "variant", canonical: "in_progress", reason: "case_or_spacing" })
    expect(classifyStatusValue("in-progress", ["in_progress"])).toEqual({ kind: "variant", canonical: "in_progress", reason: "case_or_spacing" })
    expect(classifyStatusValue("open", ["OPEN", "WARRANTY"])).toEqual({ kind: "variant", canonical: "OPEN", reason: "case_or_spacing" })
  })

  it("maps a known spelling only when its partner is on the list", () => {
    expect(classifyStatusValue("canceled", ["draft", "cancelled"])).toEqual({ kind: "variant", canonical: "cancelled", reason: "known_spelling" })
    expect(classifyStatusValue("Completed", ["complete"])).toEqual({ kind: "variant", canonical: "complete", reason: "known_spelling" })
    expect(classifyStatusValue("canceled", ["draft", "void"])).toEqual({ kind: "unknown" })
  })

  it("never guesses between two listed values", () => {
    expect(classifyStatusValue("open", ["open ", " OPEN"])).toEqual({ kind: "unknown" })
    expect(classifyStatusValue("prospect", ["lead", "customer"])).toEqual({ kind: "unknown" })
  })
})

describe("report SQL", () => {
  it("reads one column of one table with SELECT DISTINCT", () => {
    expect(distinctValuesSql("feedback", "type")).toBe(
      'SELECT DISTINCT "type" AS value FROM "feedback" WHERE "type" IS NOT NULL',
    )
  })

  it("writes one exact UPDATE per variant and escapes quotes", () => {
    expect(normalisationSql("users", "role", "Project Manager", "project_manager")).toBe(
      `UPDATE "users" SET "role" = 'project_manager' WHERE "role" = 'Project Manager';`,
    )
    expect(normalisationSql("feedback", "type", "o'bug", "bug")).toBe(
      `UPDATE "feedback" SET "type" = 'bug' WHERE "type" = 'o''bug';`,
    )
  })

  it("refuses identifiers that are not plain names", () => {
    expect(() => distinctValuesSql("users; DROP TABLE users", "role")).toThrow("Unsafe SQL identifier")
  })
})

describe("reportColumn", () => {
  it("sorts stored values into listed, exact variants and values for review", () => {
    const report = reportColumn(
      { table: "feedback", column: "type", listName: "FEEDBACK_TYPES", list: ["bug", "feature", "question", "general"] },
      ["bug", "Bug", " feature ", "complaint"],
    )
    expect(report.listed).toEqual(["bug"])
    expect(report.variants).toEqual([
      { value: "Bug", canonical: "bug", reason: "case_or_spacing" },
      { value: " feature ", canonical: "feature", reason: "case_or_spacing" },
    ])
    expect(report.unknown).toEqual(["complaint"])
    expect(normalisationScript([report])).toEqual([
      `UPDATE "feedback" SET "type" = 'bug' WHERE "type" = 'Bug';`,
      `UPDATE "feedback" SET "type" = 'feature' WHERE "type" = ' feature ';`,
    ])
  })
})
