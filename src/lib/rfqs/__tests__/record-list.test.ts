import { describe, expect, it } from "vitest"

import { compareSortValues } from "@/components/ui/sortable-header"
import { defaultRecordStatusList } from "@/lib/domain/record-statuses/rules"
import {
  rfqMatchesSearch,
  rfqQuoteSortValue,
  rfqRecordHref,
  rfqRequestedFromSortValue,
  rfqRespondedAt,
  type RfqListRow,
} from "@/lib/rfqs/record-list"

const RFQ_STATUSES = defaultRecordStatusList("rfq")

const row: RfqListRow = {
  id: "rfq-1",
  rfqNumber: "O-58-RFQ-004",
  title: "Framing package",
  description: "Walls and roof trusses",
  status: "draft",
  priority: "normal",
  companyName: null,
  recipientEmail: "bids@acme.example",
  vendorCategory: "Framing",
  dueDate: "2026-11-20",
  response: { kind: "none" },
}

describe("RFQ record list", () => {
  it("sorts quotes by amount, then declines, then RFQs still waiting", () => {
    const quoted = rfqQuoteSortValue({ ...row, response: { kind: "quoted", amount: 1200, submittedAt: "2026-11-05T00:00:00Z" } })
    const declined = rfqQuoteSortValue({ ...row, response: { kind: "declined", submittedAt: "2026-11-05T00:00:00Z" } })
    const waiting = rfqQuoteSortValue(row)
    expect(compareSortValues(declined, quoted)).toBeLessThan(0)
    expect(waiting).toBeUndefined()
  })

  it("names who was asked: the company, else the email", () => {
    expect(rfqRequestedFromSortValue(row)).toBe("bids@acme.example")
    expect(rfqRequestedFromSortValue({ ...row, companyName: "Acme Framing" })).toBe("Acme Framing")
    expect(rfqRequestedFromSortValue({ ...row, recipientEmail: null })).toBeUndefined()
  })

  it("dates the response only once the vendor answers", () => {
    expect(rfqRespondedAt(row)).toBeNull()
    expect(rfqRespondedAt({ ...row, response: { kind: "declined", submittedAt: "2026-11-05T00:00:00Z" } })).toBe(
      "2026-11-05T00:00:00Z",
    )
  })

  it("searches number, title, description, vendor, trade and status label", () => {
    expect(rfqMatchesSearch(row, "rfq-004", RFQ_STATUSES)).toBe(true)
    expect(rfqMatchesSearch(row, "trusses", RFQ_STATUSES)).toBe(true)
    expect(rfqMatchesSearch(row, "acme", RFQ_STATUSES)).toBe(true)
    expect(rfqMatchesSearch(row, "framing", RFQ_STATUSES)).toBe(true)
    expect(rfqMatchesSearch(row, "plumbing", RFQ_STATUSES)).toBe(false)
  })

  it("links a row to its record on the job's RFQ page, keeping the filter", () => {
    expect(rfqRecordHref("p 1", "rfq-1", "open")).toBe(
      "/dashboard/projects/p%201/rfqs?status=open&item=rfq-1#rfq-rfq-1",
    )
  })
})
