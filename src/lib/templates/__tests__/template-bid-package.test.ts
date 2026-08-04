import { describe, expect, it } from "vitest"

import { normalizeTemplateBidPackage } from "@/lib/templates/template-bid-package"

describe("template bid package normalization", () => {
  it("turns Buildertrend bid content into an editable Compass RFQ draft", () => {
    const result = normalizeTemplateBidPackage({
      title: "Drywall - (Project Address) (Estimate Phase)",
      description:
        "Background\nA (Project Type) at (Project Address)\nReference Documents\nSee Buildertrend Bid Set\nSubmission of Bid\nSubmit through Buildertrend\nScope of Work\nProvide drywall.",
      payloadJson: JSON.stringify({
        descriptionSections: [
          "Background",
          "A (Project Type) at (Project Address)",
          "Reference Documents",
          "See Buildertrend Bid Set",
          "Submission of Bid",
          "Submit through Buildertrend",
          "Scope of Work",
          "Provide drywall.",
        ],
        lineItems: [
          {
            title: "Drywall Installation Labor & Materials",
            costCode: "09 29 00 - Gypsum Wallboard",
            costType: "Labor",
            quantity: 1,
          },
        ],
        attachments: [],
      }),
    })

    expect(result.overallScope).toContain("SUBMISSION OF BID")
    expect(result.overallScope).toContain("through this Compass RFQ")
    expect(result.overallScope).not.toContain("Buildertrend")
    expect(result.vendorCategory).toBe("Drywall / Gypsum")
    expect(result.scopeItems).toEqual([
      {
        lineNumber: 1,
        description: "Drywall Installation Labor & Materials",
        phaseCode: null,
        costCode: "09 29 00",
        notes: "Cost type: Labor | Template quantity: 1",
      },
    ])
    expect(result.templateReview).toEqual({
      unresolvedPlaceholders: [
        "(Project Address)",
        "(Estimate Phase)",
        "(Project Type)",
      ],
      requiresDocumentPackage: true,
    })
  })

  it("uses captured document URLs and clears the document-package warning", () => {
    const result = normalizeTemplateBidPackage({
      title: "Roofing",
      description: "Reference Documents\nSee attached plan set.",
      payloadJson: JSON.stringify({
        lineItems: [
          {
            title: "Roofing labor and materials",
            costCode: "07 31 13 - Asphalt Shingles",
          },
        ],
        attachments: [
          {
            fileName: "Bid Set.pdf",
            url: "https://drive.google.com/example",
          },
        ],
      }),
    })

    expect(result.documentLinks).toEqual([
      {
        lineNumber: 1,
        label: "Bid Set.pdf",
        url: "https://drive.google.com/example",
        notes: null,
      },
    ])
    expect(result.templateReview).toBeNull()
  })
})
