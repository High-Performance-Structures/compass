"use client"

import type {
  ChatTransport,
  UIMessage,
  UIMessageChunk,
} from "ai"

// bridge protocol message types
type BridgeServerMessage =
  | {
      readonly type: "auth_ok"
      readonly user: {
        readonly id: string
        readonly name: string
        readonly role: string
      }
    }
  | { readonly type: "auth_error"; readonly message: string }
  | {
      readonly type: "chat.ack"
      readonly id: string
      readonly runId: string
    }
  | {
      readonly type: "chunk"
      readonly runId: string
      readonly chunk: UIMessageChunk
    }
  | { readonly type: "chat.done"; readonly runId: string }
  | {
      readonly type: "chat.error"
      readonly runId: string
      readonly error: string
    }
  | { readonly type: "pong" }

const BRIDGE_PORT = 18789
const DEFAULT_URL = `ws://localhost:${BRIDGE_PORT}`
const AUTH_TIMEOUT = 5000
const CONNECT_TIMEOUT = 3000

function isBridgeServerMessage(
  raw: unknown,
): raw is BridgeServerMessage {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "type" in raw
  )
}

export class WebSocketChatTransport
  implements ChatTransport<UIMessage>
{
  private ws: WebSocket | null = null
  private authenticated = false
  private readonly url: string
  private connectPromise: Promise<void> | null = null

  constructor(url = DEFAULT_URL) {
    this.url = url
  }

  private async ensureConnected(): Promise<void> {
    if (
      this.ws?.readyState === WebSocket.OPEN &&
      this.authenticated
    ) {
      return
    }

    if (this.connectPromise) return this.connectPromise

    this.connectPromise = new Promise<void>(
      (resolve, reject) => {
        const ws = new WebSocket(this.url)
        let authResolved = false

        const timeout = setTimeout(() => {
          if (!authResolved) {
            authResolved = true
            ws.close()
            this.connectPromise = null
            reject(new Error("bridge auth timeout"))
          }
        }, AUTH_TIMEOUT)

        // daemon auto-authenticates on connect --
        // just wait for auth_ok message
        ws.onmessage = (event) => {
          if (authResolved) return
          const raw: unknown = JSON.parse(
            String(event.data),
          )
          if (!isBridgeServerMessage(raw)) return
          const msg = raw
          if (msg.type === "auth_ok") {
            authResolved = true
            clearTimeout(timeout)
            this.ws = ws
            this.authenticated = true
            this.connectPromise = null
            resolve()
          } else if (msg.type === "auth_error") {
            authResolved = true
            clearTimeout(timeout)
            ws.close()
            this.connectPromise = null
            reject(new Error(msg.message))
          }
        }

        ws.onerror = () => {
          if (!authResolved) {
            authResolved = true
            clearTimeout(timeout)
            this.connectPromise = null
            reject(
              new Error("bridge connection failed")
            )
          }
        }

        ws.onclose = () => {
          this.ws = null
          this.authenticated = false
          if (!authResolved) {
            authResolved = true
            clearTimeout(timeout)
            this.connectPromise = null
            reject(
              new Error("bridge connection closed")
            )
          }
        }
      }
    )

    return this.connectPromise
  }

  sendMessages: ChatTransport<UIMessage>["sendMessages"] =
    async (options) => {
      await this.ensureConnected()

      const ws = this.ws
      if (!ws) throw new Error("bridge not connected")

      const messageId = crypto.randomUUID()

      // read bridge model preference from localStorage
      const bridgeModel =
        typeof window !== "undefined"
          ? localStorage.getItem("compass-bridge-model")
          : null

      console.log(
        "[bridge] sending message via WebSocket transport",
        { model: bridgeModel }
      )

      ws.send(
        JSON.stringify({
          type: "chat.send",
          id: messageId,
          trigger: options.trigger,
          messages: options.messages,
          model: bridgeModel ?? undefined,
          context: {
            currentPage:
              options.headers instanceof Headers
                ? options.headers.get("x-current-page")
                : options.headers?.["x-current-page"] ??
                  "/dashboard",
            timezone:
              options.headers instanceof Headers
                ? options.headers.get("x-timezone")
                : options.headers?.["x-timezone"] ??
                  "UTC",
            conversationId: options.chatId,
          },
        })
      )

      let currentRunId: string | null = null

      return new ReadableStream<UIMessageChunk>({
        start: (controller) => {
          const onMessage = (event: MessageEvent) => {
            const raw: unknown = JSON.parse(
              String(event.data),
            )
            if (!isBridgeServerMessage(raw)) return
            const msg = raw

            switch (msg.type) {
              case "chat.ack":
                currentRunId = msg.runId
                break
              case "chunk":
                if (msg.runId === currentRunId) {
                  controller.enqueue(msg.chunk)
                }
                break
              case "chat.done":
                if (msg.runId === currentRunId) {
                  ws.removeEventListener(
                    "message",
                    onMessage
                  )
                  controller.close()
                }
                break
              case "chat.error":
                if (msg.runId === currentRunId) {
                  ws.removeEventListener(
                    "message",
                    onMessage
                  )
                  controller.error(
                    new Error(msg.error)
                  )
                }
                break
              default:
                break
            }
          }

          ws.addEventListener("message", onMessage)

          if (options.abortSignal) {
            options.abortSignal.addEventListener(
              "abort",
              () => {
                if (currentRunId) {
                  ws.send(
                    JSON.stringify({
                      type: "chat.abort",
                      runId: currentRunId,
                    })
                  )
                }
                ws.removeEventListener(
                  "message",
                  onMessage
                )
                controller.close()
              },
              { once: true }
            )
          }
        },
      })
    }

  reconnectToStream: ChatTransport<UIMessage>["reconnectToStream"] =
    async () => {
      return null
    }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
      this.authenticated = false
    }
  }
}

// detect if bridge daemon is running
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
