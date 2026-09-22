export type ExecutedContractDocumentSource =
  | { readonly kind: "foxit"; readonly envelopeId: string }
  | { readonly kind: "google_drive"; readonly fileId: string }
  | { readonly kind: "external"; readonly url: string }

function decodedPathValue(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim()
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

export function executedContractDocumentSource(
  value: string | null
): ExecutedContractDocumentSource | null {
  const cleaned = value?.trim() ?? ""
  if (!cleaned) return null

  const foxitMatch = /^\/api\/integrations\/foxit\/envelopes\/([^/?#]+)\/document$/.exec(
    cleaned
  )
  if (foxitMatch?.[1]) {
    const envelopeId = decodedPathValue(foxitMatch[1])
    return envelopeId ? { kind: "foxit", envelopeId } : null
  }

  let url: URL
  try {
    url = new URL(cleaned)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username || url.password) return null

  if (url.hostname === "drive.google.com") {
    const pathMatch = /^\/file\/d\/([^/]+)(?:\/|$)/.exec(url.pathname)
    const fileId = pathMatch?.[1] ?? url.searchParams.get("id")
    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) return null
    return { kind: "google_drive", fileId }
  }

  return { kind: "external", url: url.toString() }
}
