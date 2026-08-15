import { describe, expect, it } from "vitest"

import {
  isExternalProjectRecipientRole,
  isExternalProjectResourceType,
} from "@/lib/project-external-resource-access"

describe("external project resource access policy", () => {
  it("only treats assigned owner, client, subcontractor, and supplier roles as external recipients", () => {
    expect(isExternalProjectRecipientRole("client")).toBe(true)
    expect(isExternalProjectRecipientRole("owner")).toBe(true)
    expect(isExternalProjectRecipientRole("subcontractor")).toBe(true)
    expect(isExternalProjectRecipientRole("supplier")).toBe(true)
    expect(isExternalProjectRecipientRole("office")).toBe(false)
    expect(isExternalProjectRecipientRole("admin")).toBe(false)
    expect(isExternalProjectRecipientRole(null)).toBe(false)
  })

  it("allows grants only for the explicitly governed resource types", () => {
    expect(isExternalProjectResourceType("audience_file")).toBe(true)
    expect(isExternalProjectResourceType("photo")).toBe(true)
    expect(isExternalProjectResourceType("video")).toBe(true)
    expect(isExternalProjectResourceType("drive_url")).toBe(false)
    expect(isExternalProjectResourceType("public")).toBe(false)
  })
})
