import { describe, expect, it } from "vitest"

import {
  gotoInboundSmsSubject,
  shouldRouteInternalProjectSms,
} from "@/lib/goto/internal-project-routing"

describe("internal project SMS routing", () => {
  it("routes numbered [message] texts with internal mentions", () => {
    const input = { body: 'O-197-5565 [message] @"Staff A" Please check', projectNumber: "O-197-5565" }
    expect(gotoInboundSmsSubject(input)).toBe('[message] @"Staff A" Please check')
    expect(shouldRouteInternalProjectSms({ ...input, matchReason: "project_number" })).toBe(true)
  })

  it("allows an explicitly numbered staff text with a supported routing tag", () => {
    expect(
      shouldRouteInternalProjectSms({
        body: "O-197-5565 [DAILY LOG] Framing inspection complete",
        projectNumber: "O-197-5565",
        matchReason: "project_number",
      })
    ).toBe(true)
  })

  it("keeps untagged or implicitly matched staff texts dismissed", () => {
    expect(
      shouldRouteInternalProjectSms({
        body: "O-197-5565 Please call me",
        projectNumber: "O-197-5565",
        matchReason: "project_number",
      })
    ).toBe(false)
    expect(
      shouldRouteInternalProjectSms({
        body: "[DAILY LOG] Framing inspection complete",
        projectNumber: "O-197-5565",
        matchReason: "conversation",
      })
    ).toBe(false)
  })

  it("uses only the first line for destination routing", () => {
    expect(
      shouldRouteInternalProjectSms({
        body: "O-197-5565 Framing inspection complete\n[DAILY LOG]",
        projectNumber: "O-197-5565",
        matchReason: "project_number",
      })
    ).toBe(false)
  })

  it("builds the same tag-first subject used by project routing", () => {
    expect(
      gotoInboundSmsSubject({
        body: "O-197-5565 [DAILY LOG] Framing inspection complete\nPhoto attached",
        projectNumber: "O-197-5565",
      })
    ).toBe("[DAILY LOG] Framing inspection complete")
  })
})
