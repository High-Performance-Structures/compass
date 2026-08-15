import { describe, expect, it } from "vitest"

import { ownerFacingDailyLogNotes } from "@/lib/owner-updates/external-content"

describe("owner update external note content", () => {
  it("removes legacy YouTube bearer URLs", () => {
    expect(
      ownerFacingDailyLogNotes("Video: framing\nhttps://youtu.be/secret-token\nCoordinate delivery")
    ).toBe("Video: framing\nCoordinate delivery")
  })

  it("removes YouTube bearer URLs on subdomains", () => {
    expect(
      ownerFacingDailyLogNotes("Video: framing\nhttps://m.youtube.com/watch?v=secret-token")
    ).toBe("Video: framing")
  })

  it("removes Drive bearer URLs", () => {
    expect(
      ownerFacingDailyLogNotes(
        "Open the specification\nhttps://drive.google.com/file/d/secret-token/view\nThen confirm delivery"
      )
    ).toBe("Open the specification\nThen confirm delivery")
  })
})
