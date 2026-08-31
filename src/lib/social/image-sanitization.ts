const JPEG_MIME_TYPES = new Set(["image/jpeg", "image/jpg"])
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_RENDERING_CHUNKS = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "cHRM",
  "gAMA",
  "sBIT",
  "bKGD",
  "hIST",
  "tRNS",
  "pHYs",
  "sPLT",
  "sRGB",
  "acTL",
  "fcTL",
  "fdAT",
])
const WEBP_RENDERING_CHUNKS = new Set([
  "VP8 ",
  "VP8L",
  "VP8X",
  "ALPH",
  "ANIM",
  "ANMF",
])

export type SocialImageMimeType = "image/jpeg" | "image/png" | "image/webp"

export function normalizeSocialImageMimeType(value: string): SocialImageMimeType | null {
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase()
  if (mimeType && JPEG_MIME_TYPES.has(mimeType)) return "image/jpeg"
  if (mimeType === "image/png" || mimeType === "image/webp") return mimeType
  return null
}

export function isSupportedSocialImageMimeType(
  value: string | null,
): boolean {
  return value !== null && normalizeSocialImageMimeType(value) !== null
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const byteLength = parts.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(byteLength)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  )
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  ) >>> 0
}

function writeUint32LittleEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = ""
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index])
  }
  return value
}

function matches(bytes: Uint8Array, expected: Uint8Array, offset = 0): boolean {
  if (bytes.byteLength < offset + expected.byteLength) return false
  return expected.every((value, index) => bytes[offset + index] === value)
}

function jpegMarkerHasLength(marker: number): boolean {
  return marker !== 0x01 && marker !== 0xd8 && marker !== 0xd9 &&
    (marker < 0xd0 || marker > 0xd7)
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("The selected JPEG is invalid.")
  }

  const parts: Uint8Array[] = [bytes.slice(0, 2)]
  let cursor = 2
  let inScan = false

  while (cursor < bytes.byteLength) {
    if (inScan) {
      const scanStart = cursor
      while (cursor + 1 < bytes.byteLength) {
        if (bytes[cursor] !== 0xff) {
          cursor += 1
          continue
        }
        const following = bytes[cursor + 1]
        if (following === 0x00 || following === 0xff ||
          (following >= 0xd0 && following <= 0xd7)) {
          cursor += 2
          continue
        }
        break
      }
      parts.push(bytes.slice(scanStart, cursor))
      inScan = false
      continue
    }

    if (cursor + 1 >= bytes.byteLength || bytes[cursor] !== 0xff) {
      throw new Error("The selected JPEG has an invalid segment.")
    }
    const markerStart = cursor
    while (cursor < bytes.byteLength && bytes[cursor] === 0xff) cursor += 1
    if (cursor >= bytes.byteLength) throw new Error("The selected JPEG is truncated.")
    const marker = bytes[cursor]
    cursor += 1

    if (marker === 0xd9) {
      parts.push(bytes.slice(markerStart, cursor))
      return concatBytes(parts)
    }
    if (!jpegMarkerHasLength(marker)) {
      parts.push(bytes.slice(markerStart, cursor))
      continue
    }
    if (cursor + 1 >= bytes.byteLength) throw new Error("The selected JPEG is truncated.")
    const segmentLength = bytes[cursor] * 0x100 + bytes[cursor + 1]
    if (segmentLength < 2 || cursor + segmentLength > bytes.byteLength) {
      throw new Error("The selected JPEG has an invalid segment length.")
    }
    const segmentEnd = cursor + segmentLength
    const isMetadata = (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe
    if (!isMetadata) parts.push(bytes.slice(markerStart, segmentEnd))
    cursor = segmentEnd
    if (marker === 0xda) inScan = true
  }

  throw new Error("The selected JPEG does not contain an end marker.")
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (!matches(bytes, PNG_SIGNATURE)) throw new Error("The selected PNG is invalid.")
  const parts: Uint8Array[] = [bytes.slice(0, PNG_SIGNATURE.byteLength)]
  let cursor = PNG_SIGNATURE.byteLength
  let foundEnd = false

  while (cursor + 12 <= bytes.byteLength) {
    const chunkLength = readUint32BigEndian(bytes, cursor)
    const chunkEnd = cursor + 12 + chunkLength
    if (chunkEnd > bytes.byteLength) throw new Error("The selected PNG is truncated.")
    const chunkType = ascii(bytes, cursor + 4, 4)
    if (PNG_RENDERING_CHUNKS.has(chunkType)) parts.push(bytes.slice(cursor, chunkEnd))
    cursor = chunkEnd
    if (chunkType === "IEND") {
      foundEnd = true
      break
    }
  }

  if (!foundEnd) throw new Error("The selected PNG does not contain an end chunk.")
  return concatBytes(parts)
}

function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  if (
    bytes.byteLength < 12 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  ) {
    throw new Error("The selected WebP image is invalid.")
  }
  const declaredEnd = readUint32LittleEndian(bytes, 4) + 8
  if (declaredEnd > bytes.byteLength) throw new Error("The selected WebP image is truncated.")

  const chunks: Uint8Array[] = []
  let cursor = 12
  while (cursor + 8 <= declaredEnd) {
    const chunkType = ascii(bytes, cursor, 4)
    const chunkLength = readUint32LittleEndian(bytes, cursor + 4)
    const paddedLength = chunkLength + (chunkLength % 2)
    const chunkEnd = cursor + 8 + paddedLength
    if (chunkEnd > declaredEnd) throw new Error("The selected WebP image has an invalid chunk.")
    if (WEBP_RENDERING_CHUNKS.has(chunkType)) {
      const chunk = bytes.slice(cursor, chunkEnd)
      if (chunkType === "VP8X" && chunkLength >= 1) {
        // Clear ICC, EXIF, and XMP presence flags after removing those chunks.
        chunk[8] &= ~0x2c
      }
      chunks.push(chunk)
    }
    cursor = chunkEnd
  }

  if (chunks.length === 0) throw new Error("The selected WebP image has no image data.")
  const body = concatBytes(chunks)
  const header = new Uint8Array(12)
  header.set(new TextEncoder().encode("RIFF"), 0)
  writeUint32LittleEndian(header, 4, body.byteLength + 4)
  header.set(new TextEncoder().encode("WEBP"), 8)
  return concatBytes([header, body])
}

export function sanitizeSocialImage(bytes: Uint8Array, mimeType: string): Uint8Array {
  const normalized = normalizeSocialImageMimeType(mimeType)
  if (!normalized) {
    throw new Error("Social publishing supports JPEG, PNG, and WebP photos only.")
  }
  if (normalized === "image/jpeg") return stripJpegMetadata(bytes)
  if (normalized === "image/png") return stripPngMetadata(bytes)
  return stripWebpMetadata(bytes)
}
