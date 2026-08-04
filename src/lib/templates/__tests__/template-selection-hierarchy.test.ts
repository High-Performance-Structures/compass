import { describe, expect, it } from "vitest"

import { buildTemplateSelectionHierarchy } from "../template-selection-hierarchy"

function payload(choices: readonly string[]): string {
  return JSON.stringify({ choices: choices.map((title) => ({ title })) })
}

describe("buildTemplateSelectionHierarchy", () => {
  it("reconstructs roofing material, profile, gauge, and color dependencies", () => {
    const result = buildTemplateSelectionHierarchy([
      { id: "colors", title: "Metal Sales Image II 24 Gauge Colors", payloadJson: payload(["Black"]), sortOrder: 1 },
      { id: "gauge", title: "Metal Sales Image II Metal Gauge", payloadJson: payload(["24 Gauge", "26 Gauge"]), sortOrder: 2 },
      { id: "storm-color", title: "Shingle Color", payloadJson: payload(["Onyx Black"]), sortOrder: 3 },
      { id: "duration-color", title: "Shingle Colors", payloadJson: payload(["Peppercorn"]), sortOrder: 4 },
      { id: "impact", title: "Impact Rating", payloadJson: payload(["Owens Corning Duration", "Owens Corning Duration Storm"]), sortOrder: 5 },
      { id: "profile", title: "Roof Panel Profile", payloadJson: payload(["Metal Sales Image II (Concealed Fastened)"]), sortOrder: 6 },
      { id: "material", title: "Roof Material", payloadJson: payload(["Asphalt Shingles", "Metal Roofing"]), sortOrder: 7 },
    ])

    expect(result.find((item) => item.itemId === "profile")).toMatchObject({
      parentItemId: "material",
      parentChoiceValue: "Metal Roofing",
      level: 1,
    })
    expect(result.find((item) => item.itemId === "gauge")).toMatchObject({
      parentItemId: "profile",
      parentChoiceValue: "Metal Sales Image II (Concealed Fastened)",
      level: 2,
    })
    expect(result.find((item) => item.itemId === "colors")).toMatchObject({
      parentItemId: "gauge",
      parentChoiceValue: "24 Gauge",
      level: 3,
    })
    expect(result.find((item) => item.itemId === "duration-color")).toMatchObject({
      parentItemId: "impact",
      parentChoiceValue: "Owens Corning Duration",
      level: 2,
    })
    expect(result.find((item) => item.itemId === "storm-color")).toMatchObject({
      parentItemId: "impact",
      parentChoiceValue: "Owens Corning Duration Storm",
      level: 2,
    })
  })

  it("leaves unrelated finish selections as roots", () => {
    const result = buildTemplateSelectionHierarchy([
      { id: "paint", title: "Interior Paint", payloadJson: payload(["White"]), sortOrder: 1 },
    ])

    expect(result[0]).toEqual({
      itemId: "paint",
      choiceOptions: ["White"],
      parentItemId: null,
      parentChoiceValue: null,
      level: 0,
    })
  })
})
