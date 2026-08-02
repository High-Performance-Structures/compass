"use client"

import { getProjectEstimateAcceptanceUploadSessionUrl } from "@/app/actions/project-estimates"

const MAX_EXECUTED_ESTIMATE_BYTES = 50 * 1024 * 1024
const ALLOWED_EXECUTED_ESTIMATE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

export type UploadedEstimateAcceptanceEvidence = {
  readonly label: string
  readonly url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function recordString(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function validateEstimateAcceptanceEvidence(file: File): void {
  if (file.size <= 0) throw new Error("The selected evidence file is empty.")
  if (file.size > MAX_EXECUTED_ESTIMATE_BYTES) {
    throw new Error("Executed estimate evidence must be 50 MB or smaller.")
  }
  if (!ALLOWED_EXECUTED_ESTIMATE_TYPES.has(file.type)) {
    throw new Error(
      "Upload the executed estimate as a PDF, Word document, or image."
    )
  }
}

export async function uploadEstimateAcceptanceEvidence(
  file: File,
  projectId: string
): Promise<UploadedEstimateAcceptanceEvidence> {
  validateEstimateAcceptanceEvidence(file)
  const session = await getProjectEstimateAcceptanceUploadSessionUrl(
    projectId,
    file.name,
    file.type
  )
  if (!session.success) throw new Error(session.error)

  const response = await fetch(session.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  })
  if (!response.ok) throw new Error(`Upload failed for ${file.name}.`)

  const parsed = parseJson(await response.text())
  const record = isRecord(parsed) ? parsed : {}
  const storageId = recordString(record, "id")
  const storageUrl =
    recordString(record, "webViewLink") ??
    (storageId ? `https://drive.google.com/open?id=${storageId}` : null)
  if (!storageUrl) {
    throw new Error(`Google Drive did not return a link for ${file.name}.`)
  }
  return { label: file.name, url: storageUrl }
}
