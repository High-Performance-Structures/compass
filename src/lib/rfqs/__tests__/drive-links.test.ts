import { describe, expect, it } from "vitest"

import { driveFileIdFromRfqLink } from "@/lib/rfqs/drive-links"

describe("RFQ Drive links", () => {
  it("accepts file, folder, and Docs links", () => {
    expect(driveFileIdFromRfqLink("https://drive.google.com/file/d/abcdefghijk/view?usp=sharing")).toBe("abcdefghijk")
    expect(driveFileIdFromRfqLink("https://drive.google.com/drive/folders/abcdefghijk")).toBe("abcdefghijk")
    expect(driveFileIdFromRfqLink("https://drive.google.com/open?id=abcdefghijk")).toBe("abcdefghijk")
    expect(driveFileIdFromRfqLink("https://docs.google.com/document/d/abcdefghijk/edit")).toBe("abcdefghijk")
  })

  it("rejects non-Drive and deceptive links", () => {
    expect(driveFileIdFromRfqLink("https://drive.google.com.evil.example/file/d/abcdefghijk/view")).toBeNull()
    expect(driveFileIdFromRfqLink("http://drive.google.com/file/d/abcdefghijk/view")).toBeNull()
    expect(driveFileIdFromRfqLink("https://example.com/plans.pdf")).toBeNull()
    expect(driveFileIdFromRfqLink("javascript:alert(1)")).toBeNull()
  })
})
