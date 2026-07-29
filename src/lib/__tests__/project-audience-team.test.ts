import { describe, expect, it } from "vitest"

import { isVisibleAudienceTeamMember } from "@/lib/project-audience-team"

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
  ])("hides %s", (_label, userId, email, role) => {
    expect(isVisibleAudienceTeamMember({ userId, email, role })).toBe(false)
  })
})
