const MEBIBYTE = 1024 * 1024

export const MAX_EXTERNAL_PROJECT_FILES_PER_UPLOAD = 10
export const MAX_EXTERNAL_PROJECT_FILE_BYTES = 25 * MEBIBYTE
export const MAX_EXTERNAL_PROJECT_FILE_ROLLING_BYTES = 100 * MEBIBYTE
export const EXTERNAL_PROJECT_FILE_ROLLING_DAYS = 30
export const EXTERNAL_PROJECT_FILE_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.webp,.avif,.heic,.heif,.pdf,image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,image/heif,application/pdf"

const ACCEPTED_FILE_TYPES = new Set([
  "application/pdf",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const ACCEPTED_FILE_EXTENSION = /\.(?:avif|gif|heic|heif|jpe?g|pdf|png|webp)$/i
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "heif",
])
const AVIF_BRANDS = new Set(["avif", "avis"])

export type ExternalProjectUploadCandidate = {
  readonly name: string
  readonly size: number
  readonly type: string
}

export type ExternalProjectUploadContentCandidate = {
  readonly name: string
  readonly bytes: Uint8Array
}

export type ExternalProjectFileUploadValidation =
  | { readonly ok: true; readonly uploadBytes: number }
  | { readonly ok: false; readonly error: string }

export type ExternalProjectFileContentValidation =
  | { readonly ok: true; readonly mimeTypes: readonly string[] }
  | { readonly ok: false; readonly error: string }

export function isExternalProjectUploadFile(
  file: ExternalProjectUploadCandidate
): boolean {
  return (
    ACCEPTED_FILE_TYPES.has(file.type.toLowerCase()) &&
    ACCEPTED_FILE_EXTENSION.test(file.name)
  )
}

export function validateExternalProjectFileUploadLimits(input: {
  readonly existingBytes: number
  readonly files: readonly Pick<ExternalProjectUploadCandidate, "size">[]
}): ExternalProjectFileUploadValidation {
  if (input.files.length === 0) {
    return { ok: false, error: "Choose at least one file to upload." }
  }
  if (input.files.length > MAX_EXTERNAL_PROJECT_FILES_PER_UPLOAD) {
    return {
      ok: false,
      error: "You can upload up to 10 files at a time.",
    }
  }
  if (
    input.files.some(
      (file) =>
        !Number.isSafeInteger(file.size) ||
        file.size <= 0 ||
        file.size > MAX_EXTERNAL_PROJECT_FILE_BYTES
    )
  ) {
    return { ok: false, error: "Each file must be 25 MB or smaller." }
  }

  const uploadBytes = input.files.reduce((total, file) => total + file.size, 0)
  if (
    !Number.isSafeInteger(input.existingBytes) ||
    input.existingBytes < 0 ||
    input.existingBytes + uploadBytes > MAX_EXTERNAL_PROJECT_FILE_ROLLING_BYTES
  ) {
    return {
      ok: false,
      error:
        "This upload would exceed your 100 MB project allowance for the last 30 days.",
    }
  }

  return { ok: true, uploadBytes }
}

export function validateExternalProjectFileUpload(input: {
  readonly existingBytes: number
  readonly files: readonly ExternalProjectUploadCandidate[]
}): ExternalProjectFileUploadValidation {
  const limits = validateExternalProjectFileUploadLimits(input)
  if (!limits.ok) return limits
  if (input.files.some((file) => !isExternalProjectUploadFile(file))) {
    return {
      ok: false,
      error: "Only photos and PDF documents can be uploaded.",
    }
  }
  return limits
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string | null {
  if (offset < 0 || length < 0 || offset + length > bytes.length) return null
  let value = ""
  for (let index = offset; index < offset + length; index += 1) {
    value += String.fromCharCode(bytes[index] ?? 0)
  }
  return value
}

function isoBaseMediaBrands(bytes: Uint8Array): readonly string[] {
  if (asciiAt(bytes, 4, 4) !== "ftyp" || bytes.length < 16) return []
  const boxSize =
    ((bytes[0] ?? 0) << 24) |
    ((bytes[1] ?? 0) << 16) |
    ((bytes[2] ?? 0) << 8) |
    (bytes[3] ?? 0)
  if (boxSize < 16) return []

  const end = Math.min(boxSize, bytes.length, 4096)
  const majorBrand = asciiAt(bytes, 8, 4)
  const compatibleBrands: string[] = []
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    const brand = asciiAt(bytes, offset, 4)
    if (brand) compatibleBrands.push(brand)
  }
  return majorBrand ? [majorBrand, ...compatibleBrands] : compatibleBrands
}

function detectedExternalProjectFileMime(bytes: Uint8Array): string | null {
  if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png"
  }
  if (asciiAt(bytes, 0, 6) === "GIF87a" || asciiAt(bytes, 0, 6) === "GIF89a") {
    return "image/gif"
  }
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") {
    return "image/webp"
  }

  const brands = isoBaseMediaBrands(bytes)
  if (brands.some((brand) => AVIF_BRANDS.has(brand))) return "image/avif"
  if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "image/heic"
  return null
}

function extensionMatchesMime(name: string, mimeType: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase()
  if (!extension) return false
  if (mimeType === "application/pdf") return extension === "pdf"
  if (mimeType === "image/avif") return extension === "avif"
  if (mimeType === "image/gif") return extension === "gif"
  if (mimeType === "image/jpeg") return extension === "jpg" || extension === "jpeg"
  if (mimeType === "image/png") return extension === "png"
  if (mimeType === "image/webp") return extension === "webp"
  if (mimeType === "image/heic") return extension === "heic" || extension === "heif"
  return false
}

export function validateExternalProjectFileContents(
  files: readonly ExternalProjectUploadContentCandidate[]
): ExternalProjectFileContentValidation {
  const mimeTypes: string[] = []
  for (const file of files) {
    const mimeType = detectedExternalProjectFileMime(file.bytes)
    if (!mimeType || !extensionMatchesMime(file.name, mimeType)) {
      return { ok: false, error: "Each upload must be a supported photo or PDF." }
    }
    mimeTypes.push(mimeType)
  }
  return { ok: true, mimeTypes }
}
