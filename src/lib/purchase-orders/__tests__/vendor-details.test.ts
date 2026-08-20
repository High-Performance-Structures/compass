import { describe, expect, it } from "vitest"

import { purchaseOrderVendorDetails } from "@/lib/purchase-orders/vendor-details"

const order = {
  companyName: "Acme Supply",
  sageVendorId: "V-100",
  sageVendorName: "Acme Supply",
}

describe("purchase order vendor details", () => {
  it("uses the project contact address and email when the company matches", () => {
    expect(
      purchaseOrderVendorDetails({
        order,
        contacts: [
          {
            address: "100 Vendor Way\nWoodland Park, CO 80863",
            companyName: "Acme Supply",
            displayName: "Alex Buyer",
            email: "orders@acme.test",
          },
        ],
        vendors: [],
      })
    ).toEqual({
      address: "100 Vendor Way\nWoodland Park, CO 80863",
      email: "orders@acme.test",
    })
  })

  it("falls back independently to vendor-directory values", () => {
    expect(
      purchaseOrderVendorDetails({
        order,
        contacts: [
          {
            address: null,
            companyName: "Acme Supply",
            displayName: "Alex Buyer",
            email: "buyer@acme.test",
          },
        ],
        vendors: [
          {
            address: "200 Directory Rd\nDivide, CO 80814",
            email: "directory@acme.test",
            name: "Different Display Name",
            netsuiteId: null,
            sourceRecordId: "V-100",
            sourceRecordNumber: null,
          },
        ],
      })
    ).toEqual({
      address: "200 Directory Rd\nDivide, CO 80814",
      email: "buyer@acme.test",
    })
  })

  it("returns null details when no vendor identity matches", () => {
    expect(
      purchaseOrderVendorDetails({
        order,
        contacts: [],
        vendors: [
          {
            address: "Unrelated address",
            email: "other@example.test",
            name: "Other Vendor",
            netsuiteId: "V-999",
            sourceRecordId: null,
            sourceRecordNumber: null,
          },
        ],
      })
    ).toEqual({ address: null, email: null })
  })
})
