import { describe, expect, it } from "vitest"
import { boundedAttachmentBytes } from "../attachment-limits"

describe("bounded attachment downloads", () => {
  it("preserves exact bytes including empty attachments", async () => {
    expect(await boundedAttachmentBytes(new Response(new Uint8Array([0, 255, 5])), 3)).toEqual(new Uint8Array([0, 255, 5]))
    expect(await boundedAttachmentBytes(new Response(new Uint8Array()), 0)).toEqual(new Uint8Array())
  })
  it("rejects oversized content even without trustworthy size metadata", async () => {
    await expect(boundedAttachmentBytes(new Response(new Uint8Array(4)), 3)).rejects.toThrow("size limit")
    await expect(boundedAttachmentBytes(new Response("Not found", { status: 404 }), 100)).rejects.toThrow("could not be downloaded")
  })
})
