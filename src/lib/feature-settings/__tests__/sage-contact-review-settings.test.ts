import { describe, expect, it } from "vitest"
import { parseFeatureSettings } from "@/lib/feature-settings/registry"
import { sageContactReviewerAllowed } from "@/lib/feature-settings/sage-contact-review-settings"

describe("Sage contact review settings", () => {
  it("lets the requester approve their own change by default", () => {
    const settings = parseFeatureSettings("sage-contact-review", null)
    expect(settings).toEqual({ requireSecondApprover: false, autoLinkEmployeesByEmail: true, employeeStatusFollowsSage: true })
    expect(sageContactReviewerAllowed(settings, "staff-1", "staff-1")).toBe(true)
  })

  it("requires someone else when the company turns on a second approver", () => {
    const settings = parseFeatureSettings("sage-contact-review", JSON.stringify({ requireSecondApprover: true }))
    expect(sageContactReviewerAllowed(settings, "staff-1", "staff-1")).toBe(false)
    expect(sageContactReviewerAllowed(settings, "staff-1", "reviewer-1")).toBe(true)
  })

  it("keeps employee linking and status on for a company that saved only the approver rule", () => {
    const settings = parseFeatureSettings("sage-contact-review", JSON.stringify({ requireSecondApprover: true }))
    expect(settings.autoLinkEmployeesByEmail).toBe(true)
    expect(settings.employeeStatusFollowsSage).toBe(true)
  })
})
