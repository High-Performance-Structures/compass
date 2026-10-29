import { describe, expect, it } from "vitest"
import { warrantySourceDate, warrantySourceEvidence } from "../source-review"

describe("historical warranty source evidence", () => {
  it("retains source audience text but excludes unreviewed URLs and raw fields", () => {
    const result = warrantySourceEvidence(JSON.stringify({
      commentAudiences: { Internal: "office-only evidence", Clients: "Work completed today.", "Subs/vendors": "Trade follow-up" },
      sourceDetailFields: [{ id: "internalComments", value: "Retain note" }],
      services: [{ serviceId: "service-1" }],
      images: [{ src: "https://example.test/private?token=secret" }],
      sourceEvidence: { readingCopyDriveId: "safe-file-id-123", rawPackageDriveId: "../outside?secret" },
    }))
    expect(result.comments.map((item) => item.audience)).toEqual(["Internal", "Clients", "Subs/vendors"])
    expect(result.comments[1]?.text).toBe("Work completed today.")
    expect(result.internalNotes).toBe("Retain note")
    expect(result.readingCopyHref).toBe("https://drive.google.com/file/d/safe-file-id-123/view")
    expect(result.sourceBackupHref).toBeNull()
    expect(JSON.stringify(result)).not.toContain("secret")
    expect(result.serviceCount).toBe(1)
  })

  it("does not turn missing or malformed evidence into an empty service history", () => {
    expect(warrantySourceEvidence("bad JSON")).toMatchObject({ serviceCount: null, structuredEvidenceAvailable: false, comments: [] })
    expect(warrantySourceEvidence("{}").serviceCount).toBeNull()
    expect(warrantySourceEvidence('{"services":[]}').serviceCount).toBe(0)
  })

  it("preserves source calendar dates without a local timezone conversion", () => {
    expect(warrantySourceDate("2026-01-02")).toBe("Jan 2, 2026")
    expect(warrantySourceDate("2026-10-08")).toBe("Oct 8, 2026")
    expect(warrantySourceDate(null)).toBe("Not recorded")
    expect(warrantySourceDate("2026-02-30")).toBe("2026-02-30")
  })
})
