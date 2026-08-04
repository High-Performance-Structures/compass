import { describe, expect, it } from "vitest"

import {
  resolveTemplateDetailId,
  templateDetailHref,
} from "@/lib/templates/template-detail-route"

describe("template detail routing", () => {
  it("keeps punctuation-heavy template IDs out of the path segment", () => {
    expect(
      templateDetailHref("bt-template:drywall-installation:ec8558d35e")
    ).toBe(
      "/dashboard/templates/open?templateId=bt-template%3Adrywall-installation%3Aec8558d35e"
    )
  })

  it("resolves the query-backed template alias", () => {
    expect(
      resolveTemplateDetailId(
        "open",
        "bt-template:drywall-installation:ec8558d35e"
      )
    ).toBe("bt-template:drywall-installation:ec8558d35e")
  })

  it("preserves existing UUID detail routes", () => {
    expect(resolveTemplateDetailId("template-uuid", undefined)).toBe(
      "template-uuid"
    )
  })

  it("rejects missing or ambiguous alias query values", () => {
    expect(resolveTemplateDetailId("open", undefined)).toBeNull()
    expect(resolveTemplateDetailId("open", ["one", "two"])).toBeNull()
    expect(resolveTemplateDetailId("open", "   ")).toBeNull()
  })
})
