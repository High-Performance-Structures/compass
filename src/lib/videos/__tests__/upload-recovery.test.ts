import { describe, expect, it } from "vitest"

import { shouldAttemptBrowserUploadRecovery } from "@/lib/videos/upload-recovery"

describe("completed browser video upload recovery", () => {
  it("recovers when every byte reached Google Drive before the network error", () => {
    expect(
      shouldAttemptBrowserUploadRecovery({
        uploadedBytes: 1_024,
        fileSize: 1_024,
      })
    ).toBe(true)
  })

  it("recovers when the browser omits its final progress event", () => {
    expect(
      shouldAttemptBrowserUploadRecovery({
        uploadedBytes: 1_014,
        fileSize: 1_024,
      })
    ).toBe(true)
  })

  it("does not disguise a genuinely interrupted upload", () => {
    expect(
      shouldAttemptBrowserUploadRecovery({
        uploadedBytes: 1_000,
        fileSize: 1_024,
      })
    ).toBe(false)
  })
})
