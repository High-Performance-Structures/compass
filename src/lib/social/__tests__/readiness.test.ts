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
  jobStatusId: "current",
  customJobStatusLabel: null,
  status: "OPEN",
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
  it("excludes old projects even when they have a valid public identity", () => {
    for (const status of ["OTHER", "COMPLETE", "INACTIVE", "ARCHIVE", "WARRANTY"]) {
      const oldProject = { ...readyProject, status, jobStatusId: status.toLowerCase() }
      expect(selectSocialReminderProject([oldProject, unconfiguredProject])).toBe(unconfiguredProject)
      expect(selectSocialReminderProject([oldProject])).toBeNull()
    }
  })

  it("excludes migrated old projects whose canonical status still defaults to current", () => {
    for (const status of ["OTHER", "COMPLETE", "INACTIVE", "ARCHIVE", "WARRANTY"]) {
      const oldProject = { ...readyProject, status }
      expect(selectSocialReminderProject([oldProject, unconfiguredProject])).toBe(unconfiguredProject)
      expect(selectSocialReminderProject([oldProject])).toBeNull()
    }
  })

  it("uses custom lifecycle labels instead of the legacy OPEN status", () => {
    for (const label of ["Warranty Service", "Paused", "Archived"]) {
      const oldProject = { ...readyProject, jobStatusId: "custom-status-id", customJobStatusLabel: label }
      expect(selectSocialReminderProject([oldProject, unconfiguredProject])).toBe(unconfiguredProject)
    }
    const unknownProject = { ...readyProject, jobStatusId: "missing-status-id" }
    expect(selectSocialReminderProject([unknownProject])).toBeNull()
  })

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
