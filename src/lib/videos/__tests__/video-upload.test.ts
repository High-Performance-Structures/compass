import { describe, expect, it } from "vitest"

import { youtubeChannelForDepartment } from "@/lib/videos/channel-routing"
import {
  isProjectVideoFile,
  projectVideoMimeType,
} from "@/lib/videos/upload-limits"

describe("project video channel routing", () => {
  it("routes each department to its company channel", () => {
    expect(youtubeChannelForDepartment("O")).toBe("orc")
    expect(youtubeChannelForDepartment("D")).toBe("orc")
    expect(youtubeChannelForDepartment("H")).toBe("hps")
    expect(youtubeChannelForDepartment("N")).toBe("nutech")
  })
})

describe("project video file validation", () => {
  it("accepts browser video MIME types", () => {
    expect(
      isProjectVideoFile({ fileName: "walkthrough.mov", mimeType: "video/quicktime" })
    ).toBe(true)
  })

  it("accepts known video extensions when a browser omits the MIME type", () => {
    expect(isProjectVideoFile({ fileName: "walkthrough.MP4", mimeType: "" })).toBe(
      true
    )
    expect(projectVideoMimeType({ fileName: "walkthrough.mov", mimeType: "" })).toBe(
      "video/quicktime"
    )
  })

  it("rejects non-video files", () => {
    expect(
      isProjectVideoFile({ fileName: "invoice.pdf", mimeType: "application/pdf" })
    ).toBe(false)
  })
})
