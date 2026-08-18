import { describe, expect, it } from "vitest"

import {
  FOLLOW_UP_EXCLUDED_JOB_STATUSES,
  PROJECT_CLIENT_STATUSES,
  PROJECT_JOB_STATUS_DEFINITIONS,
  buildProjectNumberWithAddressSuffix,
  defaultFollowUpCadenceDays,
  isFollowUpEligibleJobStatus,
  isEligibleFollowUpOwner,
  isMeaningfulClientInteraction,
  isBuiltInProjectJobStatusLabel,
  isSupportedProjectJobStatusLabel,
  legacyProjectStatusAfterClientUpdate,
  normalizeProjectJobStatusLabel,
  projectNumberParts,
} from "@/lib/project-profile"

describe("project profile rules", () => {
  it("keeps client status limited to lead and customer", () => {
    expect(PROJECT_CLIENT_STATUSES).toEqual(["lead", "customer"])
  })

  it("clears the legacy lead status when a project becomes a customer", () => {
    expect(
      legacyProjectStatusAfterClientUpdate({
        currentStatus: "LEAD",
        clientStatus: "customer",
      }),
    ).toBe("OPEN")
    expect(
      legacyProjectStatusAfterClientUpdate({
        currentStatus: "LEAD",
        clientStatus: "lead",
      }),
    ).toBe("LEAD")
    expect(
      legacyProjectStatusAfterClientUpdate({
        currentStatus: "WARRANTY",
        clientStatus: "customer",
      }),
    ).toBe("WARRANTY")
  })

  it("keeps the approved Sage-aligned job statuses standardized", () => {
    expect(PROJECT_JOB_STATUS_DEFINITIONS.map((status) => status.label)).toEqual(
      expect.arrayContaining([
        "Intake",
        "Estimate Sent",
        "Design Proposal Signed",
        "Awarded",
        "Under Construction",
        "Punchlist",
        "Bid Refused",
      ]),
    )
  })

  it("recognizes built-in status labels before an administrator creates a custom status", () => {
    expect(isBuiltInProjectJobStatusLabel("Intake")).toBe(true)
    expect(isBuiltInProjectJobStatusLabel(" estimate sent ")).toBe(true)
    expect(isBuiltInProjectJobStatusLabel("Warranty")).toBe(false)
    expect(isSupportedProjectJobStatusLabel("Warranty / punch-list")).toBe(true)
    expect(isSupportedProjectJobStatusLabel("État")).toBe(false)
    expect(normalizeProjectJobStatusLabel(" Warranty ")).toBe("warranty")
  })

  it("replaces only the address-derived number suffix", () => {
    expect(buildProjectNumberWithAddressSuffix("H-430-00", "2150")).toBe(
      "H-430-2150",
    )
    expect(projectNumberParts("H-430-2150")).toEqual({
      department: "H",
      sequence: "430",
      addressSuffix: "2150",
    })
  })

  it("rejects a number edit that would alter the department or sequence", () => {
    expect(() => buildProjectNumberWithAddressSuffix("H-430-00", "21/50")).toThrow(
      "letters and numbers",
    )
    expect(projectNumberParts("Not a project number")).toBeNull()
  })

  it("excludes completed and inactive states from client follow-up", () => {
    for (const statusId of FOLLOW_UP_EXCLUDED_JOB_STATUSES) {
      expect(isFollowUpEligibleJobStatus(statusId)).toBe(false)
    }
    expect(isFollowUpEligibleJobStatus("estimate_sent")).toBe(true)
  })

  it("uses status-specific client follow-up cadences", () => {
    expect(defaultFollowUpCadenceDays("intake")).toBe(2)
    expect(defaultFollowUpCadenceDays("estimate_sent")).toBe(3)
    expect(defaultFollowUpCadenceDays("engineering")).toBe(7)
  })

  it("counts only validated client communications as meaningful touches", () => {
    expect(
      isMeaningfulClientInteraction({ interactionType: "call", direction: "outbound", source: "manual" }),
    ).toBe(true)
    expect(
      isMeaningfulClientInteraction({ interactionType: "email", direction: "inbound", source: "email" }),
    ).toBe(true)
    expect(
      isMeaningfulClientInteraction({ interactionType: "sms", direction: "inbound", source: "goto_sms" }),
    ).toBe(true)
    expect(
      isMeaningfulClientInteraction({ interactionType: "schedule_change", direction: "outbound", source: "manual" }),
    ).toBe(false)
    expect(
      isMeaningfulClientInteraction({ interactionType: "email", direction: "outbound", source: "background_sync" }),
    ).toBe(false)
  })

  it("allows follow-up owners only when they are active internal members", () => {
    expect(isEligibleFollowUpOwner({ active: true, role: "office" })).toBe(true)
    expect(isEligibleFollowUpOwner({ active: false, role: "office" })).toBe(false)
    expect(isEligibleFollowUpOwner({ active: true, role: "owner" })).toBe(false)
  })
})
