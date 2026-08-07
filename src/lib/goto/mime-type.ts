const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  avif: "image/avif",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

function specificMimeType(value: string | null): string | null {
  if (!value) return null
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  if (normalized === "*/*" || normalized === "application/octet-stream") {
    return null
  }
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
    ? normalized
    : null
}

function bytesMatch(
  data: Uint8Array,
  offset: number,
  signature: readonly number[]
): boolean {
  return signature.every((byte, index) => data[offset + index] === byte)
}

function imageMimeTypeFromBytes(data: Uint8Array): string | null {
  if (bytesMatch(data, 0, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (bytesMatch(data, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png"
  }
  if (
    bytesMatch(data, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    bytesMatch(data, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif"
  }
  if (
    bytesMatch(data, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesMatch(data, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp"
  }
  if (bytesMatch(data, 4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(...data.slice(8, 12)).toLowerCase()
    if (brand === "avif" || brand === "avis") return "image/avif"
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic"
    if (["heif", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return "image/heif"
    }
  }
  return null
}

function mimeTypeFromName(name: string): string | null {
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return extension ? MIME_BY_EXTENSION[extension] ?? null : null
}

/** Converts GoTo's generic `image` label into a Drive-safe MIME type. */
export function gotoAttachmentMimeType(input: {
  readonly declaredType: string
  readonly responseType: string | null
  readonly fileName: string
  readonly data: Uint8Array
}): string {
  return (
    specificMimeType(input.responseType) ??
    specificMimeType(input.declaredType) ??
    imageMimeTypeFromBytes(input.data) ??
    mimeTypeFromName(input.fileName) ??
    (input.declaredType.trim().toLowerCase() === "image"
      ? "image/jpeg"
      : "application/octet-stream")
  )
}
