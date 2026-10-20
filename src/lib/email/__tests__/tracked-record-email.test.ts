import { describe, expect, it } from "vitest"

import {
  emailReplyPreview,
  isTrackedRecordKind,
  trackedRecordHref,
  trackedRecordReplyEventType,
  trackedRecordReplyTo,
} from "@/lib/email/tracked-record-email"

describe("trackedRecordReplyTo", () => {
  it("names the tracked address and adds the sender after it", () => {
    expect(
      trackedRecordReplyTo({
        replyToAddress: "Compass <jarvis+cmp-abc@hps-colorado.com>",
        displayName: 'Cassandra "C" - RFQ-004',
        alsoTo: ["Cassandra@HPS-Colorado.com"],
      })
    ).toBe('"Cassandra C - RFQ-004" <jarvis+cmp-abc@hps-colorado.com>, cassandra@hps-colorado.com')
  })

  it("skips blanks, repeats, invalid addresses, and the tracked address itself", () => {
    expect(
      trackedRecordReplyTo({
        replyToAddress: "Compass <jarvis+cmp-abc@hps-colorado.com>",
        displayName: "PO-12",
        alsoTo: [null, "", "not an email", "jarvis+cmp-abc@hps-colorado.com", "a@b.com", "A@B.com", "x@y.com, evil@z.com"],
      })
    ).toBe('"PO-12" <jarvis+cmp-abc@hps-colorado.com>, a@b.com')
  })
})

describe("emailReplyPreview", () => {
  it("stops at the quoted original", () => {
    expect(
      emailReplyPreview("Price holds through Friday.\nThanks,\nBob\n\nOn Mon, Oct 19, 2026 at 9:00 AM Compass wrote:\n> Please quote")
    ).toBe("Price holds through Friday. Thanks, Bob")
  })

  it("shortens long replies", () => {
    const preview = emailReplyPreview("word ".repeat(100), 40)
    expect(preview.length).toBeLessThanOrEqual(40)
    expect(preview.endsWith("…")).toBe(true)
  })
})

describe("tracked record routing", () => {
  it("links each kind to its record and uses the Settings prefixes", () => {
    expect(isTrackedRecordKind("rfq")).toBe(true)
    expect(isTrackedRecordKind("project_correspondence")).toBe(false)
    expect(trackedRecordHref({ kind: "purchase_order", projectId: "p 1", recordId: "po1" })).toBe(
      "/dashboard/projects/p%201/purchase-orders?item=po1#purchase-order-po1"
    )
    expect(trackedRecordHref({ kind: "rfi", projectId: "p1", recordId: "r1" })).toBe("/dashboard/projects/p1/rfis?item=r1#rfi-r1")
    expect(trackedRecordReplyEventType("rfi")).toBe("rfi.email_reply")
    expect(trackedRecordReplyEventType("purchase_order")).toBe("po.email_reply")
  })
})
