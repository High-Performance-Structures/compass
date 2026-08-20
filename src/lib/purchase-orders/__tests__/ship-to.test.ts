import { describe, expect, it } from "vitest"

import {
  initialPurchaseOrderShipToState,
  purchaseOrderShipToValue,
} from "@/lib/purchase-orders/ship-to"

describe("initialPurchaseOrderShipToState", () => {
  it("defaults a new purchase order to an available jobsite", () => {
    expect(
      initialPurchaseOrderShipToState({
        storedShipTo: null,
        jobsiteAddress: "123 Main St, Denver, CO",
      })
    ).toEqual({ choice: "jobsite", otherAddress: "" })
  })

  it("defaults to pickup when no jobsite address is available", () => {
    expect(
      initialPurchaseOrderShipToState({
        storedShipTo: null,
        jobsiteAddress: null,
      })
    ).toEqual({ choice: "pickup", otherAddress: "" })
  })

  it("recognizes a saved jobsite address without case or punctuation sensitivity", () => {
    expect(
      initialPurchaseOrderShipToState({
        storedShipTo: "123 MAIN ST., DENVER CO",
        jobsiteAddress: "123 Main St, Denver CO",
      })
    ).toEqual({ choice: "jobsite", otherAddress: "" })
  })

  it("upgrades a legacy Jobsite label when the project has an address", () => {
    expect(
      initialPurchaseOrderShipToState({
        storedShipTo: "Job Site",
        jobsiteAddress: "123 Main St, Denver, CO",
      })
    ).toEqual({ choice: "jobsite", otherAddress: "" })
  })

  it("recognizes existing pickup spellings", () => {
    expect(
      initialPurchaseOrderShipToState({
        storedShipTo: "pick up",
        jobsiteAddress: "123 Main St",
      })
    ).toEqual({ choice: "pickup", otherAddress: "" })
  })

  it("preserves a custom saved address as Other", () => {
    expect(
      initialPurchaseOrderShipToState({
        storedShipTo: " 456 Supplier Ave, Colorado Springs, CO ",
        jobsiteAddress: "123 Main St, Denver, CO",
      })
    ).toEqual({
      choice: "other",
      otherAddress: "456 Supplier Ave, Colorado Springs, CO",
    })
  })
})

describe("purchaseOrderShipToValue", () => {
  it("resolves Jobsite to the current saved project address", () => {
    expect(
      purchaseOrderShipToValue({
        state: { choice: "jobsite", otherAddress: "" },
        jobsiteAddress: " 123 Main St, Denver, CO ",
      })
    ).toBe("123 Main St, Denver, CO")
  })

  it("stores a consistent Pick-Up value", () => {
    expect(
      purchaseOrderShipToValue({
        state: { choice: "pickup", otherAddress: "" },
        jobsiteAddress: "123 Main St",
      })
    ).toBe("Pick-Up")
  })

  it("trims an Other address and returns null for a blank value", () => {
    expect(
      purchaseOrderShipToValue({
        state: { choice: "other", otherAddress: " 456 Supplier Ave " },
        jobsiteAddress: null,
      })
    ).toBe("456 Supplier Ave")
    expect(
      purchaseOrderShipToValue({
        state: { choice: "other", otherAddress: "   " },
        jobsiteAddress: null,
      })
    ).toBeNull()
  })
})
