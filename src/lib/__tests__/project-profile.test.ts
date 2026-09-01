import { describe, expect, it } from "vitest"

import {
  customProjectInteractionType,
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
  projectClientStatusLabel,
  projectInteractionTypeLabel,
  projectInteractionTypeOptions,
  projectJobStatusOptions,
  projectJobStatusBucket,
  projectJobStatusLabel,
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
        "Under Warranty",
        "Bid Refused",
      ]),
    )
  })

  it("uses the exact approved job status label for project-facing status", () => {
    expect(
      projectJobStatusLabel({ jobStatusId: "current", customLabel: null }),
    ).toBe("Current")
    expect(
      projectJobStatusLabel({
        jobStatusId: "organization-warranty",
        customLabel: "Extended Warranty",
      }),
    ).toBe("Extended Warranty")
    expect(
      projectJobStatusLabel({ jobStatusId: "missing", customLabel: null }),
    ).toBe("Unknown job status")
  })

  it("keeps client classification separate from job status", () => {
    expect(projectClientStatusLabel("customer")).toBe("Customer")
    expect(projectClientStatusLabel("lead")).toBe("Lead")
    expect(projectClientStatusLabel("unexpected")).toBe("Unknown client status")
  })

  it("prefers an organization status over a built-in label collision", () => {
    const options = projectJobStatusOptions([
      {
        id: "sage-37-under-warranty",
        label: "Under Warranty",
        sageCode: "37",
        followUpCadenceDays: null,
        active: true,
      },
    ])

    const warrantyOptions = options.filter(
      (option) => normalizeProjectJobStatusLabel(option.label) === "under warranty",
    )
    expect(warrantyOptions).toHaveLength(1)
    expect(warrantyOptions[0]).toEqual({
      id: "sage-37-under-warranty",
      label: "Under Warranty",
      sageCode: "37",
      followUpCadenceDays: null,
      active: true,
      builtIn: false,
    })
  })

  it("preserves a selected built-in status on an organization label collision", () => {
    const options = projectJobStatusOptions(
      [
        {
          id: "sage-37-under-warranty",
          label: "Under Warranty",
          sageCode: "37",
          followUpCadenceDays: null,
          active: true,
        },
      ],
      "under_warranty",
    )

    const warrantyOptions = options.filter(
      (option) => normalizeProjectJobStatusLabel(option.label) === "under warranty",
    )
    expect(warrantyOptions).toHaveLength(1)
    expect(warrantyOptions[0]).toEqual({
      id: "under_warranty",
      label: "Under Warranty",
      sageCode: null,
      followUpCadenceDays: null,
      active: true,
      builtIn: true,
    })
  })

  it("keeps a noncolliding organization status alongside built-ins", () => {
    const options = projectJobStatusOptions([
      {
        id: "custom-site-review",
        label: "Site Review",
        sageCode: "42",
        followUpCadenceDays: 5,
        active: true,
      },
    ])

    expect(options.some((option) => option.id === "under_warranty")).toBe(true)
    expect(options.some((option) => option.id === "custom-site-review")).toBe(true)
    expect(
      options.filter(
        (option) => normalizeProjectJobStatusLabel(option.label) === "site review",
      ),
    ).toHaveLength(1)
  })

  it("groups project search views from approved job status rather than legacy OPEN", () => {
    expect(
      projectJobStatusBucket({
        jobStatusId: "current",
        jobStatusLabel: "Current",
      }),
    ).toBe("active")
    expect(
      projectJobStatusBucket({
        jobStatusId: "under_warranty",
        jobStatusLabel: "Under Warranty",
      }),
    ).toBe("warranty")
    expect(
      projectJobStatusBucket({
        jobStatusId: "organization-warranty",
        jobStatusLabel: "Warranty Service",
      }),
    ).toBe("warranty")
    expect(
      projectJobStatusBucket({
        jobStatusId: "complete",
        jobStatusLabel: "Complete",
      }),
    ).toBe("complete")
    expect(
      projectJobStatusBucket({
        jobStatusId: "bid_refused",
        jobStatusLabel: "Bid Refused",
      }),
    ).toBe("inactive")
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

  it("labels the built-in text and document/submittal interaction choices", () => {
    expect(projectInteractionTypeLabel("sms")).toBe("Text")
    expect(projectInteractionTypeLabel("client_send")).toBe("Document/Submittal to Client")
    expect(
      isMeaningfulClientInteraction({ interactionType: "sms", direction: "outbound", source: "manual" }),
    ).toBe(true)
  })

  it("adds valid custom interaction types to the reusable organization list", () => {
    const designReview = customProjectInteractionType("Design review")
    expect(designReview).toBe("custom:Design review")
    expect(customProjectInteractionType("Call")).toBeNull()
    expect(customProjectInteractionType("x".repeat(61))).toBeNull()
    expect(
      isMeaningfulClientInteraction({
        interactionType: designReview ?? "",
        direction: "outbound",
        source: "manual",
      }),
    ).toBe(true)
    expect(projectInteractionTypeOptions([
      "custom:Warranty consultation",
      "custom:Design review",
      "custom:design review",
      "not-custom",
    ])).toEqual(expect.arrayContaining([
      { id: "sms", label: "Text" },
      { id: "client_send", label: "Document/Submittal to Client" },
      { id: "custom:Design review", label: "Design review" },
      { id: "custom:Warranty consultation", label: "Warranty consultation" },
    ]))
  })

  it("allows follow-up owners only when they are active internal members", () => {
    expect(isEligibleFollowUpOwner({ active: true, role: "office" })).toBe(true)
    expect(isEligibleFollowUpOwner({ active: false, role: "office" })).toBe(false)
    expect(isEligibleFollowUpOwner({ active: true, role: "owner" })).toBe(false)
  })
})
