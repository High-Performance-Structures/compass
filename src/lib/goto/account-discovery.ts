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
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  return (
    stringField(value, "key") ??
    stringField(value, "accountKey") ??
    stringField(value, "account_key") ??
    stringField(value, "accountId") ??
    stringField(value, "account_id") ??
    // GoTo's getgo:1.0 SCIM extension represents accounts as
    // { value: <account key>, display, entitlements } objects.
    stringField(value, "value") ??
    stringField(value, "id")
  )
}

function collectAccountKeys(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectAccountKeys(item))
  }
  if (!isRecord(value)) return []

  return Object.entries(value).flatMap(([key, field]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (normalizedKey === "accountkey") {
      const keyValue = accountKey(field)
      return keyValue ? [keyValue] : []
    }
    if (normalizedKey.includes("account") && Array.isArray(field)) {
      return field.flatMap((account) => {
        const keyValue = accountKey(account)
        return keyValue ? [keyValue] : []
      })
    }
    if (
      (normalizedKey.includes("account") || normalizedKey === "organization") &&
      isRecord(field)
    ) {
      const keyValue = accountKey(field)
      if (keyValue) return [keyValue]
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

function collectShapePaths(
  value: unknown,
  path: string,
  depth: number
): readonly string[] {
  if (depth > 5) return [`${path}:…`]
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${path}:array(empty)`]
    return collectShapePaths(value[0], `${path}[]`, depth + 1)
  }
  if (!isRecord(value)) return [`${path}:${typeof value}`]

  return Object.entries(value).flatMap(([key, field]) =>
    collectShapePaths(field, path ? `${path}.${key}` : key, depth + 1)
  )
}

/** Returns field paths and types only, never SCIM values or identifiers. */
export function describeScimIdentityShape(value: unknown): string {
  return [...collectShapePaths(value, "", 0)]
    .sort((left, right) => {
      const leftRelevant = /account|organization/i.test(left) ? 0 : 1
      const rightRelevant = /account|organization/i.test(right) ? 0 : 1
      return leftRelevant - rightRelevant
    })
    .slice(0, 80)
    .join(", ")
}
