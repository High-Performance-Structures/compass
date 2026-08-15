import { describe, expect, it } from "vitest"

import {
  ownerUpdatePreviewHref,
  projectAudienceConversationHref,
  projectAudiencePreviewHref,
  projectAudienceSectionHref,
} from "@/lib/project-audience-preview-routes"

describe("project audience preview routes", () => {
  it("keeps owner and sub/vendor navigation in standalone preview mode", () => {
    expect(projectAudiencePreviewHref("proj 123", "owner")).toBe(
      "/preview/projects/proj%20123/owner"
    )
    expect(projectAudiencePreviewHref("proj 123", "sub-vendor")).toBe(
      "/preview/projects/proj%20123/sub-vendor"
    )
  })

  it("keeps owner update details under the owner preview route", () => {
    expect(ownerUpdatePreviewHref("project/one", "update/two")).toBe(
      "/preview/projects/project%2Fone/owner/updates/update%2Ftwo"
    )
  })

  it("uses real guarded pages for workspace navigation", () => {
    expect(
      projectAudienceSectionHref("project/one", "owner", "schedule")
    ).toBe("/preview/projects/project%2Fone/owner/schedule")
    expect(
      projectAudienceSectionHref("project/one", "sub-vendor", "rfis")
    ).toBe("/preview/projects/project%2Fone/sub-vendor/rfis")
    expect(
      projectAudienceSectionHref("project/one", "owner", "files")
    ).toBe("/preview/projects/project%2Fone/owner/files")
    expect(
      projectAudienceSectionHref("project/one", "owner", "overview")
    ).toBe("/preview/projects/project%2Fone/owner")
  })

  it("routes owner budget access through the guarded owner workspace", () => {
    expect(
      projectAudienceSectionHref("project/one", "owner", "budget")
    ).toBe("/preview/projects/project%2Fone/owner/budget")
  })

  it("keeps conversations inside the guarded audience workspace", () => {
    expect(
      projectAudienceConversationHref("project/one", "owner", "channel/two")
    ).toBe(
      "/preview/projects/project%2Fone/owner/conversations/channel%2Ftwo"
    )
  })
})
