import { describe, expect, it } from "vitest"

import {
  ownerUpdatePreviewHref,
  projectAudienceConversationHref,
  projectAudiencePreviewHref,
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

  it("keeps conversations inside the guarded audience workspace", () => {
    expect(
      projectAudienceConversationHref("project/one", "owner", "channel/two")
    ).toBe(
      "/preview/projects/project%2Fone/owner/conversations/channel%2Ftwo"
    )
  })
})
