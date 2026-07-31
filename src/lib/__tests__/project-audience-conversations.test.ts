import { describe, expect, it } from "vitest"

import {
  planProjectAudienceMemberReconciliation,
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

  it("removes stale cross-project members and their unread state", () => {
    expect(
      planProjectAudienceMemberReconciliation({
        existingMembers: [
          { userId: "staff-project-a", role: "moderator" },
          { userId: "staff-project-b", role: "moderator" },
          { userId: "owner-project-a", role: "member" },
        ],
        existingReadStateUserIds: [
          "staff-project-a",
          "staff-project-b",
          "owner-project-a",
          "orphan-read-state",
        ],
        desiredMembers: [
          { userId: "staff-project-a", role: "moderator" },
          { userId: "owner-project-a", role: "member" },
        ],
      })
    ).toEqual({
      addMembers: [],
      updateMembers: [],
      removeMemberUserIds: ["staff-project-b"],
      addReadStateUserIds: [],
      removeReadStateUserIds: ["staff-project-b", "orphan-read-state"],
    })
  })

  it("repairs roles and preserves valid staff and external participants", () => {
    expect(
      planProjectAudienceMemberReconciliation({
        existingMembers: [
          { userId: "assigned-staff", role: "member" },
          { userId: "invited-owner", role: "member" },
          { userId: "wrong-audience-user", role: "member" },
        ],
        existingReadStateUserIds: [
          "assigned-staff",
          "wrong-audience-user",
        ],
        desiredMembers: [
          { userId: "assigned-staff", role: "moderator" },
          { userId: "invited-owner", role: "member" },
        ],
      })
    ).toEqual({
      addMembers: [],
      updateMembers: [
        { userId: "assigned-staff", role: "moderator" },
      ],
      removeMemberUserIds: ["wrong-audience-user"],
      addReadStateUserIds: ["invited-owner"],
      removeReadStateUserIds: ["wrong-audience-user"],
    })
  })
})
