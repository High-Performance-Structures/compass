import { describe, expect, it } from "vitest"

import {
  parseSageClientStatusId,
  parseSageJobTypeId,
  sageClientProjectWritePayloadSchema,
  sageClientProjectWriteResultSchema,
  sageClientStatusName,
  sageJobName,
  sageJobTypeName,
  sageShortName,
} from "@/lib/sage/client-project-write"

describe("Sage client/project write contract", () => {
  it("accepts only the six approved client status IDs", () => {
    expect(parseSageClientStatusId("1")).toBe(1)
    expect(parseSageClientStatusId(6)).toBe(6)
    expect(parseSageClientStatusId(0)).toBeNull()
    expect(parseSageClientStatusId(7)).toBeNull()
    expect(parseSageClientStatusId("Current")).toBeNull()
    expect(sageClientStatusName(2)).toBe("Warranty")
  })

  it("normalizes the two allowed job types", () => {
    expect(parseSageJobTypeId(" CUSTOMER ")).toBe("customer")
    expect(parseSageJobTypeId("internal")).toBe("internal")
    expect(parseSageJobTypeId("vendor")).toBeNull()
    expect(sageJobTypeName("internal")).toBe("Internal")
  })

  it("caps Sage short names at the database limit", () => {
    expect(sageShortName("  High   Performance Structures Incorporated "))
      .toBe("High Performance Structures In")
  })

  it("prefixes the Sage job name with the full Compass project number", () => {
    expect(sageJobName("H-434-595", "Luke Loeffler Earthwork")).toBe(
      "H-434-595-Luke Loeffler Earthwork"
    )
    expect(sageJobName(null, "  Internal   Operations  ")).toBe(
      "Internal Operations"
    )
    expect(sageJobName("O-123-456", "x".repeat(80))).toHaveLength(75)
  })

  it("validates the exact target company and required job selections", () => {
    const payload = {
      operationType: "ensure_client_and_job",
      company: "High Performance Structures Inc",
      client: {
        compassCustomerId: "customer-1",
        name: "Test Client",
        shortName: "Test Client",
        company: null,
        email: null,
        phone: null,
        address: null,
        billingAddress: null,
        notes: null,
        status: { expectedNumber: 1, name: "Current" },
      },
      job: {
        compassProjectId: "project-1",
        compassProjectNumber: "O-999-TEST",
        name: "Test Project",
        shortName: "Test Project",
        address: null,
        statusName: "Current",
        typeName: "Customer",
      },
    }
    expect(sageClientProjectWritePayloadSchema.safeParse(payload).success).toBe(true)
    expect(
      sageClientProjectWritePayloadSchema.safeParse({
        ...payload,
        company: "Another Company",
      }).success
    ).toBe(false)
  })

  it("requires the claim token and resolved Sage IDs in success receipts", () => {
    expect(
      sageClientProjectWriteResultSchema.safeParse({
        operationId: "operation-1",
        claimToken: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
        outcome: "succeeded",
        client: { id: "client-guid", number: "3001", statusNumber: 1 },
        job: {
          id: "job-guid",
          number: "801",
          statusNumber: 4,
          typeNumber: 1,
        },
      }).success
    ).toBe(true)
  })
})
