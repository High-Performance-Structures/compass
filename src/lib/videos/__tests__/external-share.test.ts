import { describe, expect, it } from "vitest"

import { projectVideoDailyLogShareUrl } from "@/lib/videos/external-share"

describe("project video external sharing", () => {
  it("uses Compass rather than a provider bearer URL in a Daily Log", () => {
    expect(
      projectVideoDailyLogShareUrl({
        projectId: "project / 1",
        videoId: "video / 1",
      })
    ).toBe(
      "https://compass.openrangeconstruction.ltd/api/projects/project%20%2F%201/videos/video%20%2F%201"
    )
  })
})
