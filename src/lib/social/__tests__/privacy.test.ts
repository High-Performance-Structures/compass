import { describe, expect, it } from "vitest"

import {
  normalizeHashtags,
  socialCopyPrivacyViolations,
  validatePublicProjectIdentity,
} from "@/lib/social/privacy"

describe("social publishing privacy", () => {
  it("accepts a short descriptive public title and city-only location", () => {
    expect(validatePublicProjectIdentity({
      publicTitle: "Mountain View Renovation",
      locationCity: "Woodland Park",
      internalProjectName: "Smith 412 Pine Street",
      clientName: "Smith Family",
    })).toEqual([])
  })

  it("requires a distinct public title instead of reusing the internal job name", () => {
    expect(validatePublicProjectIdentity({
      publicTitle: "Loomis Residence",
      locationCity: "Monument",
      internalProjectName: "Loomis Residence",
      clientName: null,
    })).toContain("Public project title must differ from the internal project name.")
  })

  it("rejects client names, street addresses, and state or ZIP location detail", () => {
    expect(validatePublicProjectIdentity({
      publicTitle: "Smith Home at 412 Pine Street",
      locationCity: "Woodland Park, CO 80863",
      internalProjectName: "Smith 412 Pine Street",
      clientName: "Smith",
    })).toEqual(expect.arrayContaining([
      "Public project title cannot contain a street address.",
      "Public project title cannot contain the client name.",
      "Public location must contain a town or city name only.",
    ]))
  })

  it("blocks sensitive source data when it appears in drafted copy", () => {
    const violations = socialCopyPrivacyViolations(
      "Progress at the Jones project, 95 Aspen Road, Woodland Park 80863.",
      {
        publicTitle: "Forest Edge Build",
        publicLocationCity: "Woodland Park",
        internalProjectName: "Jones Residence",
        clientName: "Jones",
        siteAddress: "95 Aspen Road, Woodland Park, CO 80863",
      },
    )
    expect(violations).toEqual(expect.arrayContaining([
      "client name",
      "street address",
      "street address or ZIP code",
    ]))
  })

  it("normalizes and deduplicates hashtags", () => {
    expect(normalizeHashtags([
      "#Construction",
      "construction",
      "Project Progress",
      "#Colorado_Builds",
    ])).toEqual(["#Construction", "#ProjectProgress", "#Colorado_Builds"])
  })
})
