import { normalizeSageRecordId } from "@/lib/sage/record-id"

export type NumberOnlyClient = {
  readonly name: string
  readonly sageClientId: string | null
  readonly sageClientNumber: string | null
}

export type SageClientDirectoryRow = {
  readonly sageRecordId: string
  readonly sageClientNumber: string
  readonly name: string
}

function nameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
}

/**
 * The Sage id a number-only client should carry, or null. Both the Sage
 * number and the client name must agree with Sage's directory: a number
 * alone could be a typo, and a name alone is never proof of identity.
 */
export function directoryClientIdFor(
  client: NumberOnlyClient,
  entry: SageClientDirectoryRow | null | undefined
): string | null {
  const number = client.sageClientNumber?.trim()
  if (client.sageClientId?.trim() || !number || !entry) return null
  if (entry.sageClientNumber.trim() !== number || !entry.sageRecordId.trim()) return null
  const name = nameKey(client.name)
  if (!name || name !== nameKey(entry.name)) return null
  return normalizeSageRecordId(entry.sageRecordId.trim())
}
