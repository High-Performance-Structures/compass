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
