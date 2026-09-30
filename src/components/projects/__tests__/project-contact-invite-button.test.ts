import { createElement, type ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/actions/project-access-invitations", () => ({
  sendProjectAccessInvitation: vi.fn(),
}))

import { ProjectContactInviteButton } from "@/components/projects/project-contact-invite-button"

const contact = {
  projectId: "project-1",
  projectLabel: "Test project",
  contactId: "contact-1",
  contactName: "Example Contact",
  contactEmail: "contact@example.com",
  contactType: "owner",
  compassAccountStatus: "not_registered",
} satisfies Omit<ComponentProps<typeof ProjectContactInviteButton>, "accessStatus">

describe("ProjectContactInviteButton", () => {
  it("offers a resend action for a pending invitation", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectContactInviteButton, { ...contact, accessStatus: "pending" })
    )
    expect(html).toContain("Resend invitation")
    expect(html).not.toContain("Invite to Compass")
  })

  it("keeps a first invitation distinct from a resend", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectContactInviteButton, { ...contact, accessStatus: "not_invited" })
    )
    expect(html).toContain("Invite to Compass")
    expect(html).not.toContain("Resend invitation")
  })
})
