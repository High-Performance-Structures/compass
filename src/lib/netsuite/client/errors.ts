export type ErrorCategory =
  | "rate_limited"
  | "auth_expired"
  | "auth_invalid"
  | "permission_denied"
  | "validation"
  | "not_found"
  | "server_error"
  | "timeout"
  | "network"
  | "unknown"

export class NetSuiteError extends Error {
  readonly category: ErrorCategory
  readonly statusCode: number | null
  readonly retryable: boolean
  readonly retryAfter: number | null
  readonly raw: unknown

  constructor(opts: {
    message: string
    category: ErrorCategory
    statusCode?: number | null
    retryAfter?: number | null
    raw?: unknown
  }) {
    super(opts.message)
    this.name = "NetSuiteError"
    this.category = opts.category
    this.statusCode = opts.statusCode ?? null
    this.retryAfter = opts.retryAfter ?? null
    this.raw = opts.raw ?? null
    this.retryable = isRetryable(opts.category)
  }
}

function isRetryable(category: ErrorCategory): boolean {
  switch (category) {
    case "rate_limited":
    case "timeout":
    case "server_error":
    case "network":
      return true
    case "auth_expired":
      // retryable after token refresh
      return true
    case "auth_invalid":
    case "permission_denied":
    case "validation":
    case "not_found":
    case "unknown":
      return false
  }
}

// netsuite returns misleading errors. a 401 might be a timeout,
// a "field doesn't exist" might be a permission issue, and a
// "Invalid Login Attempt" might be rate limiting on SOAP.
export function classifyError(
  status: number,
  body: unknown
): { category: ErrorCategory; message: string; retryAfter: number | null } {
  const bodyStr = typeof body === "string"
    ? body
    : JSON.stringify(body ?? "")

  if (status === 429) {
    const retryAfter = parseRetryAfter(body)
    return {
      category: "rate_limited",
      message: "Rate limited by NetSuite",
      retryAfter,
    }
  }

  if (status === 401) {
    // netsuite sometimes returns 401 for timeouts
    if (bodyStr.includes("timeout") || bodyStr.includes("ETIMEDOUT")) {
      return {
        category: "timeout",
        message: "Request timed out (disguised as 401)",
        retryAfter: null,
      }
    }
    if (bodyStr.includes("Invalid Login Attempt")) {
      return {
        category: "rate_limited",
        message: "Rate limited (disguised as auth error)",
        retryAfter: 5000,
      }
    }
    return {
      category: "auth_expired",
      message: "Authentication expired or invalid",
      retryAfter: null,
    }
  }

  if (status === 403) {
    // "field doesn't exist" often means permission denied
    if (bodyStr.includes("does not exist") || bodyStr.includes("not exist")) {
      return {
        category: "permission_denied",
        message: "Permission denied (disguised as missing field)",
        retryAfter: null,
      }
    }
    return {
      category: "permission_denied",
      message: "Access forbidden",
      retryAfter: null,
    }
  }

  if (status === 404) {
    return {
      category: "not_found",
      message: "Record not found",
      retryAfter: null,
    }
  }

  if (status === 400) {
    return {
      category: "validation",
      message: extractValidationMessage(body),
      retryAfter: null,
    }
  }

  if (status >= 500) {
    return {
      category: "server_error",
      message: `NetSuite server error (${status})`,
      retryAfter: null,
    }
  }

  return {
    category: "unknown",
    message: `Unexpected status ${status}: ${bodyStr.slice(0, 200)}`,
    retryAfter: null,
  }
}

function parseRetryAfter(body: unknown): number | null {
  if (typeof body === "object" && body !== null) {
    const obj = body as Record<string, unknown>
    if (typeof obj["Retry-After"] === "number") {
      return obj["Retry-After"] * 1000
    }
  }
  return 5000 // default 5s backoff
}

function extractValidationMessage(body: unknown): string {
  if (typeof body === "object" && body !== null) {
    const obj = body as Record<string, unknown>
    if (typeof obj.title === "string") return obj.title
    if (typeof obj["o:errorDetails"] === "object") {
      const details = obj["o:errorDetails"] as Array<{
        detail?: string
      }>
      if (details?.[0]?.detail) return details[0].detail
    }
    if (typeof obj.message === "string") return obj.message
  }
  return "Validation error"
}
