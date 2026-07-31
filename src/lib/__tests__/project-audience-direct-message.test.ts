import { describe, expect, it } from "vitest"

import type {
  AudienceContact,
  AudienceMessageChannel,
} from "@/app/actions/project-audience-preview"
import {
  projectAudienceMessageRecipientHref,
  projectAudienceMessageShortcut,
} from "@/lib/project-audience-direct-message"

function contact(input: {
  readonly id: string
  readonly userId: string | null
  readonly displayName: string
  readonly role?: string | null
}): AudienceContact {
  return {
    id: input.id,
    userId: input.userId,
    contactType: "internal",
    displayName: input.displayName,
    companyName: null,
    role: input.role ?? null,
    trade: null,
    csiDivision: null,
    csiDivisionName: null,
    email: `${input.id}@example.com`,
    phone: null,
    primaryContact: false,
  }
}

const CHANNELS: readonly AudienceMessageChannel[] = [
  {
    id: "owner/channel",
    name: "Owner Team",
    description: null,
    isPrivate: true,
  },
]

describe("projectAudienceMessageShortcut", () => {
  it("uses only the server-authorized project contacts", () => {
    const result = projectAudienceMessageShortcut({
      projectId: "project one",
      audience: "owner",
      viewerId: "viewer",
      contacts: [
        contact({
          id: "pm",
          userId: "staff-pm",
          displayName: "Project Manager",
          role: "project_manager",
        }),
        contact({
          id: "viewer",
          userId: "viewer",
          displayName: "Previewing Staff",
        }),
        contact({
          id: "unlinked",
          userId: null,
          displayName: "Unlinked Contact",
        }),
        contact({
          id: "duplicate",
          userId: "staff-pm",
          displayName: "Duplicate Project Manager",
        }),
      ],
      messageChannels: CHANNELS,
    })

    expect(result).toEqual({
      conversationHref:
        "/preview/projects/project%20one/owner/conversations/owner%2Fchannel",
      recipients: [
        {
          userId: "staff-pm",
          displayName: "Project Manager",
          role: "project_manager",
        },
      ],
    })
  })

  it("fails closed without both a private project conversation and recipient", () => {
    expect(
      projectAudienceMessageShortcut({
        projectId: "project",
        audience: "sub_vendor",
        viewerId: "partner",
        contacts: [
          contact({
            id: "pm",
            userId: "staff-pm",
            displayName: "Project Manager",
          }),
        ],
        messageChannels: [],
      })
    ).toBeNull()

    expect(
      projectAudienceMessageShortcut({
        projectId: "project",
        audience: "sub_vendor",
        viewerId: "partner",
        contacts: [
          contact({
            id: "pm",
            userId: "staff-pm",
            displayName: "Project Manager",
          }),
        ],
        messageChannels: [{ ...CHANNELS[0], isPrivate: false }],
      })
    ).toBeNull()

    expect(
      projectAudienceMessageShortcut({
        projectId: "project",
        audience: "sub_vendor",
        viewerId: "staff-pm",
        contacts: [
          contact({
            id: "pm",
            userId: "staff-pm",
            displayName: "Project Manager",
          }),
        ],
        messageChannels: CHANNELS,
      })
    ).toBeNull()
  })

  it("opens the guarded conversation with an encoded initial mention", () => {
    expect(
      projectAudienceMessageRecipientHref(
        "/preview/projects/project/sub-vendor/conversations/channel",
        {
          userId: "user/one",
          displayName: "Wes Jones & Team",
          role: "assistant_project_manager",
        }
      )
    ).toBe(
      "/preview/projects/project/sub-vendor/conversations/channel" +
        "?mention=user%2Fone&label=Wes+Jones+%26+Team"
    )
  })
})
