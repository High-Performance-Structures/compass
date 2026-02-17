"use client"

const BRIDGE_PORT = 18789
const DEFAULT_URL = `ws://localhost:${BRIDGE_PORT}`
const CONNECT_TIMEOUT = 3000

/**
 * Detect if the bridge daemon is running by attempting
 * a WebSocket connection and checking if it opens.
 */
export async function detectBridge(
  url = DEFAULT_URL
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(url)
      const timer = setTimeout(() => {
        ws.close()
        resolve(false)
      }, CONNECT_TIMEOUT)

      ws.onopen = () => {
        clearTimeout(timer)
        ws.close()
        resolve(true)
      }

      ws.onerror = () => {
        clearTimeout(timer)
        resolve(false)
      }
    } catch {
      resolve(false)
    }
  })
}

export { BRIDGE_PORT }
