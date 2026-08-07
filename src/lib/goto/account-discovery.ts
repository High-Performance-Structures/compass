function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const field = value[key]
  if (typeof field === "string" && field.trim().length > 0) return field.trim()
  if (typeof field === "number" && Number.isFinite(field)) return String(field)
  return null
}

function accountKey(value: unknown): string | null {
  return (
    stringField(value, "key") ??
    stringField(value, "accountKey") ??
    stringField(value, "account_key")
  )
}

function collectAccountKeys(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectAccountKeys(item))
  }
  if (!isRecord(value)) return []

  return Object.entries(value).flatMap(([key, field]) => {
    if (key === "accounts" && Array.isArray(field)) {
      return field.flatMap((account) => {
        const keyValue = accountKey(account)
        return keyValue ? [keyValue] : []
      })
    }
    return Array.isArray(field) || isRecord(field)
      ? collectAccountKeys(field)
      : []
  })
}

/**
 * GoTo's modern token response omits account_key. Their scope-free SCIM /me
 * response exposes it inside an accounts array, sometimes within an extension.
 */
export function accountKeysFromScimIdentity(value: unknown): readonly string[] {
  return [...new Set(collectAccountKeys(value))]
}
