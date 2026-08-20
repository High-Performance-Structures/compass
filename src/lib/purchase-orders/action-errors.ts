const MISSING_SERVER_ACTION_PATTERNS = [
  /server action .+ was not found on the server/i,
  /failed to find server action/i,
] as const

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return null
}

export function isStaleServerActionError(error: unknown): boolean {
  const message = errorMessage(error)
  if (message === null) return false

  return MISSING_SERVER_ACTION_PATTERNS.some((pattern) => pattern.test(message))
}

export function purchaseOrderSubmissionErrorMessage(
  error: unknown,
  action: "create" | "update"
): string {
  if (isStaleServerActionError(error)) {
    return "Compass was updated while this form was open. Your entries are still visible; copy anything you need, then refresh Compass and submit again."
  }

  const message = errorMessage(error)
  if (message !== null) return message

  return action === "create"
    ? "Could not stage the P.O. request."
    : "Could not update the purchase order draft."
}
