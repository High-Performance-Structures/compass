import { describe, expect, it } from "vitest"
import { placeWithoutOverlap, type SceneLabel } from "../portfolio-scene"

const label = (key: string, x: number, y: number, tone: SceneLabel["tone"]): SceneLabel => ({
  key, x, y, title: key.toUpperCase(), sub: "", tone,
})

describe("placeWithoutOverlap", () => {
  it("keeps the first label and drops overlapping later ones", () => {
    const placed = placeWithoutOverlap([
      label("granby residence", 400, 300, "selected"),
      label("denver", 420, 305, "landmark"),
      label("durango", 100, 500, "landmark"),
    ])
    expect(placed.map((item) => item.key)).toEqual(["granby residence", "durango"])
  })
})
