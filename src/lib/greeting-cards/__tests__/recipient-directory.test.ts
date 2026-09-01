import { describe, expect, it } from "vitest"

import {
  buildGreetingCardRecipientOption,
  parseUsMailingAddress,
  splitRecipientName,
} from "@/lib/greeting-cards/recipient-directory"

describe("greeting-card recipient directory", () => {
  it("separates a comma-delimited mailing address", () => {
    expect(
      parseUsMailingAddress(
        "100 Main Street, Suite 200, Woodland Park, CO 80866",
      ),
    ).toEqual({
      recipient: {
        address1: "100 Main Street",
        address2: "Suite 200",
        city: "Woodland Park",
        state: "CO",
        postalCode: "80866",
      },
      status: "complete",
    })
  })

  it("recognizes full state names and line breaks", () => {
    expect(
      parseUsMailingAddress("PO Box 1813\nWoodland Park, Colorado 80866"),
    ).toEqual({
      recipient: {
        address1: "PO Box 1813",
        address2: "",
        city: "Woodland Park",
        state: "CO",
        postalCode: "80866",
      },
      status: "complete",
    })
  })

  it("preserves an unrecognized saved address for manual cleanup", () => {
    expect(parseUsMailingAddress("Rural Route 4")).toEqual({
      recipient: {
        address1: "Rural Route 4",
        address2: "",
        city: "",
        state: "",
        postalCode: "",
      },
      status: "partial",
    })
  })

  it("splits conventional and directory-style person names", () => {
    expect(splitRecipientName("Maria Elena Garcia")).toEqual({
      firstName: "Maria Elena",
      lastName: "Garcia",
    })
    expect(splitRecipientName("Garcia, Maria Elena")).toEqual({
      firstName: "Maria Elena",
      lastName: "Garcia",
    })
  })

  it("fills a vendor contact from the company mailing address", () => {
    expect(
      buildGreetingCardRecipientOption({
        id: "contact-1",
        sourceType: "vendor_contact",
        displayName: "Alex Trade",
        companyName: "Trade Partner LLC",
        address: "100 Main Street, Denver, CO 80202",
        recipientType: "subcontractor",
        personName: true,
      }),
    ).toEqual({
      id: "vendor_contact:contact-1",
      sourceType: "vendor_contact",
      displayName: "Alex Trade",
      companyName: "Trade Partner LLC",
      recipientType: "subcontractor",
      recipient: {
        firstName: "Alex",
        lastName: "Trade",
        businessName: "Trade Partner LLC",
        address1: "100 Main Street",
        address2: "",
        city: "Denver",
        state: "CO",
        postalCode: "80202",
      },
      addressStatus: "complete",
    })
  })
})
