import { describe, expect, it } from "vitest"

import {
  projectAudienceChannelAudience,
  projectAudienceConversationId,
} from "@/lib/project-audience-conversations"

describe("project audience conversations", () => {
  it("uses one private owner-team conversation per project", () => {
    expect(
      projectAudienceConversationId({
        projectId: "proj-o-202",
        audience: "owner",
        contactId: "contact-one",
      })
    ).toBe("project-owner-proj-o-202")
    expect(projectAudienceChannelAudience("owner")).toBe("clients")
  })

  it("isolates sub/vendor conversations by project contact", () => {
    expect(
      projectAudienceConversationId({
        projectId: "proj-o-202",
        audience: "sub_vendor",
        contactId: "contact-one",
      })
    ).not.toBe(
      projectAudienceConversationId({
        projectId: "proj-o-202",
        audience: "sub_vendor",
        contactId: "contact-two",
      })
    )
    expect(projectAudienceChannelAudience("sub_vendor")).toBe("sub_vendors")
  })
})
