import { describe, expect, it } from "vitest"

import {
  ECARD_TEMPLATES,
  getActiveEcardTemplate,
  getEcardTemplate,
} from "@/lib/greeting-cards/templates"

describe("e-card templates", () => {
  it("offers the 37 approved designs without the deferred cards", () => {
    expect(ECARD_TEMPLATES).toHaveLength(37)
    expect(ECARD_TEMPLATES.map((template) => template.code)).not.toContain("IN2")
    expect(ECARD_TEMPLATES.map((template) => template.code)).not.toContain("IO3")
  })

  it("provides a full image and a lightweight thumbnail for every choice", () => {
    for (const template of ECARD_TEMPLATES) {
      expect(template.imagePath).toBe(`/images/ecards/${template.id}.webp`)
      expect(template.thumbnailPath).toBe(
        `/images/ecards/thumbs/${template.id}.webp`,
      )
    }
  })

  it("continues resolving legacy designs used by existing requests", () => {
    expect(getEcardTemplate("appreciation")?.name).toBe("With Appreciation")
  })

  it("does not offer legacy designs for new requests", () => {
    expect(getActiveEcardTemplate("a")?.name).toBe("Thank You")
    expect(getActiveEcardTemplate("appreciation")).toBeNull()
  })
})
