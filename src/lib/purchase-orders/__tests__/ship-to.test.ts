import { describe, expect, it } from "vitest"

import {
  initialPurchaseOrderShipToState,
  purchaseOrderShipToValue,
  resolvedPurchaseOrderShipTo,
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

describe("resolvedPurchaseOrderShipTo", () => {
  it("replaces a legacy Jobsite marker with the current project address", () => {
    expect(
      resolvedPurchaseOrderShipTo({
        storedShipTo: "Job Site",
        jobsiteAddress: "123 Main St, Denver, CO",
      })
    ).toBe("123 Main St, Denver, CO")
  })

  it("preserves pickup and custom delivery locations", () => {
    expect(
      resolvedPurchaseOrderShipTo({
        storedShipTo: "Pick-Up",
        jobsiteAddress: "123 Main St",
      })
    ).toBe("Pick-Up")
    expect(
      resolvedPurchaseOrderShipTo({
        storedShipTo: "456 Supplier Ave",
        jobsiteAddress: "123 Main St",
      })
    ).toBe("456 Supplier Ave")
  })

  it("keeps the Jobsite marker when no project address is available", () => {
    expect(
      resolvedPurchaseOrderShipTo({
        storedShipTo: "Jobsite",
        jobsiteAddress: null,
      })
    ).toBe("Jobsite")
  })
})
