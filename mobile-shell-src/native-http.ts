type NativeHttpResponse = {
  readonly status: number
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

type WebHttpResponse = {
  readonly status: number
  readonly url: string
  readonly type: string
  readonly headers: {
    readonly get: (name: string) => string | null
  }
}

function responseHeader(
  headers: Readonly<Record<string, string>>,
  requestedName: string
): string | null {
  const normalizedName = requestedName.toLocaleLowerCase()
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLocaleLowerCase() === normalizedName) return value
  }
  return null
}

function isLoginUrl(value: string | null): boolean {
  if (!value) return false
  try {
    return new URL(value, "https://compass.invalid").pathname === "/login"
  } catch {
    return false
  }
}

export function nativeResponseRequiresAuthentication(
  response: NativeHttpResponse
): boolean {
  if (response.status === 401) return true
  if (isLoginUrl(response.url)) return true

  return response.status >= 300 &&
    response.status < 400 &&
    isLoginUrl(responseHeader(response.headers, "location"))
}

export function webResponseRequiresAuthentication(
  response: WebHttpResponse
): boolean {
  if (response.status === 401 || response.type === "opaqueredirect") return true
  if (isLoginUrl(response.url)) return true

  return response.status >= 300 &&
    response.status < 400 &&
    isLoginUrl(response.headers.get("location"))
}

/**
 * Runs async tasks one at a time in call order. A failed task does not block
 * the tasks queued behind it.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task)
    tail = result.catch(() => undefined)
    return result
  }
}
