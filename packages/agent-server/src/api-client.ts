/**
 * Shared HTTP client for calling the Compass Workers API.
 * All MCP tools use this to interact with the Compass backend.
 */

export async function compassApi<T>(
  baseUrl: string,
  path: string,
  authToken: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `API error ${res.status}`)
  }

  return res.json() as Promise<T>
}
