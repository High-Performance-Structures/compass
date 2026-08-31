import { describe, expect, it } from "vitest"

import {
  isSupportedSocialImageMimeType,
  sanitizeSocialImage,
} from "@/lib/social/image-sanitization"

function pngChunk(type: string, data: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(12 + data.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length)
  bytes.set(new TextEncoder().encode(type), 4)
  bytes.set(data, 8)
  return bytes
}

function webpChunk(type: string, data: readonly number[]): Uint8Array {
  const paddedLength = data.length + (data.length % 2)
  const bytes = new Uint8Array(8 + paddedLength)
  bytes.set(new TextEncoder().encode(type), 0)
  new DataView(bytes.buffer).setUint32(4, data.length, true)
  bytes.set(data, 8)
  return bytes
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function ascii(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
}

describe("social image sanitization", () => {
  it("removes JPEG EXIF and comments while preserving image segments", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0xff, 0xfe, 0x00, 0x05, 0x47, 0x50, 0x53,
      0xff, 0xe0, 0x00, 0x04, 0x01, 0x02,
      0xff, 0xda, 0x00, 0x02,
      0x11, 0xff, 0x00, 0x22,
      0xff, 0xd9,
    ])

    const sanitized = sanitizeSocialImage(jpeg, "image/jpeg")

    expect(ascii(sanitized)).not.toContain("Exif")
    expect(ascii(sanitized)).not.toContain("GPS")
    expect(sanitized).toEqual(new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x01, 0x02,
      0xff, 0xda, 0x00, 0x02,
      0x11, 0xff, 0x00, 0x22,
      0xff, 0xd9,
    ]))
  })

  it("removes PNG textual and EXIF chunks", () => {
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const png = join([
      signature,
      pngChunk("IHDR", new Array(13).fill(0)),
      pngChunk("eXIf", [1, 2, 3]),
      pngChunk("tEXt", Array.from(new TextEncoder().encode("GPS=secret"))),
      pngChunk("IDAT", [4, 5]),
      pngChunk("IEND", []),
    ])

    const sanitized = sanitizeSocialImage(png, "image/png")
    const text = ascii(sanitized)

    expect(text).toContain("IHDR")
    expect(text).toContain("IDAT")
    expect(text).not.toContain("eXIf")
    expect(text).not.toContain("tEXt")
    expect(text).not.toContain("secret")
  })

  it("removes WebP metadata chunks and clears metadata flags", () => {
    const body = join([
      webpChunk("VP8X", [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      webpChunk("EXIF", Array.from(new TextEncoder().encode("GPS"))),
      webpChunk("XMP ", Array.from(new TextEncoder().encode("location"))),
      webpChunk("VP8 ", [1, 2]),
    ])
    const header = new Uint8Array(12)
    header.set(new TextEncoder().encode("RIFF"), 0)
    new DataView(header.buffer).setUint32(4, body.byteLength + 4, true)
    header.set(new TextEncoder().encode("WEBP"), 8)

    const sanitized = sanitizeSocialImage(join([header, body]), "image/webp")
    const text = ascii(sanitized)

    expect(text).not.toContain("EXIF")
    expect(text).not.toContain("XMP ")
    expect(text).not.toContain("location")
    expect(sanitized[20]).toBe(0)
  })

  it("rejects image formats whose metadata cannot be safely removed", () => {
    expect(isSupportedSocialImageMimeType("image/gif")).toBe(false)
    expect(() => sanitizeSocialImage(new Uint8Array([1]), "image/gif")).toThrow(
      "JPEG, PNG, and WebP",
    )
  })
})
