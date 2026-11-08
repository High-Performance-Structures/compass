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
    expect(sageJobName("H-100-200", "H-100-200 Sample Rd - Example Builder")).toBe(
      "H-100-200-Sample Rd - Example Builder"
    )
    expect(sageJobName("H-100-200", "H-100-200")).toBe("H-100-200")
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
    expect(sageClientProjectWritePayloadSchema.safeParse({
      ...payload,
      client: { ...payload.client, sageClientId: "client-guid", sageClientNumber: "2890" },
    }).success).toBe(true)
    expect(sageClientProjectWritePayloadSchema.safeParse({
      ...payload,
      client: { ...payload.client, sageClientId: "client-guid" },
    }).success).toBe(false)
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

  it("requires an existing Sage identity for email-only updates", () => {
    const update = {
      operationType: "update_client_email",
      company: "High Performance Structures Inc",
      client: {
        compassCustomerId: "customer-1",
        sageClientId: "client-guid",
        sageClientNumber: "2901",
        email: "client@example.com",
      },
    }
    expect(sageClientProjectWritePayloadSchema.safeParse(update).success).toBe(
      true
    )
    expect(
      sageClientProjectWritePayloadSchema.safeParse({
        ...update,
        client: { ...update.client, sageClientId: "" },
      }).success
    ).toBe(false)
  })

  it("gives an existing Sage job its client without a Compass customer", () => {
    const write = {
      operationType: "set_job_client",
      company: "High Performance Structures Inc",
      client: {
        compassCustomerId: null,
        name: "Example Builders LLC",
        shortName: "Example Builders LLC",
        company: "Example Builders LLC",
        email: null,
        phone: null,
        address: null,
        billingAddress: null,
        notes: null,
        contactName: "Pat Example",
        status: { expectedNumber: 3, name: "Complete" },
      },
      job: { compassProjectId: null, sageJobId: "job-guid", sageJobNumber: "100", name: "N-100-00-Example Builders LLC" },
    }
    expect(sageClientProjectWritePayloadSchema.safeParse(write).success).toBe(true)
    expect(
      sageClientProjectWritePayloadSchema.safeParse({ ...write, job: { ...write.job, sageJobId: "" } }).success
    ).toBe(false)
    expect(
      sageClientProjectWritePayloadSchema.safeParse({ ...write, client: { ...write.client, sageClientNumber: "9999" } }).success
    ).toBe(false)
  })

  it("sets an existing job's tax district by Sage job and district number", () => {
    const write = {
      operationType: "set_job_tax_district",
      company: "High Performance Structures Inc",
      job: { compassProjectId: "project-1", sageJobId: "job-guid", sageJobNumber: "100" },
      taxDistrict: { number: 640001, name: "64-0001 Example Combined" },
    }
    expect(sageClientProjectWritePayloadSchema.safeParse(write).success).toBe(true)
    expect(
      sageClientProjectWritePayloadSchema.safeParse({ ...write, taxDistrict: { ...write.taxDistrict, number: 0 } }).success
    ).toBe(false)
    expect(
      sageClientProjectWritePayloadSchema.safeParse({ ...write, job: { ...write.job, sageJobId: "" } }).success
    ).toBe(false)
  })

  it("adds a contact line to a linked Sage client", () => {
    const write = {
      operationType: "add_client_contact",
      company: "High Performance Structures Inc",
      client: { compassCustomerId: null, sageClientId: "client-guid", sageClientNumber: "100" },
      contact: { name: "Pat Example", phone: "555-010-0100", email: null, mobile: null },
    }
    expect(sageClientProjectWritePayloadSchema.safeParse(write).success).toBe(true)
    expect(
      sageClientProjectWritePayloadSchema.safeParse({ ...write, contact: { ...write.contact, name: " " } }).success
    ).toBe(false)
    expect(
      sageClientProjectWritePayloadSchema.safeParse({ ...write, client: { ...write.client, sageClientId: "" } }).success
    ).toBe(false)
  })
})
