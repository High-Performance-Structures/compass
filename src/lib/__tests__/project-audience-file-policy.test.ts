import { describe, expect, it } from "vitest"

import {
  EXTERNAL_PROJECT_FILE_ACCEPT,
  MAX_EXTERNAL_PROJECT_FILES_PER_UPLOAD,
  MAX_EXTERNAL_PROJECT_FILE_BYTES,
  MAX_EXTERNAL_PROJECT_FILE_ROLLING_BYTES,
  validateExternalProjectFileContents,
  validateExternalProjectFileUpload,
} from "@/lib/project-audience-file-policy"

describe("external project file upload policy", () => {
  it("publishes the agreed upload limits", () => {
    expect(MAX_EXTERNAL_PROJECT_FILES_PER_UPLOAD).toBe(10)
    expect(MAX_EXTERNAL_PROJECT_FILE_BYTES).toBe(25 * 1024 * 1024)
    expect(MAX_EXTERNAL_PROJECT_FILE_ROLLING_BYTES).toBe(100 * 1024 * 1024)
    expect(EXTERNAL_PROJECT_FILE_ACCEPT).toContain(".pdf")
  })

  it("accepts supported photos and PDFs", () => {
    expect(
      validateExternalProjectFileUpload({
        existingBytes: 0,
        files: [
          { name: "Kitchen idea.HEIC", size: 2_000_000, type: "image/heic" },
          { name: "range-spec.pdf", size: 3_000_000, type: "application/pdf" },
        ],
      })
    ).toEqual({ ok: true, uploadBytes: 5_000_000 })
  })

  it("rejects active or unsupported file types", () => {
    expect(
      validateExternalProjectFileUpload({
        existingBytes: 0,
        files: [{ name: "mood-board.svg", size: 4_000, type: "image/svg+xml" }],
      })
    ).toEqual({ ok: false, error: "Only photos and PDF documents can be uploaded." })
  })

  it("rejects over-size files, over-size batches, and exhausted rolling quotas", () => {
    expect(
      validateExternalProjectFileUpload({
        existingBytes: 0,
        files: [
          {
            name: "large.pdf",
            size: MAX_EXTERNAL_PROJECT_FILE_BYTES + 1,
            type: "application/pdf",
          },
        ],
      })
    ).toEqual({ ok: false, error: "Each file must be 25 MB or smaller." })

    expect(
      validateExternalProjectFileUpload({
        existingBytes: 0,
        files: Array.from({ length: 11 }, (_, index) => ({
          name: `idea-${index}.jpg`,
          size: 1,
          type: "image/jpeg",
        })),
      })
    ).toEqual({ ok: false, error: "You can upload up to 10 files at a time." })

    expect(
      validateExternalProjectFileUpload({
        existingBytes: MAX_EXTERNAL_PROJECT_FILE_ROLLING_BYTES - 1,
        files: [{ name: "idea.jpg", size: 2, type: "image/jpeg" }],
      })
    ).toEqual({
      ok: false,
      error: "This upload would exceed your 100 MB project allowance for the last 30 days.",
    })
  })

  it("derives accepted MIME types from binary signatures instead of multipart metadata", () => {
    expect(
      validateExternalProjectFileContents([
        {
          name: "range-spec.pdf",
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
        },
        {
          name: "kitchen.jpg",
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
        },
        {
          name: "layout.png",
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        },
      ]),
    ).toEqual({ ok: true, mimeTypes: ["application/pdf", "image/jpeg", "image/png"] })
  })

  it("rejects spoofed, mismatched, and truncated upload contents", () => {
    expect(
      validateExternalProjectFileContents([
        { name: "malware.pdf", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]) },
      ]),
    ).toEqual({ ok: false, error: "Each upload must be a supported photo or PDF." })
    expect(
      validateExternalProjectFileContents([
        {
          name: "not-a-pdf.pdf",
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        },
      ]),
    ).toEqual({ ok: false, error: "Each upload must be a supported photo or PDF." })
    expect(
      validateExternalProjectFileContents([
        { name: "truncated.png", bytes: new Uint8Array([0x89, 0x50, 0x4e]) },
      ]),
    ).toEqual({ ok: false, error: "Each upload must be a supported photo or PDF." })
  })
})
