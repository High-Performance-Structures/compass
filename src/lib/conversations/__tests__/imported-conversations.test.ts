import { describe, expect, it } from "vitest"

import { shouldNotifyForMessage } from "@/lib/domain/conversations/imported"
import { canAccessConversationChannel, importedConversationAccess } from "../channel-access"
import { importedConversationContent, messageSenderDisplay } from "../imported-message-content"

const base = {
  channelId: "bt-thread-abc",
  isActive: true,
  isPrivate: true,
}
const imported = { sourceSystem: "buildertrend", projectStaffOnly: false }
const legalHold = { sourceSystem: "buildertrend", projectStaffOnly: true }

describe("imported conversation access", () => {
  it("lets any internal staff member open an imported conversation, as with the old archive", () => {
    expect(canAccessConversationChannel({ ...base, hasMembership: false, audience: "clients", role: "project_manager", imported })).toBe(true)
  })

  it("lets an owner who is a member open their own imported thread", () => {
    expect(canAccessConversationChannel({ ...base, hasMembership: true, audience: "clients", role: "client", imported })).toBe(true)
  })

  it("lets a vendor member open a vendor thread", () => {
    expect(canAccessConversationChannel({ ...base, hasMembership: true, audience: "sub_vendors", role: "subcontractor", imported })).toBe(true)
  })

  it("keeps outsiders out of threads they are not in", () => {
    expect(canAccessConversationChannel({ ...base, hasMembership: false, audience: "clients", role: "client", imported })).toBe(false)
  })

  it("keeps outsiders out of staff-only threads even with a membership row", () => {
    expect(canAccessConversationChannel({ ...base, hasMembership: true, audience: "staff", role: "client", imported })).toBe(false)
  })

  it("closes every imported thread on a staff-only project to outsiders, members or not", () => {
    expect(canAccessConversationChannel({ ...base, hasMembership: true, audience: "clients", role: "client", imported: legalHold })).toBe(false)
    expect(canAccessConversationChannel({ ...base, hasMembership: true, audience: "sub_vendors", role: "supplier", imported: legalHold })).toBe(false)
  })

  it("still lets staff work in a staff-only project's imported threads", () => {
    expect(canAccessConversationChannel({ ...base, hasMembership: false, audience: "clients", role: "project_manager", imported: legalHold })).toBe(true)
  })

  it("denies inactive accounts first", () => {
    expect(canAccessConversationChannel({ ...base, isActive: false, hasMembership: true, audience: "clients", role: "project_manager", imported })).toBe(false)
  })

  it("reads the import columns of a channel row", () => {
    expect(importedConversationAccess({ sourceSystem: null, projectStaffOnly: true })).toBeNull()
    expect(importedConversationAccess({ sourceSystem: "buildertrend", projectStaffOnly: null })).toEqual(imported)
  })
})

describe("imported messages", () => {
  it("never notify; native replies do", () => {
    expect(shouldNotifyForMessage({ sourceSystem: "buildertrend" })).toBe(false)
    expect(shouldNotifyForMessage({ sourceSystem: null })).toBe(true)
  })

  it("read exactly like native messages once live, with no archive note", () => {
    expect(importedConversationContent({ id: "bt-message-1-2", content: "Tile is in.", sourceSystem: "buildertrend" })).toBe("Tile is in.")
    expect(importedConversationContent({ id: "bt-message-1-2", content: "Tile is in." })).toContain("archive")
  })

  it("show a contact sender's name and never read as the importing staff member's own", () => {
    expect(messageSenderDisplay({ message: { importedSenderName: "Oscar Owner" }, userId: "staff-1", userDisplayName: "Pat PM", currentUserId: "staff-1" }))
      .toEqual({ displayName: "Oscar Owner", senderUserId: null, isOwnMessage: false })
    expect(messageSenderDisplay({ message: {}, userId: "staff-1", userDisplayName: "Pat PM", currentUserId: "staff-1" }))
      .toEqual({ displayName: "Pat PM", senderUserId: "staff-1", isOwnMessage: true })
  })
})
