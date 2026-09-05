import { describe, expect, it } from "vitest"

import {
  projectEmailDestination,
  projectEmailTitle,
  projectIdFromInboundAddress,
  projectInboundEmailAddress,
} from "@/lib/email/project-address"

describe("project inbound email addressing", () => {
  it("creates and parses a durable project address", () => {
    const address = projectInboundEmailAddress("proj-o-210-mitchell")
    expect(address).toBe(
      "jarvis+project-proj-o-210-mitchell@hps-colorado.com"
    )
    expect(projectIdFromInboundAddress(`Compass <${address}>`)).toBe(
      "proj-o-210-mitchell"
    )
  })

  it.each([
    ["[MESSAGE] @Alex Please check", "message"],
    ["[message]: Project update", "message"],
    ["[Messages] Project update", "message"],
    ["[RFI] Missing roof detail", "rfi"],
    ["[RFQ] Framing package", "rfq"],
    ["[CHANGE ORDER] Add patio heater", "change_order"],
    ["[TO-DO] Confirm delivery", "todo"],
    ["[TASK] Confirm delivery", "todo"],
    ["[DELIVERY] Windows arriving Friday", "delivery"],
    ["[DAILY LOG] Site progress", "daily_log"],
    ["[Daily Log] Site progress", "daily_log"],
    ["[VIDEO] Railing stain demonstration", "video"],
  ] as const)("routes %s", (subject, destination) => {
    expect(projectEmailDestination(subject)).toBe(destination)
  })

  it("removes the message tag but keeps the internal mention", () => {
    expect(projectEmailTitle("[message] @Alex Please check")).toBe("@Alex Please check")
  })

  it("does not guess an untagged destination", () => {
    expect(projectEmailDestination("Question about the project")).toBeNull()
  })

  it("removes the routing tag from the record title", () => {
    expect(projectEmailTitle("[RFI] Missing roof detail")).toBe(
      "Missing roof detail"
    )
  })

  it("removes the video routing tag from the record title", () => {
    expect(projectEmailTitle("[Video] Railing stain demonstration")).toBe(
      "Railing stain demonstration"
    )
  })
})
