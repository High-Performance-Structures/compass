"use client"

import {
  getProjectChangeOrderUploadSessionUrl,
  type ChangeOrderDocumentInput,
} from "@/app/actions/project-change-orders"

const MAX_CHANGE_ORDER_DOCUMENTS = 20

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

export function validateChangeOrderDocumentCount(
  existingCount: number,
  files: readonly File[]
): void {
  if (existingCount + files.length > MAX_CHANGE_ORDER_DOCUMENTS) {
    throw new Error(
      `A change order can have at most ${MAX_CHANGE_ORDER_DOCUMENTS} supporting documents.`
    )
  }
}

export async function uploadChangeOrderDocuments(
  files: readonly File[],
  projectId: string
): Promise<readonly ChangeOrderDocumentInput[]> {
  validateChangeOrderDocumentCount(0, files)
  const uploaded: ChangeOrderDocumentInput[] = []

  for (const file of files) {
    const mimeType = file.type || "application/octet-stream"
    const session = await getProjectChangeOrderUploadSessionUrl(
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
    if (!response.ok) throw new Error(`Upload failed for ${file.name}`)

    const parsed = parseJson(await response.text())
    const record = isRecord(parsed) ? parsed : {}
    const storageId = recordString(record, "id")
    const storageUrl =
      recordString(record, "webViewLink") ??
      (storageId ? `https://drive.google.com/open?id=${storageId}` : null)
    if (!storageUrl) {
      throw new Error(`Google Drive did not return a link for ${file.name}`)
    }

    uploaded.push({ label: file.name, url: storageUrl, notes: null })
  }

  return uploaded
}
