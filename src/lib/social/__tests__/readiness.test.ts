import { describe, expect, it } from "vitest"

import { selectSocialReminderProject, socialPublishingIssue, socialReadinessErrors } from "@/lib/social/readiness"

const unconfiguredProject = {
  id: "proj-bt-bagby-generator",
  name: "Bagby Generator",
  projectNumber: null,
  department: null,
  publicTitle: null,
  publicLocationCity: null,
  clientName: "Bagby",
}
const readyProject = {
  ...unconfiguredProject,
  id: "proj-o-100",
  projectNumber: "O-100",
  name: "Private client residence",
  clientName: "Private Client",
  publicTitle: "Modern Homestead",
  publicLocationCity: "Woodland Park",
}

describe("social setup reminders", () => {
  it("does not send staff to an unconfigured first project when a ready project exists", () => {
    expect(selectSocialReminderProject([unconfiguredProject, readyProject])).toBe(readyProject)
  })

  it("keeps a setup destination when no project is ready, and handles an empty portfolio", () => {
    expect(selectSocialReminderProject([unconfiguredProject])).toBe(unconfiguredProject)
    expect(socialReadinessErrors(unconfiguredProject)).toHaveLength(2)
    expect(selectSocialReminderProject([])).toBeNull()
  })

  it("does not recommend a populated identity that reveals a client name", () => {
    const unsafeProject = { ...readyProject, publicTitle: "Private Client home" }
    expect(selectSocialReminderProject([unsafeProject, readyProject])).toBe(readyProject)
  })
})

describe("connected accounts with publishing failures", () => {
  it("explains credits and app capability failures without displaying raw provider errors", () => {
    expect(socialPublishingIssue({ platform: "x", lastError: "X publishing failed (402): credits depleted" }))
      .toContain("X API credits were depleted")
    expect(socialPublishingIssue({ platform: "facebook", lastError: "Meta publishing failed (400): (#3) Application does not have the capability to make this API call." }))
      .toContain("Facebook album settings")
    expect(socialPublishingIssue({ platform: "instagram", lastError: "Unknown provider detail" }))
      .not.toContain("Unknown provider detail")
    expect(socialPublishingIssue({ platform: "instagram", lastError: null })).toBeNull()
  })
})
