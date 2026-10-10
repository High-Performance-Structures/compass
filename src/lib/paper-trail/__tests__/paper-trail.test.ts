import { describe, expect, it } from "vitest"
import { FEATURE_SETTINGS, parseFeatureSettings } from "@/lib/feature-settings/registry"
import { renderRecordSheet } from "@/lib/paper-trail/document"
import { internalDomainSet, isSharedOutside } from "@/lib/paper-trail/folders"
import { driveFileName } from "@/lib/paper-trail/processor"
import { paperTrailAllows } from "@/lib/paper-trail/record-types"

const defaults = FEATURE_SETTINGS["paper-trail"].defaults

describe("paper trail settings", () => {
  it("ships switched off", () => {
    expect(defaults.mode).toBe("off")
    expect(paperTrailAllows(defaults, "purchase_order", "proj-1")).toBe(false)
  })

  it("limits a pilot to the listed projects", () => {
    const pilot = { ...defaults, mode: "pilot" as const, pilotProjectIds: ["proj-1"] }
    expect(paperTrailAllows(pilot, "purchase_order", "proj-1")).toBe(true)
    expect(paperTrailAllows(pilot, "purchase_order", "proj-2")).toBe(false)
  })

  it("respects each record type switch", () => {
    const on = { ...defaults, mode: "on" as const, estimates: false }
    expect(paperTrailAllows(on, "purchase_order", "proj-9")).toBe(true)
    expect(paperTrailAllows(on, "estimate", "proj-9")).toBe(false)
  })

  it("falls back to defaults for invalid stored values", () => {
    expect(parseFeatureSettings("paper-trail", '{"quietMinutes": 0}').quietMinutes).toBe(3)
    expect(parseFeatureSettings("paper-trail", '{"internalDomains": ["not a domain"]}').internalDomains).toEqual([])
  })
})

describe("shared-outside check", () => {
  const internal = internalDomainSet("office@hps-colorado.com", ["openrangeconstruction.ltd"])

  it("treats company accounts on either domain as inside", () => {
    expect(
      isSharedOutside(
        [
          { id: "1", type: "user", role: "owner", emailAddress: "office@hps-colorado.com" },
          { id: "2", type: "user", role: "writer", emailAddress: "pm@openrangeconstruction.ltd" },
          { id: "3", type: "domain", role: "reader", domain: "hps-colorado.com" },
        ],
        internal,
      ),
    ).toBe(false)
  })

  it("flags links, other domains, and outside people", () => {
    expect(isSharedOutside([{ id: "1", type: "anyone", role: "reader" }], internal)).toBe(true)
    expect(isSharedOutside([{ id: "1", type: "domain", role: "reader", domain: "vendor.com" }], internal)).toBe(true)
    expect(isSharedOutside([{ id: "1", type: "user", role: "reader", emailAddress: "owner@gmail.com" }], internal)).toBe(true)
  })

  it("errs toward private when an address is unreadable", () => {
    expect(isSharedOutside([{ id: "1", type: "group", role: "reader" }], internal)).toBe(true)
  })
})

describe("record sheet", () => {
  const sheet = {
    companyName: "High Performance Structures",
    companyLines: ["Woodland Park, CO"],
    recordLabel: "Purchase Order",
    title: "PO 1042",
    projectLabel: "H-012 - Loomis",
    status: "Sent",
    generatedAt: "2026-10-10T19:00:00.000Z",
    sections: [
      { kind: "fields" as const, heading: "Order", fields: [["Vendor", "<script>alert(1)</script>"] as const] },
      { kind: "text" as const, heading: "Notes", body: "Line one\nLine two" },
    ],
  }

  it("escapes record values", () => {
    const html = renderRecordSheet(sheet)
    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;script&gt;")
  })

  it("is self-contained", () => {
    const html = renderRecordSheet(sheet)
    expect(html).not.toMatch(/<script|<link|src="http/)
  })

  it("marks milestone copies as frozen", () => {
    expect(renderRecordSheet({ ...sheet, milestoneLabel: "Sent 2026-10-10" })).toContain("never changed")
    expect(renderRecordSheet(sheet)).toContain("replaced automatically")
  })
})

describe("drive file names", () => {
  it("removes characters Drive paths cannot carry", () => {
    expect(driveFileName("PO 1042 - Lumber / framing: phase 2")).toBe("PO 1042 - Lumber - framing- phase 2.pdf")
  })
})
