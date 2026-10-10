import { describe, expect, it } from "vitest"
import { FEATURE_SETTINGS, parseFeatureSettings } from "@/lib/feature-settings/registry"
import { checkRecordCopyToken, signRecordCopyToken } from "@/lib/paper-trail/print-token"
import { internalDomainSet, isSharedOutside, outsideAccess } from "@/lib/paper-trail/folders"
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

  it("names outside access by domain only", () => {
    expect(
      outsideAccess(
        [
          { id: "1", type: "user", role: "writer", emailAddress: "pm@openrangeconstruction.ltd" },
          { id: "2", type: "user", role: "reader", emailAddress: "owner@gmail.com" },
          { id: "3", type: "user", role: "reader", emailAddress: "other@gmail.com" },
          { id: "4", type: "anyone", role: "reader" },
        ],
        internal,
      ),
    ).toEqual(["anyone with the link", "people at gmail.com"])
  })

  it("trusts listed personal addresses without trusting their whole domain", () => {
    const trusted = internalDomainSet("office@hps-colorado.com", ["martine.vogel@gmail.com"])
    expect(isSharedOutside([{ id: "1", type: "user", role: "writer", emailAddress: "Martine.Vogel@gmail.com" }], trusted)).toBe(false)
    expect(isSharedOutside([{ id: "2", type: "user", role: "reader", emailAddress: "stranger@gmail.com" }], trusted)).toBe(true)
    expect(parseFeatureSettings("paper-trail", '{"internalDomains":["martine.vogel@gmail.com","hps-colorado.com"]}').internalDomains).toEqual([
      "martine.vogel@gmail.com",
      "hps-colorado.com",
    ])
  })

  it("errs toward private when an address is unreadable", () => {
    expect(isSharedOutside([{ id: "1", type: "group", role: "reader" }], internal)).toBe(true)
  })
})

describe("record copy pass", () => {
  const grant = { recordType: "purchase_order" as const, recordId: "po-1", projectId: "proj-1" }
  const now = new Date("2026-10-10T20:00:00Z")

  it("opens the record it was issued for", async () => {
    const token = await signRecordCopyToken("secret-a", grant, now)
    expect(await checkRecordCopyToken(["secret-a"], token, now)).toEqual(grant)
  })

  it("accepts the rotated secondary secret", async () => {
    const token = await signRecordCopyToken("secret-b", grant, now)
    expect(await checkRecordCopyToken(["secret-a", "secret-b"], token, now)).toEqual(grant)
  })

  it("rejects other secrets, tampering, and expiry", async () => {
    const token = await signRecordCopyToken("secret-a", grant, now)
    expect(await checkRecordCopyToken(["other"], token, now)).toBeNull()
    const [payload, signature] = token.split(".")
    const forged = `${btoa(JSON.stringify({ t: "estimate", r: "est-9", p: "proj-1", e: 9_999_999_999 })).replace(/=+$/, "")}.${signature}`
    expect(await checkRecordCopyToken(["secret-a"], forged, now)).toBeNull()
    expect(await checkRecordCopyToken(["secret-a"], `${payload}.${signature}.extra`, now)).toBeNull()
    const later = new Date(now.getTime() + 6 * 60 * 1000)
    expect(await checkRecordCopyToken(["secret-a"], token, later)).toBeNull()
  })

  it("rejects empty and oversized passes", async () => {
    expect(await checkRecordCopyToken(["secret-a"], null, now)).toBeNull()
    expect(await checkRecordCopyToken(["secret-a"], "x".repeat(3000), now)).toBeNull()
  })
})

describe("drive file names", () => {
  it("removes characters Drive paths cannot carry", () => {
    expect(driveFileName("PO 1042 - Lumber / framing: phase 2")).toBe("PO 1042 - Lumber - framing- phase 2.pdf")
  })
})
