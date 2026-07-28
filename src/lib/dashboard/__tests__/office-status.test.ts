import { describe, expect, it } from "vitest"

import {
  DESK_STATUS_LABELS,
  deskStatusForPresenceMessage,
} from "@/lib/dashboard/office-status"

describe("deskStatusForPresenceMessage", () => {
  it.each(Object.entries(DESK_STATUS_LABELS))(
    "restores %s from its saved presence message",
    (status, label) => {
      expect(deskStatusForPresenceMessage(label)).toBe(status)
    }
  )

  it("defaults to in-office when no recognized status has been saved", () => {
    expect(deskStatusForPresenceMessage(null)).toBe("in-office")
    expect(deskStatusForPresenceMessage("Heads down")).toBe("in-office")
  })
})
