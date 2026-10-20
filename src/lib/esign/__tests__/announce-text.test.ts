import { describe, expect, it } from "vitest"

import { esignAnnouncementText } from "@/lib/esign/announce-text"

describe("esignAnnouncementText", () => {
  it("describes a signed change order and links to it", () => {
    expect(
      esignAnnouncementText({
        kind: "change_order",
        outcome: "signed",
        projectId: "p1",
        recordId: "est1",
        number: "CO-003",
        title: "Add covered patio",
        changeOrderId: "co1",
      })
    ).toEqual({
      eventType: "esign.signed",
      action: "change_order_signed",
      title: "Change order signed: CO-003",
      summary: "Change order CO-003 Add covered patio was signed by the client.",
      href: "/dashboard/projects/p1/change-orders/co1",
    })
  })

  it("describes a declined estimate", () => {
    const text = esignAnnouncementText({
      kind: "estimate",
      outcome: "declined",
      projectId: "p1",
      recordId: "est1",
      number: "H-430-EST-1",
      title: "H-430-EST-1",
      changeOrderId: null,
    })
    expect(text.action).toBe("estimate_signature_declined")
    expect(text.summary).toBe("The client declined to sign estimate H-430-EST-1.")
    expect(text.href).toBe("/dashboard/projects/p1/estimate?estimateId=est1")
  })
})
