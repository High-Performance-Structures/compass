import { describe, expect, it } from "vitest"

import { sageClientProjectWritePayloadSchema, sageClientProjectWriteResultSchema } from "@/lib/sage/client-project-write"
import {
  defaultSageVendorType,
  sageClientAddPayload,
  sageDirectoryAddInputSchema,
  sageVendorAddPayload,
} from "@/lib/sage/directory-add-request"

const fields = {
  name: "Tim Kulin Cabinetry", addressLine1: "12 Main St", addressLine2: null, city: "Woodland Park",
  state: "co", postalCode: "80863", phone: "719-555-0100", email: "info@timkulincabinetry.com",
}

describe("Request add to Sage payloads", () => {
  it("sends a vendor add the writer accepts, with the 1099 box only when known yes", () => {
    const unknown = sageVendorAddPayload("vendor-1", fields, "Material Supplier", "unknown")
    expect(unknown.vendor.print1099).toBe(false)
    expect(unknown.vendor.state).toBe("CO")
    expect(sageVendorAddPayload("vendor-1", fields, "Material Supplier", "yes").vendor.print1099).toBe(true)
    expect(sageClientProjectWritePayloadSchema.safeParse(unknown).success).toBe(true)
  })

  it("sends a client add through the existing ensure_client write", () => {
    const payload = sageClientAddPayload("customer-1", fields, null, { expectedNumber: 1, name: "Current" })
    expect(payload.client.address).toBe("12 Main St, Woodland Park, co 80863")
    expect(sageClientProjectWritePayloadSchema.safeParse(payload).success).toBe(true)
  })

  it("requires a Sage vendor type for vendors", () => {
    expect(sageDirectoryAddInputSchema.safeParse({ kind: "vendor_company", entityId: "v", fields, vendorType: "", form1099: "unknown" }).success).toBe(false)
    expect(sageDirectoryAddInputSchema.safeParse({ kind: "vendor_company", entityId: "v", fields, vendorType: "Subcontractor", form1099: "unknown" }).success).toBe(true)
  })

  it("guesses the Sage vendor type from the company's mapping, then by name", () => {
    expect(defaultSageVendorType("Supplier", { "Material Supplier": "Supplier" }, ["Material Supplier", "Subcontractor"])).toBe("Material Supplier")
    expect(defaultSageVendorType("Subcontractor", {}, ["Material Supplier", "Subcontractor"])).toBe("Subcontractor")
    expect(defaultSageVendorType("Engineer", {}, ["Subcontractor"])).toBeNull()
  })
})

describe("client/job writer results", () => {
  const claim = { operationId: "op", claimToken: "8a0d4a59-5b3c-4f3a-9b3a-0d6e2f1a7c11", outcome: "succeeded" }

  it("accepts a vendor result and the existing client result", () => {
    const vendor = sageClientProjectWriteResultSchema.parse({ ...claim, vendor: { id: "abc", number: "3008", print1099Applied: true } })
    expect("vendor" in vendor).toBe(true)
    const client = sageClientProjectWriteResultSchema.parse({ ...claim, client: { id: "x", number: "5", statusNumber: 1 }, job: null })
    expect("client" in client).toBe(true)
  })
})
