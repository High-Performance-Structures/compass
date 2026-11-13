/**
 * The result shape every server action returns (architecture standard,
 * section 4). Callers check `success` and TypeScript narrows to `data` or
 * `error`.
 */
export type ActionFailure = { readonly success: false; readonly error: string }

/** A completed action with nothing to return. */
export type ActionDone = { readonly success: true } | ActionFailure

/** A completed action that returns `data`. */
export type ActionResult<T> = { readonly success: true; readonly data: T } | ActionFailure

export function actionFailure(error: string): ActionFailure {
  return { success: false, error }
}

/** A thrown error's message, for the catch block of an action. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * A thrown error with its causes, for logs. Drizzle wraps a D1 failure as
 * "Failed query: <sql>" and keeps D1's own reason only on `cause`.
 */
export function errorWithCauses(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth++) {
    parts.push(current instanceof Error ? current.message : String(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join(" <- caused by: ")
}
