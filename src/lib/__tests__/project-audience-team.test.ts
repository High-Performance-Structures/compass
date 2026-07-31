import { describe, expect, it } from "vitest"

import {
  isAssignedVisibleAudienceTeamMember,
  isVisibleAudienceTeamMember,
} from "@/lib/project-audience-team"

describe("project audience team", () => {
  it.each([
    ["project administrator", "user-sylvi", "sylvi@example.com", "secondary_admin"],
    ["assistant PM", "user-wes", "wes@example.com", "assistant_project_manager"],
    ["office staff", "user-office", "office@example.com", "office"],
  ])("shows active human %s roles", (_label, userId, email, role) => {
    expect(isVisibleAudienceTeamMember({ userId, email, role })).toBe(true)
  })

  it.each([
    ["external owner", "user-owner", "owner@example.com", "client"],
    ["service agent", "svc_jarvis", "jarvis@example.com", "office"],
    ["Compass system account", "user-compass", "compass@hps-colorado.com", "admin"],
    ["archive account", "system-archive", "archive@compass.local", "office"],
    ["external developer", "user-developer", "nicholai@biohazardvfx.com", "admin"],
  ])("hides %s", (_label, userId, email, role) => {
    expect(isVisibleAudienceTeamMember({ userId, email, role })).toBe(false)
  })

  it("requires an internal project assignment before exposing staff", () => {
    expect(
      isAssignedVisibleAudienceTeamMember({
        userId: "user-project-a",
        email: "pm@example.com",
        organizationRole: "project_manager",
        projectRole: "project_manager",
      })
    ).toBe(true)
    expect(
      isAssignedVisibleAudienceTeamMember({
        userId: "user-project-b",
        email: "office@example.com",
        organizationRole: "office",
        projectRole: null,
      })
    ).toBe(false)
  })

  it("rejects an external project role even when the organization role is internal", () => {
    expect(
      isAssignedVisibleAudienceTeamMember({
        userId: "user-cross-role",
        email: "owner@example.com",
        organizationRole: "office",
        projectRole: "owner",
      })
    ).toBe(false)
  })
})
