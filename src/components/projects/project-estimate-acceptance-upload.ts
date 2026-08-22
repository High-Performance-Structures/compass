"use client"

import { getProjectEstimateAcceptanceUploadSessionUrl } from "@/app/actions/project-estimates"
import { validateEstimateAcceptanceEvidence } from "@/lib/estimates/manual-acceptance"

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

export async function uploadEstimateAcceptanceEvidence(
  file: File,
  projectId: string
): Promise<UploadedEstimateAcceptanceEvidence> {
  validateEstimateAcceptanceEvidence(file)
  const mimeType = file.type || "application/octet-stream"
  const session = await getProjectEstimateAcceptanceUploadSessionUrl(
    projectId,
    file.name,
    mimeType
  )
  if (!session.success) throw new Error(session.error)

  const response = await fetch(session.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
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
